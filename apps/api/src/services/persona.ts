import type { Persona, Prisma, User, WorldCharacter } from "@prisma/client";
import type { CreatePersonaReqZ, G1Input } from "@rpgllm/shared";
import { PACING, STATS } from "@rpgllm/shared";
import type { z } from "zod";
import type { Deps } from "../types";
import { logGeneration } from "./generation";
import { normHandle, sameHandle } from "./handles";
import { localized, type LocaleKey } from "./locale";
import { mediaForBatch } from "./media";
import { computeMetrics, hashString, seededRandom, seedFrom } from "./rng";
import { getWorldSeed } from "./world-seeds";
import { canPlay } from "./world-studio";

type CreatePersonaReq = z.infer<typeof CreatePersonaReqZ>;

export type CreatePersonaOutcome =
  | { ok: true; persona: Persona; feedReady: boolean }
  | { ok: false; code: "NOT_FOUND" | "HANDLE_TAKEN"; message: string };

/**
 * SCR-006. Creates the persona, the full RelationshipState cast (first follower at affinity 20),
 * and the initial feed: 5 ambient posts from the pool + 1 welcome post by the first follower (G1, k=1).
 */
export async function createPersonaWithFeed(deps: Deps, user: User, req: CreatePersonaReq): Promise<CreatePersonaOutcome> {
  const world = await deps.prisma.world.findUnique({ where: { id: req.worldId } });
  if (!world) return { ok: false, code: "NOT_FOUND", message: "World not found" };
  // AIF-003: knowing the id of somebody else's private world must not be enough to play it.
  if (!canPlay(world, user.id)) return { ok: false, code: "NOT_FOUND", message: "World not found" };

  const handle = normHandle(req.handle);
  const taken = await deps.prisma.persona.findUnique({ where: { worldId_handle: { worldId: world.id, handle } } });
  if (taken) {
    if (taken.userId === user.id) return { ok: true, persona: taken, feedReady: true };
    return { ok: false, code: "HANDLE_TAKEN", message: "That handle is taken in this world" };
  }

  const characters = await deps.prisma.worldCharacter.findMany({ where: { worldId: world.id }, orderBy: { handle: "asc" } });
  const firstFollower = characters.find((c) => c.id === req.firstFollowerId)
    ?? characters.find((c) => c.canBeFirstFollower)
    ?? characters[0];
  if (!firstFollower) return { ok: false, code: "NOT_FOUND", message: "World has no cast" };

  const persona = await deps.prisma.$transaction(async (tx) => {
    const created = await tx.persona.create({
      data: {
        userId: user.id,
        worldId: world.id,
        handle,
        displayName: req.displayName,
        bio: req.bio,
        avatarUrl: req.avatarUrl,
        voiceNotes: req.voiceNotes,
        followers: STATS.START_FOLLOWERS,
        aura: STATS.START_AURA,
        humor: STATS.START_HUMOR,
      },
    });
    await tx.relationshipState.createMany({
      data: characters.map((c) => ({
        personaId: created.id,
        characterId: c.id,
        affinity: c.id === firstFollower.id ? 20 : 0,
        isFollower: c.id === firstFollower.id,
      })),
    });
    /**
     * "Plays" is what ranks a world on the community shelf (AIF-003), so it counts *personas*, not
     * requests: it is incremented in the same transaction that creates the persona, and a retried
     * or idempotent create returns above without reaching here. One player, one play.
     */
    await tx.world.update({ where: { id: world.id }, data: { playCount: { increment: 1 } } });
    return created;
  });

  const feedReady = await seedInitialFeed(deps, user, persona, characters, firstFollower);
  return { ok: true, persona, feedReady };
}

async function seedInitialFeed(
  deps: Deps,
  user: User,
  persona: Persona,
  characters: WorldCharacter[],
  firstFollower: WorldCharacter,
): Promise<boolean> {
  const locale = user.locale as LocaleKey;
  const world = await deps.prisma.world.findUniqueOrThrow({ where: { id: persona.worldId } });
  const now = deps.clock.now();

  const pool = await deps.prisma.ambientPost.findMany({ where: { worldId: world.id, locale: user.locale } });
  const rnd = seededRandom(hashString(persona.id));
  const shuffled = [...pool].sort(() => rnd() - 0.5).slice(0, PACING.AMBIENT_SEED_COUNT);
  const seeded: string[] = [];
  for (const [i, ambient] of shuffled.entries()) {
    const created = await deps.prisma.post.create({
      data: {
        worldId: world.id,
        personaId: persona.id,
        authorCharacterId: ambient.characterId,
        kind: "ambient",
        text: ambient.text,
        createdAt: new Date(now.getTime() - (shuffled.length - i) * 60_000),
        metrics: {},
      },
    });
    seeded.push(created.id);
    await deps.prisma.post.update({
      where: { id: created.id },
      data: { metrics: computeMetrics(created.id, persona.followers) as unknown as Prisma.InputJsonValue },
    });
  }
  // The very first screen has to carry at least one picture — a text-only starting feed is exactly
  // what the media feature exists to prevent, and a per-row coin flip cannot promise that.
  const media = mediaForBatch(seeded, "ambient");
  for (const [id, m] of media) {
    if (m.mediaKind !== null) await deps.prisma.post.update({ where: { id }, data: m });
  }

  const seed = await getWorldSeed(world.slug, deps.prisma);
  const input: G1Input = {
    userId: user.id,
    locale,
    worldSlug: world.slug,
    worldBible: localized(world.bible, locale),
    isMinor: user.isMinor,
    persona: {
      handle: persona.handle, displayName: persona.displayName, bio: persona.bio, voiceNotes: persona.voiceNotes,
      followers: persona.followers, aura: persona.aura, humor: persona.humor, level: persona.level, worldSummary: persona.worldSummary,
    },
    // Generators and replay fixtures key on bare handles; the DB stores them with a leading "@".
    // Without normHandle the fixture lookup misses and G1 returns the "..." placeholder.
    cast: characters.map((c) => ({
      handle: normHandle(c.handle), displayName: c.displayName, role: c.role, card: localized(c.card, locale), isPressAccount: c.isPressAccount,
    })),
    involved: [{ handle: normHandle(firstFollower.handle), affinity: 20, summary: "", isFollower: true }],
    recentFeed: shuffled.map((a) => ({ authorHandle: normHandle(firstFollower.handle), kind: "ambient" as const, text: a.text })),
    post: { text: persona.bio.length > 0 ? persona.bio : persona.displayName, parentAuthorHandle: null, parentText: null },
    k: 1,
    softened: false,
    seed: seedFrom(`welcome:${persona.id}`),
    includeNews: false,
  };

  const result = await deps.gateway.g1(input);
  const generationId = await logGeneration(deps.prisma, result.meta, user.id);
  const seedWelcome = seed
    ? Object.entries(seed.welcomePosts).find(([h]) => sameHandle(h, firstFollower.handle))?.[1]
    : undefined;
  const fallbackText = seedWelcome ? localized(seedWelcome, locale) : "";
  const generated = result.output.replies[0]?.text ?? "";
  const text = result.meta.fallback ? (fallbackText || generated || "👀") : (generated || fallbackText || "👀");

  const welcome = await deps.prisma.post.create({
    data: {
      worldId: world.id,
      personaId: persona.id,
      authorCharacterId: firstFollower.id,
      kind: "character",
      text,
      generationId,
      createdAt: now,
      metrics: {},
    },
  });
  await deps.prisma.post.update({
    where: { id: welcome.id },
    data: { metrics: computeMetrics(welcome.id, persona.followers) as unknown as Prisma.InputJsonValue },
  });

  return true;
}
