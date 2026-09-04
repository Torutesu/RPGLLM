import type { Persona, Post, PrismaClient, RelationshipState, User, World, WorldCharacter } from "@prisma/client";
import type { CharacterCard, G1Input, G1Output, PersonaState, WorldSeed } from "@rpgllm/shared";
import { PACING, STATS } from "@rpgllm/shared";
import { normHandle, sameHandle } from "./handles";
import { blockedCharacterIds, withoutBlocked } from "./moderation";   // Agent G (S1-2)
import { localized, type LocaleKey } from "./locale";
import type { Tx } from "../types";
import { getWorldSeed } from "./world-seeds";

export interface StoryContext {
  user: User;
  persona: Persona;
  world: World;
  characters: WorldCharacter[];
  relationships: RelationshipState[];
  /** Agent G (S1-2): characters this persona blocked; already removed from `characters`. */
  blockedCharacterIds: string[];
  locale: LocaleKey;
  seed: WorldSeed | undefined;
}

export async function loadStoryContext(prisma: PrismaClient, user: User, personaId: string): Promise<StoryContext | null> {
  const persona = await prisma.persona.findUnique({ where: { id: personaId }, include: { world: true } });
  if (!persona || persona.userId !== user.id) return null;
  const [characters, relationships, blocked] = await Promise.all([
    prisma.worldCharacter.findMany({ where: { worldId: persona.worldId }, orderBy: { handle: "asc" } }),
    prisma.relationshipState.findMany({ where: { personaId: persona.id } }),
    blockedCharacterIds(prisma, persona.id),   // Agent G (S1-2)
  ]);
  const locale = user.locale as LocaleKey;
  const { world, ...personaRow } = persona;
  // Agent G (S1-2): a blocked character leaves the cast, so it stops replying and stops being
  // offered in the DM picker.
  const cast = withoutBlocked(characters, blocked, (ch) => ch.id);
  return { user, persona: personaRow as Persona, world, characters: cast, relationships, blockedCharacterIds: blocked, locale, seed: await getWorldSeed(world.slug) };
}

export const characterByHandle = (characters: WorldCharacter[], handle: string): WorldCharacter | undefined =>
  characters.find((c) => sameHandle(c.handle, handle));

export const pressAccount = (characters: WorldCharacter[]): WorldCharacter | undefined =>
  characters.find((c) => c.isPressAccount) ?? characters[0];

export function castCards(ctx: StoryContext): CharacterCard[] {
  return ctx.characters.map((c) => ({
    handle: normHandle(c.handle),   // generators and fixtures use bare handles
    displayName: c.displayName,
    role: c.role,
    card: localized(c.card, ctx.locale),
    isPressAccount: c.isPressAccount,
  }));
}

export function personaState(ctx: StoryContext): PersonaState {
  const p = ctx.persona;
  return {
    handle: p.handle,
    displayName: p.displayName,
    bio: p.bio,
    voiceNotes: p.voiceNotes,
    followers: p.followers,
    aura: p.aura,
    humor: p.humor,
    level: p.level,
    worldSummary: p.worldSummary,
  };
}

/** up to 3 relationships: the parent post's author first, then followers by affinity desc */
export function involvedFor(ctx: StoryContext, parentAuthorHandle: string | null): G1Input["involved"] {
  const byId = new Map(ctx.characters.map((c) => [c.id, c]));
  const rows = ctx.relationships
    .map((r) => ({ rel: r, ch: byId.get(r.characterId) }))
    .filter((x): x is { rel: RelationshipState; ch: WorldCharacter } => Boolean(x.ch));
  const scored = rows.sort((a, b) => {
    const aParent = parentAuthorHandle && sameHandle(a.ch.handle, parentAuthorHandle) ? 1 : 0;
    const bParent = parentAuthorHandle && sameHandle(b.ch.handle, parentAuthorHandle) ? 1 : 0;
    if (aParent !== bParent) return bParent - aParent;
    const aF = a.rel.isFollower ? 1 : 0;
    const bF = b.rel.isFollower ? 1 : 0;
    if (aF !== bF) return bF - aF;
    return b.rel.affinity - a.rel.affinity;
  });
  return scored.slice(0, 3).map(({ rel, ch }) => ({
    handle: normHandle(ch.handle),
    affinity: rel.affinity,
    summary: rel.summary,
    isFollower: rel.isFollower,
  }));
}

