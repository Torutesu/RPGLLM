import type { DMMessage, DMThread, Event as DramaEvent, Persona, Post, StatSnapshot, Subscription, Wallet, World, WorldCharacter } from "@prisma/client";
import type { z } from "zod";
import type { CharacterZ, DMMessageZ, DMThreadZ, EventZ, PostZ, StatSnapshotZ, SubscriptionZ, WalletZ, WorldSummaryZ } from "@rpgllm/shared";
import type { PlanId } from "@rpgllm/shared";
import { atHandle } from "./handles";
import { firstSentence, localized, type LocaleKey } from "./locale";
import type { Metrics } from "./rng";

export type ApiPost = z.infer<typeof PostZ>;
export type ApiCharacter = z.infer<typeof CharacterZ>;
export type ApiSnapshot = z.infer<typeof StatSnapshotZ>;
export type ApiEvent = z.infer<typeof EventZ>;
export type ApiWallet = z.infer<typeof WalletZ>;
export type ApiSubscription = z.infer<typeof SubscriptionZ>;
export type ApiWorldSummary = z.infer<typeof WorldSummaryZ>;
export type ApiDMThread = z.infer<typeof DMThreadZ>;
export type ApiDMMessage = z.infer<typeof DMMessageZ>;

export type PostRow = Post & { authorCharacter?: WorldCharacter | null };

const readMetrics = (value: unknown): Metrics => {
  if (value && typeof value === "object") {
    const m = value as Record<string, unknown>;
    const num = (k: string) => (typeof m[k] === "number" ? (m[k] as number) : 0);
    return { likes: num("likes"), reposts: num("reposts"), replies: num("replies") };
  }
  return { likes: 0, reposts: 0, replies: 0 };
};

/** news posts carry `causedBy: "post:<id>"` inside metrics so the stream can replay them idempotently */
export const metricsCausedBy = (value: unknown): string | null => {
  if (value && typeof value === "object") {
    const v = (value as Record<string, unknown>)["causedBy"];
    if (typeof v === "string") return v;
  }
  return null;
};

export function toApiPost(
  row: PostRow,
  persona: Pick<Persona, "id" | "handle" | "displayName" | "avatarUrl"> | null,
  replies?: ApiPost[],
): ApiPost {
  const character = row.authorCharacter ?? null;
  const author = character
    ? {
      handle: atHandle(character.handle),
      displayName: character.displayName,
      avatarUrl: character.avatarUrl,
      verified: true,
      isYou: false,
    }
    : row.authorPersonaId && persona
      ? { handle: atHandle(persona.handle), displayName: persona.displayName, avatarUrl: persona.avatarUrl, verified: true, isYou: true }
      : { handle: "world", displayName: "World", avatarUrl: null, verified: false, isYou: false };
  const post: ApiPost = {
    id: row.id,
    kind: row.kind,
    text: row.text,
    parentId: row.parentId,
    author,
    metrics: readMetrics(row.metrics),
    generationId: row.generationId,
    createdAt: row.createdAt.toISOString(),
  };
  if (replies) post.replies = replies;
  return post;
}

/**
 * StatSnapshot.relDeltas is stored as `{ deltas: {handle:±1}, after: {followers,aura,humor} }`
 * (schema §"relDeltas" said a bare map; we wrap it so StatSnapshotZ.after has a durable home —
 * see build-notes "Agent A"). A bare map is still read correctly.
 */
export function readRelDeltas(value: unknown): { deltas: Record<string, number>; after: { followers: number; aura: number; humor: number } | null } {
  if (!value || typeof value !== "object") return { deltas: {}, after: null };
  const obj = value as Record<string, unknown>;
  if (obj["deltas"] && typeof obj["deltas"] === "object") {
    const deltas: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj["deltas"] as Record<string, unknown>)) if (typeof v === "number") deltas[k] = v;
    const a = obj["after"];
    const after = a && typeof a === "object"
      ? {
        followers: Number((a as Record<string, unknown>)["followers"] ?? 0),
        aura: Number((a as Record<string, unknown>)["aura"] ?? 0),
        humor: Number((a as Record<string, unknown>)["humor"] ?? 0),
      }
      : null;
    return { deltas, after };
  }
  const deltas: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj)) if (typeof v === "number") deltas[k] = v;
  return { deltas, after: null };
}

export function toApiSnapshot(row: StatSnapshot, persona: Pick<Persona, "followers" | "aura" | "humor">): ApiSnapshot {
  const { deltas, after } = readRelDeltas(row.relDeltas);
  return {
    id: row.id,
    cause: row.cause,
    narrative: row.narrative,
    followersDelta: row.followersDelta,
    auraDelta: row.auraDelta,
    humorDelta: row.humorDelta,
    relDeltas: deltas,
    after: after ?? { followers: persona.followers, aura: persona.aura, humor: persona.humor },
    createdAt: row.createdAt.toISOString(),
  };
}

