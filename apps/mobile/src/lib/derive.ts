import { HEAT, MEDIA_EVERY, MEDIA_KINDS, hashString, type MediaKind, type Post } from "@rpgllm/shared";

/**
 * Feed derivations (Agent K).
 *
 * The server stores `Post.mediaKind`, `Post.mediaSeed` and `Post.heat` (schema.prisma) and ranks
 * trending on them, but `PostZ` — which `packages/shared` owns and which is frozen — has no field
 * to carry them to the client. Rather than let the feed go without media, both sides derive the
 * same values from data every post already has:
 *
 *   • media — a pure function of the post id, using the shared FNV-1a `hashString`, so this file
 *     and `apps/api/src/services/media.ts` always agree, byte for byte, on every platform.
 *   • heat  — the same curve as `apps/api/src/services/heat.ts` over the metrics and the age of
 *     the post. The server additionally folds in the stat swing a post caused, which the client
 *     cannot see; that only ever makes the server's number higher, never lower, so a post the
 *     client draws cool is never one the server called viral.
 *
 * Change either formula and change its twin in `apps/api/src/services/`.
 */

export interface DerivedMedia {
  kind: MediaKind;
  seed: string;
}

const paletteFor = (postKind: string): readonly MediaKind[] =>
  postKind === "news" ? (["leak", "chart"] as const) : MEDIA_KINDS;

/** The press account posts receipts far more often than the cast posts pictures. */
const NEWS_EVERY = 2;

/** The media a post carries, or `null` for the text-only majority. Mirrors `services/media.ts`. */
export function mediaOf(post: Pick<Post, "id" | "kind" | "parentId">): DerivedMedia | null {
  if (post.kind === "user" || post.kind === "system" || post.parentId !== null) return null;
  const h = hashString(post.id);
  if (h % (post.kind === "news" ? NEWS_EVERY : MEDIA_EVERY) !== 0) return null;
  const palette = paletteFor(post.kind);
  return { kind: palette[(h >>> 8) % palette.length] ?? palette[0]!, seed: (h >>> 3).toString(36) };
}

const SATURATION = Math.log(5001);
const DECAY_HOURS = 48;
const DECAY_MAX = 0.35;
const NEWS_BONUS = 12;

/** 0..100. Mirrors `services/heat.ts` minus the stat impact the client cannot know about. */
export function heatOf(post: Pick<Post, "kind" | "metrics" | "createdAt">, now: Date = new Date()): number {
  const { likes, reposts, replies } = post.metrics;
  const engagement = Math.max(0, likes) + 3 * Math.max(0, reposts) + 5 * Math.max(0, replies);
  const created = new Date(post.createdAt).getTime();
  const hours = Number.isFinite(created) ? Math.max(0, (now.getTime() - created) / 3_600_000) : 0;
  const recency = 1 - Math.min(1, hours / DECAY_HOURS) * DECAY_MAX;
  const scored = (100 * Math.log(1 + engagement) / SATURATION) * recency + (post.kind === "news" ? NEWS_BONUS : 0);
  return Math.min(HEAT.MAX, Math.max(0, Math.round(scored)));
}

export const isHot = (heat: number): boolean => heat >= HEAT.HOT;
export const isViral = (heat: number): boolean => heat >= HEAT.VIRAL;

/** A stable 0..1 float from a seed string and a channel, for the procedural drawings. */
export function seeded(seed: string, channel: number): number {
  return (hashString(`${seed}:${channel}`) % 100_000) / 100_000;
}

/** `seeded` mapped into a range. */
export const seededIn = (seed: string, channel: number, lo: number, hi: number): number =>
  lo + seeded(seed, channel) * (hi - lo);

/** `seeded` mapped onto one entry of a list. */
export const seededOf = <T,>(seed: string, channel: number, list: readonly T[]): T =>
  list[Math.floor(seeded(seed, channel) * list.length) % list.length] ?? list[0]!;