export async function recentFeed(prisma: PrismaClient, ctx: StoryContext): Promise<G1Input["recentFeed"]> {
  const rows = await prisma.post.findMany({
    where: { personaId: ctx.persona.id },
    orderBy: { createdAt: "desc" },
    take: PACING.FEED_RECENT_FOR_PROMPT,
    include: { authorCharacter: true },
  });
  return rows.map((r) => ({
    authorHandle: r.authorCharacter ? r.authorCharacter.handle : ctx.persona.handle,
    kind: r.kind,
    text: r.text,
  }));
}

export function baseCtx(ctx: StoryContext) {
  return {
    userId: ctx.user.id,
    locale: ctx.locale,
    worldSlug: ctx.world.slug,
    worldBible: localized(ctx.world.bible, ctx.locale),
    isMinor: ctx.user.isMinor,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface AppliedStats {
  followers: number; aura: number; humor: number; xp: number; level: number;
  followersDelta: number; auraDelta: number; humorDelta: number;
}

/** followers += delta × level; aura/humor clamped 0..100; XP +10 with a level every 100. */
export function applyStatDeltas(persona: Persona, deltas: { followers: number; aura: number; humor: number }): AppliedStats {
  const followersDelta = deltas.followers * persona.level;
  const followers = Math.max(0, persona.followers + followersDelta);
  const aura = clamp(persona.aura + deltas.aura, STATS.MIN, STATS.MAX);
  const humor = clamp(persona.humor + deltas.humor, STATS.MIN, STATS.MAX);
  const xp = persona.xp + 10;
  const level = Math.floor(xp / 100) + 1;
  return { followers, aura, humor, xp, level, followersDelta, auraDelta: aura - persona.aura, humorDelta: humor - persona.humor };
}

/** affinity ±5 per delta; a character becomes a follower at affinity >= 10 (never demoted). */
export async function applyRelationshipDeltas(
  tx: Tx,
  ctx: StoryContext,
  deltas: Record<string, number>,
): Promise<Record<string, number>> {
  const applied: Record<string, number> = {};
  for (const [handle, raw] of Object.entries(deltas)) {
    const delta = Math.sign(raw);
    if (delta === 0) continue;
    const character = characterByHandle(ctx.characters, handle);
    if (!character) continue;
    const rel = ctx.relationships.find((r) => r.characterId === character.id);
    if (!rel) continue;
    const affinity = clamp(rel.affinity + delta * 5, -100, 100);
    await tx.relationshipState.update({
      where: { id: rel.id },
      data: { affinity, isFollower: rel.isFollower || affinity >= 10 },
    });
    rel.affinity = affinity;
    rel.isFollower = rel.isFollower || affinity >= 10;
    applied[normHandle(handle)] = delta;
  }
  return applied;
}

export async function writeMemoryNotes(
  tx: Tx,
  ctx: StoryContext,
  notes: G1Output["memory_notes"],
  sourceRef: string,
): Promise<void> {
  for (const note of notes) {
    const character = characterByHandle(ctx.characters, note.handle);
    if (!character) continue;
    const rel = ctx.relationships.find((r) => r.characterId === character.id);
    if (!rel) continue;
    await tx.memoryEntry.create({ data: { relationshipId: rel.id, note: note.note, sourceRef } });
  }
}

/** Post rows whose parent is `postId` and which the character cast authored. */
export const characterRepliesWhere = (postId: string) => ({ parentId: postId, kind: "character" as const });

export const parentAuthorHandleOf = (parent: (Post & { authorCharacter: WorldCharacter | null }) | null, ctx: StoryContext): string | null =>
  parent ? (parent.authorCharacter ? parent.authorCharacter.handle : ctx.persona.handle) : null;
