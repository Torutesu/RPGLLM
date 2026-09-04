import {
  BANDIT_FLOOR,
  BANDIT_GUARDRAILS,
  BANDIT_LAMBDA,
  BANDIT_PROMOTION,
  BANDIT_SAMPLES,
} from "@rpgllm/shared";

/**
 * Thompson sampling with guardrails (cost-architecture §6.3).
 *
 * This module is **pure**: no clock, no database, no randomness that is not seeded. It owns the
 * maths — the reward formula, the Beta posteriors, the sampler, the guardrail and promotion rules —
 * while `apps/api/src/services/bandit.ts` owns the SQL that folds `GenerationLog` + `Rating` into
 * these numbers and persists them in `BanditArm`. Keeping it split this way is what lets the
 * allocator run inside the gateway (which must not know about Prisma) and lets every rule here be
 * unit-tested without a database.
 *
 * Allocation is **user-sticky**: the sample seed is derived from (generator, userId, day), so one
 * user sees one arm for a whole day and engagement metrics are not smeared across arms.
 */

export interface ArmState {
  generator: string;
  variantId: string;
  /** Beta posterior over the reward in [0,1] */
  alpha: number;
  beta: number;
  calls: number;
  rewardSum: number;
  costSum: number;
  isChampion: boolean;
  /** minimum share of traffic this arm keeps, so exploration never stops */
  floor: number;
  disabled: boolean;
  disabledReason: string | null;
}

/** An unrated call is not a failure. Silence is worth a bit more than a coin flip, not a 👍. */
export const UNRATED_QUALITY_PRIOR = 0.6;

/** Guardrails only bite once an arm has been given a fair hearing. */
export const GUARDRAIL_MIN_CALLS = 50;

export interface CallSignals {
  /** +1 (👍), -1 (👎) or null (nobody said anything) */
  rating: number | null;
  /** the user asked for this generation again */
  regenerated: boolean;
  /** the generator returned its deterministic fallback */
  fallback: boolean;
}

/** §6.1 `quality`, from the signals that actually exist in this product. */
export function qualityOf(signals: CallSignals): number {
  if (signals.fallback) return 0;
  if (signals.regenerated) return 0;
  if (signals.rating !== null && signals.rating < 0) return 0;
  if (signals.rating !== null && signals.rating > 0) return 1;
  return UNRATED_QUALITY_PRIOR;
}

export interface RewardInput {
  signals: CallSignals;
  costUsd: number;
  /** the champion's mean cost per call; a cheaper arm is rewarded, a dearer one penalised */
  championCostUsd: number;
  lambda?: number;
}

/**
 * `reward = quality − λ × (cost / championCost)`, clamped to [0,1].
 *
 * The champion at parity therefore scores `quality − λ`: the formula measures *value for money*,
 * not quality, which is the whole point — an arm that is 40% cheaper at the same quality wins.
 */