export interface StoredChoice {
  id: string;
  label: string;
  outcomeText: string;
  statDeltas: { followers: number; aura: number; humor: number };
  relationshipDeltas: Record<string, number>;
  newsText: string | null;
}

export function readChoices(value: unknown): StoredChoice[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): StoredChoice[] => {
    if (!raw || typeof raw !== "object") return [];
    const c = raw as Record<string, unknown>;
    const sd = (c["statDeltas"] ?? {}) as Record<string, unknown>;
    const rd = (c["relationshipDeltas"] ?? {}) as Record<string, unknown>;
    const deltas: Record<string, number> = {};
    for (const [k, v] of Object.entries(rd)) if (typeof v === "number") deltas[k] = v;
    return [{
      id: String(c["id"] ?? ""),
      label: String(c["label"] ?? ""),
      outcomeText: String(c["outcomeText"] ?? ""),
      statDeltas: { followers: Number(sd["followers"] ?? 0), aura: Number(sd["aura"] ?? 0), humor: Number(sd["humor"] ?? 0) },
      relationshipDeltas: deltas,
      newsText: typeof c["newsText"] === "string" ? c["newsText"] : null,
    }];
  });
}

export function toApiEvent(row: DramaEvent): ApiEvent {
  const choices = readChoices(row.choices).slice(0, 3).map((c) => ({ id: c.id, label: c.label }));
  while (choices.length < 3) choices.push({ id: `c${choices.length + 1}`, label: "—" });
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    choices: [choices[0]!, choices[1]!, choices[2]!],
    chosenId: row.chosenId,
  };
}

export function toApiWorld(world: World, locale: LocaleKey): ApiWorldSummary {
  return {
    id: world.id,
    slug: world.slug,
    title: localized(world.title, locale),
    scenario: localized(world.scenario, locale),
    difficulty: world.difficulty,
    coverUrl: world.coverUrl,
  };
}

export function toApiCharacter(row: WorldCharacter, locale: LocaleKey, intro?: string): ApiCharacter {
  const card = localized(row.card, locale);
  return {
    id: row.id,
    handle: atHandle(row.handle),
    displayName: row.displayName,
    role: row.role,
    avatarUrl: row.avatarUrl,
    isPressAccount: row.isPressAccount,
    canBeFirstFollower: row.canBeFirstFollower,
    intro: intro && intro.length > 0 ? intro : firstSentence(card),
  };
}

export function toApiWallet(
  wallet: Wallet,
  opts: { dailyMax: number; adsEnabled: boolean; adPersonalized: boolean },
): ApiWallet {
  return {
    energy: wallet.energy,
    coffee: wallet.coffee,
    gems: wallet.gems,
    dailyRefillAt: wallet.dailyRefillAt.toISOString(),
    adRewardsToday: wallet.adRewardsToday,
    adsEnabled: opts.adsEnabled,
    adPersonalized: opts.adPersonalized,
    dailyMax: opts.dailyMax,
  };
}

export function toApiSubscription(sub: Subscription | null): ApiSubscription | null {
  if (!sub) return null;
  return { plan: sub.plan as PlanId, active: sub.active, renewsAt: sub.renewsAt ? sub.renewsAt.toISOString() : null };
}

export function toApiPersona(persona: Persona, worldSlug: string) {
  return {
    id: persona.id,
    worldId: persona.worldId,
    worldSlug,
    handle: atHandle(persona.handle),
    displayName: persona.displayName,
    bio: persona.bio,
    avatarUrl: persona.avatarUrl,
    followers: persona.followers,
    aura: persona.aura,
    humor: persona.humor,
    level: persona.level,
    xp: persona.xp,
    actionCount: persona.actionCount,
  };
}

export function toApiThread(
  thread: DMThread & { character: WorldCharacter },
  locale: LocaleKey,
  lastMessage: DMMessage | null,
  intro?: string,
): ApiDMThread {
  return {
    id: thread.id,
    character: toApiCharacter(thread.character, locale, intro),
    lastMessage: lastMessage?.text ?? null,
    lastMessageAt: thread.lastMessageAt.toISOString(),
    unreadCount: thread.unreadCount,
  };
}

export function toApiMessage(row: DMMessage): ApiDMMessage {
  return {
    id: row.id,
    fromCharacter: row.fromCharacter,
    text: row.text,
    generationId: row.generationId,
    createdAt: row.createdAt.toISOString(),
  };
}
