import type { GenerationMeta, Locale, WorldSeed } from "@rpgllm/shared";
import type { GJOutput } from "./generators/gj.js";

/**
 * The pieces of the offline gate (cost-architecture §6.2) that are not about one generator:
 * the score shape, the weights, and the rule that some checks are absolute.
 *
 * `eval.ts` (G1) and `eval-g9.ts` (the World Studio) both build on this, which is what keeps the
 * two runs comparable — same weights, same 0..100 score, same per-case pass bar, same result rows
 * for `apps/api/src/services/evals.ts` to persist.
 */

export const MACHINE_WEIGHT = 0.4;
export const JUDGE_WEIGHT = 0.6;
/** A case passes on its own when it clears this score and breaks no absolute check. */
export const EVAL_PASS_SCORE = 70;

export interface EvalCaseRun {
  key: string;
  label: string;
  locale: Locale;
  worldSlug: string;
  /** the generator input, as stored in `EvalCase.input` */
  input: unknown;
}

export type MachineChecks = Record<string, boolean>;

/**
 * What a run is asked for. The last three fields exist for the live verification harness
 * (`verify-live/`) and are no-ops when omitted, so every existing caller is unaffected:
 *
 *   onWorld      — hand the harness each world as it is built, so the report can measure the
 *                  things the gate reduces to a boolean (how much two worlds of a genre share,
 *                  whether eight characters sound like eight people) without paying to generate
 *                  them a second time.
 *   concurrency  — a live run of eighteen worlds is 252 dependent calls; unbounded fan-out is a
 *                  rate-limit incident, not a throughput win.
 *   timeoutMs    — a hung call must cost one case, not the whole run. A case that times out
 *                  becomes a zero row exactly like a case that failed, which is the honest score.
 */
export interface EvalRunArgs {
  generator: string;
  variantId: string;
  cases: readonly EvalCaseRun[];
  onWorld?: (key: string, world: WorldSeed, meta: GenerationMeta) => void;
  concurrency?: number;
  timeoutMs?: number;
}

/** Run `worker` over `items`, at most `limit` at a time, preserving result order. */
export async function mapPooled<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const size = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : items.length;
  if (size >= items.length) return Promise.all(items.map((item, i) => worker(item, i)));
  const out = new Array<R>(items.length);
  let next = 0;
  const lane = async (): Promise<void> => {
    for (;;) {
      const i = next;
      next += 1;
      const item = items[i];
      if (i >= items.length || item === undefined) return;
      out[i] = await worker(item, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, lane));
  return out;
}

/**
 * Resolve `p` within `ms`, or to `null`. The abandoned promise keeps running — there is nothing
 * to cancel an in-flight HTTP request behind fourteen dependent calls — so a timed-out case may
 * still bill for what it eventually returns. The report says so; silently waiting forever is the
 * worse failure.
 */
export async function settleWithin<T>(p: Promise<T>, ms: number | undefined): Promise<T | null> {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return p;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          resolve(null);
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface EvalCaseScore {
  key: string;
  label: string;
  machine: MachineChecks;
  machineScore: number;
  judge: GJOutput["scores"];
  judgeVerdict: GJOutput["verdict"];
  judgeScore: number;
  score: number;
  passed: boolean;
  fallback: boolean;
  costUsd: number;
  latencyMs: number;
  /**
   * The generation metas this case produced. CLAUDE.md rule 5: every LLM call is logged to
   * `GenerationLog`, evaluation runs included — which is also what makes an eval run show up in
   * the §5.4 batch split of the cost dashboard. A generator whose own calls are already emitted by
   * the gateway (G9's fourteen stages) contributes only its judgement here, so nothing is logged
   * twice.
   */
  metas: GenerationMeta[];
}

export interface EvalRunResult {
  generator: string;
  variantId: string;
  cases: number;
  passed: number;
  meanScore: number;
  /** generator + judge, both at batch prices where the generator is batchable */
  costUsd: number;
  generatorCostUsd: number;
  judgeCostUsd: number;
  results: EvalCaseScore[];
}

/** What a case scores when the judge itself could not run. */
export const JUDGE_UNAVAILABLE: GJOutput = {
  scores: { inCharacter: 0, diversity: 0, humour: 0, emoji: 0, safety: 0, jpNaturalness: 0 },
  verdict: "fail",
  notes: "judge unavailable",
};

export const round = (n: number, places = 4): number => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

/** G1's absolute checks: failing one scores the case zero whatever else passed. */
export const G1_ABSOLUTE_CHECKS: readonly string[] = ["schemaValid", "notFallback", "noBannedWords"];

/**
 * Fraction of checks that passed — or zero, if any *absolute* check failed. The absolute list
 * differs per generator (G9 adds "the premise did not leak into the world"), so it is a parameter
 * with G1's list as the default: `machineScoreOf(checks)` behaves exactly as it always has.
 */
export function machineScoreOf(checks: MachineChecks, absolutes: readonly string[] = G1_ABSOLUTE_CHECKS): number {
  const values = Object.values(checks);
  if (values.length === 0) return 0;
  for (const key of absolutes) if (checks[key] === false) return 0;
  return round(values.filter(Boolean).length / values.length);
}

/** §6.2's blend: 40% machine, 60% judge, on a 0..100 scale. */
export function blendedScore(machineScore: number, judgeScore: number): number {
  return round(100 * (MACHINE_WEIGHT * machineScore + JUDGE_WEIGHT * judgeScore), 2);
}
