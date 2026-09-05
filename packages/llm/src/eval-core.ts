import type { GenerationMeta, Locale } from "@rpgllm/shared";
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
export function machineScoreOf(
  checks: MachineChecks,
  absolutes: readonly string[] = G1_ABSOLUTE_CHECKS,
): number {
  const values = Object.values(checks);
  if (values.length === 0) return 0;
  for (const key of absolutes) if (checks[key] === false) return 0;
  return round(values.filter(Boolean).length / values.length);
}

/** §6.2's blend: 40% machine, 60% judge, on a 0..100 scale. */
export function blendedScore(machineScore: number, judgeScore: number): number {
  return round(100 * (MACHINE_WEIGHT * machineScore + JUDGE_WEIGHT * judgeScore), 2);
}
