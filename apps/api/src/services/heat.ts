import { HEAT } from "@rpgllm/shared";
import type { Metrics } from "./rng";

/**
 * Heat (Agent K) — "how loud is this post right now", 0..100.
 *
 * Inputs are only things that exist on every row: the 演出 metrics, how old the post is, and (for
 * the player's own posts) how hard the world reacted. It saturates logarithmically so a 200k-like
 * post is hotter than a 20k one without being twenty times hotter, and it decays over two days so
 * the feed's flames move.
 *
 * `HEAT.HOT` (60) earns a flame + identity glow in the feed; `HEAT.VIRAL` (85) is moment-worthy.
 *
 * The same curve is written once more in SQL (`services/trending.ts`, `SQL_HEAT`) so trending can
 * aggregate without loading rows, and once more in the client (`apps/mobile/src/lib/derive.ts`)
 * because `PostZ` has no field to carry it. Change one, change all three.
 */

/** ln(1 + engagement) is divided by this, so ~5000 weighted engagements reads as 100. */
const SATURATION = Math.log(5001);
const DECAY_HOURS = 48;
const DECAY_MAX = 0.35;
const NEWS_BONUS = 12;

export interface HeatInput {
  metrics: Metrics;
  kind: string;
  createdAt: Date;
  now: Date;
  /** |aura| and follower swing the post caused, when a StatSnapshot for it already exists. */
  statImpact?: { auraDelta: number; followersDelta: number; followersBefore: number } | null;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export function engagementOf(m: Metrics): number {
  return Math.max(0, m.likes) + 3 * Math.max(0, m.reposts) + 5 * Math.max(0, m.replies);
}

/** 0..1 — how much of the post's own loudness survives its age. */
export function recencyFactor(createdAt: Date, now: Date): number {
  const hours = Math.max(0, (now.getTime() - createdAt.getTime()) / 3_600_000);
  return 1 - Math.min(1, hours / DECAY_HOURS) * DECAY_MAX;
}

/** 0..25 — a post that moved the numbers is hot even when nobody liked it yet. */
export function statImpactPoints(impact: HeatInput["statImpact"]): number {
  if (!impact) return 0;
  const aura = Math.min(15, Math.abs(impact.auraDelta) * 1.5);
  const share = impact.followersBefore > 0 ? Math.abs(impact.followersDelta) / impact.followersBefore : 0;
  return clamp(aura + Math.min(10, share * 40), 0, 25);
}

export function heatFor(input: HeatInput): number {
  const base = (100 * Math.log(1 + engagementOf(input.metrics))) / SATURATION;
  const scored =
    base * recencyFactor(input.createdAt, input.now)
    + (input.kind === "news" ? NEWS_BONUS : 0)
    + statImpactPoints(input.statImpact ?? null);
  return clamp(Math.round(scored), 0, HEAT.MAX);
}

export const isHot = (heat: number): boolean => heat >= HEAT.HOT;
export const isViral = (heat: number): boolean => heat >= HEAT.VIRAL;