export function rewardFor(input: RewardInput): number {
  const lambda = input.lambda ?? BANDIT_LAMBDA;
  const quality = qualityOf(input.signals);
  const ratio =
    input.championCostUsd > 0 ? input.costUsd / input.championCostUsd : input.costUsd > 0 ? 1 : 0;
  return clamp01(quality - lambda * ratio);
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Fold one observation into a posterior. Rewards are continuous, so both sides move fractionally. */
export function foldReward(arm: ArmState, reward: number): ArmState {
  const r = clamp01(reward);
  return {
    ...arm,
    alpha: arm.alpha + r,
    beta: arm.beta + (1 - r),
    calls: arm.calls + 1,
    rewardSum: arm.rewardSum + r,
  };
}

export function posteriorMean(arm: Pick<ArmState, "alpha" | "beta">): number {
  const total = arm.alpha + arm.beta;
  return total <= 0 ? 0 : arm.alpha / total;
}

/* --------------------------------------------------------------- sampling ---- */

/** mulberry32 — small, fast, and identical on every platform. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over the joined parts — the same hash family the sticky experiment assignment uses. */
export function seedFrom(...parts: Array<string | number>): number {
  const input = parts.join("|");
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

function normalSample(rng: () => number): number {
  // Box-Muller; guard the log against an exact zero.
  const u = Math.max(rng(), Number.EPSILON);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Marsaglia-Tsang gamma sampler (shape > 0). */
export function gammaSample(shape: number, rng: () => number): number {
  if (shape <= 0) return 0;
  if (shape < 1) return gammaSample(shape + 1, rng) * Math.pow(Math.max(rng(), Number.EPSILON), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let guard = 0; guard < 1000; guard += 1) {
    let x = 0;
    let v = 0;
    do {
      x = normalSample(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.max(rng(), Number.EPSILON);
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
  return d; // unreachable in practice; never loop forever inside a request
}

export function betaSample(alpha: number, beta: number, rng: () => number): number {
  const x = gammaSample(Math.max(alpha, 1e-6), rng);
  const y = gammaSample(Math.max(beta, 1e-6), rng);
  return x + y === 0 ? 0.5 : x / (x + y);
}

/** Seeded credible interval, from the posterior itself. Deterministic for a given arm + seed. */
export function credibleInterval(
  arm: Pick<ArmState, "alpha" | "beta" | "variantId">,
  samples = BANDIT_SAMPLES,
): [number, number] {
  const rng = mulberry32(seedFrom("ci", arm.variantId, Math.round(arm.alpha * 1000), Math.round(arm.beta * 1000)));
  const draws: number[] = [];
  for (let i = 0; i < samples; i += 1) draws.push(betaSample(arm.alpha, arm.beta, rng));
  draws.sort((a, b) => a - b);
  const lo = draws[Math.floor(0.025 * (draws.length - 1))] ?? 0;
  const hi = draws[Math.floor(0.975 * (draws.length - 1))] ?? 1;
  return [round4(lo), round4(hi)];
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/* ------------------------------------------------------------- allocation ---- */

export interface AllocateArgs {
  generator: string;
  arms: readonly ArmState[];
  userId: string | null;
  /** UTC day key, e.g. "2026-09-04" — the allocation is stable for one user for one day */
  day: string;
  floor?: number;
}

/**
 * One Thompson draw per enabled arm, argmax wins, with `floor` of the traffic reserved for each
 * non-winning arm so exploration never stops. Returns `null` when the bandit has nothing to say
 * (no arms, or no arm has ever been called) — the caller then uses the deterministic 50/50
 * assignment in `experiments.ts`.
 */
export function allocate(args: AllocateArgs): string | null {
  const enabled = args.arms.filter((a) => !a.disabled);
  if (enabled.length === 0) return null;
  const first = enabled[0];
  if (first === undefined) return null;
  if (enabled.length === 1) return first.variantId;
  if (enabled.every((a) => a.calls === 0)) return null;

  const rng = mulberry32(seedFrom("bandit", args.generator, args.userId ?? "system", args.day));

  let winner = first;
  let best = -1;
  for (const arm of enabled) {
    const draw = betaSample(arm.alpha, arm.beta, rng);
    if (draw > best) {
      best = draw;
      winner = arm;
    }
  }

  // Floor: every arm that did not win keeps at least `floor` of the traffic.
  const u = rng();
  let acc = 0;
  for (const arm of enabled) {
    if (arm.variantId === winner.variantId) continue;
    acc += Math.max(0, arm.floor > 0 ? arm.floor : (args.floor ?? BANDIT_FLOOR));
    if (u < acc) return arm.variantId;
  }
  return winner.variantId;
}

/** Probability that each arm is the best one, by Monte Carlo over the posteriors. */
export function pBestByArm(
  arms: readonly ArmState[],
  samples = BANDIT_SAMPLES,
  seed = 1,
): Map<string, number> {
  const out = new Map<string, number>();
  const enabled = arms.filter((a) => !a.disabled);
  for (const arm of enabled) out.set(arm.variantId, 0);
  if (enabled.length === 0) return out;
  if (enabled.length === 1) {
    const only = enabled[0];
    if (only !== undefined) out.set(only.variantId, 1);
    return out;
  }

  const rng = mulberry32(seedFrom("pbest", seed, ...enabled.map((a) => `${a.variantId}:${Math.round(a.alpha * 100)}:${Math.round(a.beta * 100)}`)));
  for (let i = 0; i < samples; i += 1) {
    let bestArm = enabled[0];
    let bestDraw = -1;
    for (const arm of enabled) {
      const draw = betaSample(arm.alpha, arm.beta, rng);
      if (draw > bestDraw) {
        bestDraw = draw;
        bestArm = arm;
      }
    }
    if (bestArm !== undefined) out.set(bestArm.variantId, (out.get(bestArm.variantId) ?? 0) + 1 / samples);
  }
  for (const [k, v] of out) out.set(k, round4(v));
  return out;
}

/** The arm with the highest posterior mean, ignoring disabled arms. */
export function leaderOf(arms: readonly ArmState[]): ArmState | null {
  const enabled = arms.filter((a) => !a.disabled);
  let leader: ArmState | null = null;
  for (const arm of enabled) {
    if (leader === null || posteriorMean(arm) > posteriorMean(leader)) leader = arm;
  }
  return leader;
}

/* -------------------------------------------------------------- guardrails ---- */

export interface ArmMetrics {
  calls: number;
  regenerations: number;
  safetyFlags: number;
  fallbacks: number;
}

export interface GuardrailBreach {
  metric: "regenerate_rate" | "safety_flag_rate" | "fallback_rate";
  value: number;
  limit: number;
}

/**
 * §6.3's guardrails. An arm under `minCalls` observations is never disabled — one bad draw is not
 * evidence — and the champion is never disabled either: there would be nothing to fall back to.
 */
export function guardrailBreach(
  metrics: ArmMetrics,
  minCalls = GUARDRAIL_MIN_CALLS,
): GuardrailBreach | null {
  if (metrics.calls < minCalls || metrics.calls === 0) return null;
  const regenerate = metrics.regenerations / metrics.calls;
  if (regenerate > BANDIT_GUARDRAILS.MAX_REGENERATE_RATE) {
    return { metric: "regenerate_rate", value: round4(regenerate), limit: BANDIT_GUARDRAILS.MAX_REGENERATE_RATE };
  }
  const safety = metrics.safetyFlags / metrics.calls;
  if (safety > BANDIT_GUARDRAILS.MAX_SAFETY_FLAG_RATE) {
    return { metric: "safety_flag_rate", value: round4(safety), limit: BANDIT_GUARDRAILS.MAX_SAFETY_FLAG_RATE };
  }
  const fallbackRate = metrics.fallbacks / metrics.calls;
  if (fallbackRate > BANDIT_GUARDRAILS.MAX_FALLBACK_RATE) {
    return { metric: "fallback_rate", value: round4(fallbackRate), limit: BANDIT_GUARDRAILS.MAX_FALLBACK_RATE };
  }
  return null;
}

/* --------------------------------------------------------------- promotion ---- */

export interface PromotionDecision {
  promote: boolean;
  from: string | null;
  to: string | null;
  /** why not, when `promote` is false */
  reason: string;
  pBest: number;
  calls: number;
}

export interface PromotionArgs {
  arms: readonly ArmState[];
  /** variant ids that have passed the §6.2 offline gate */
  gatePassed: ReadonlySet<string>;
  minCalls?: number;
  pBestMin?: number;
  samples?: number;
}

/**
 * Auto-promotion (§6.3). Three things must all be true: the challenger leads on the posterior,
 * it has at least `MIN_CALLS` observations **and** `p(best) >= P_BEST`, and it has passed the
 * offline gate. Anything less and the champion stays where it is.
 */
export function promotionDecision(args: PromotionArgs): PromotionDecision {
  const minCalls = args.minCalls ?? BANDIT_PROMOTION.MIN_CALLS;
  const pBestMin = args.pBestMin ?? BANDIT_PROMOTION.P_BEST;
  const champion = args.arms.find((a) => a.isChampion) ?? null;
  const leader = leaderOf(args.arms);
  const probabilities = pBestByArm(args.arms, args.samples ?? BANDIT_SAMPLES);
  const p = leader === null ? 0 : (probabilities.get(leader.variantId) ?? 0);
  const base = { from: champion?.variantId ?? null, to: leader?.variantId ?? null, pBest: p, calls: leader?.calls ?? 0 };

  if (leader === null) return { promote: false, ...base, reason: "no enabled arm" };
  if (champion !== null && leader.variantId === champion.variantId) {
    return { promote: false, ...base, reason: "champion still leads" };
  }
  if (leader.calls < minCalls) {
    return { promote: false, ...base, reason: `needs ${minCalls} calls, has ${leader.calls}` };
  }
  if (p < pBestMin) return { promote: false, ...base, reason: `p(best) ${p} < ${pBestMin}` };
  if (!args.gatePassed.has(leader.variantId)) {
    return { promote: false, ...base, reason: "offline gate not passed" };
  }
  return { promote: true, ...base, reason: "leader beats the champion on reward, calls, p(best) and the offline gate" };
}

/** UTC day key used to make an allocation sticky for exactly one day. */
export function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}
