import {
  EVAL_GATE,
  G1InputZ,
  G1OutputZ,
  SAFETY_BLOCK_TEST_PHRASES,
  type G1Input,
  type G1Output,
  type Locale,
} from "@rpgllm/shared";
import type { GenerationMeta } from "@rpgllm/shared";
import type { Gateway, BatchItem } from "./gateway.js";
import { judgeScore01, type GJInput, type GJOutput } from "./generators/gj.js";

/**
 * The offline evaluation gate (cost-architecture §6.2).
 *
 * A run takes the frozen case set, executes it **through the batch path** (50% off — §5.4), scores
 * every result twice, and reports one number per variant:
 *
 *   machine checks  — schema validity, K satisfied, handle validity, banned words, lengths,
 *                     emoji budget, diversity. Cheap, absolute, and the only checks that can veto.
 *   LLM judge (GJ)  — the six-axis rubric, also batched, on Opus 5. In replay mode the judge is
 *                     the deterministic heuristic in `generators/gj.ts`.
 *
 *   score = 100 x (0.4 x machine + 0.6 x judge)
 *
 * `passesEvalGate` is §6.2's rule verbatim: within `MAX_SCORE_DROP` points of the champion **and**
 * at least `MIN_COST_SAVING` cheaper, or `MIN_SCORE_GAIN` points better outright.
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
   * The generation metas this case produced (the candidate, then the judgement). CLAUDE.md rule 5:
   * every LLM call is logged to `GenerationLog`, evaluation runs included — which is also what
   * makes an eval run show up in the §5.4 batch split of the cost dashboard.
   */
  metas: GenerationMeta[];
}

export interface EvalRunResult {
  generator: string;
  variantId: string;
  cases: number;
  passed: number;
  meanScore: number;
  /** generator + judge, both at batch prices */
  costUsd: number;
  generatorCostUsd: number;
  judgeCostUsd: number;
  results: EvalCaseScore[];
}

const EMOJI_RE = /\p{Extended_Pictographic}/gu;

/** What a case scores when the judge itself could not run. */
const JUDGE_UNAVAILABLE: GJOutput = {
  scores: { inCharacter: 0, diversity: 0, humour: 0, emoji: 0, safety: 0, jpNaturalness: 0 },
  verdict: "fail",
  notes: "judge unavailable",
};

const round = (n: number, places = 4): number => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

function countEmoji(text: string): number {
  return (text.match(EMOJI_RE) ?? []).length;
}

function containsBanned(text: string): boolean {
  const haystack = text.toLowerCase();
  return SAFETY_BLOCK_TEST_PHRASES.some((p) => haystack.includes(p.toLowerCase()));
}

/**
 * G1's machine checks. `schemaValid`, `noBannedWords` and `notFallback` are absolute: failing one
 * fails the case whatever the judge thinks.
 */
export function machineChecksG1(input: G1Input, output: G1Output, fallback: boolean): MachineChecks {
  const cast = new Set(input.cast.map((c) => c.handle));
  const press = new Set(input.cast.filter((c) => c.isPressAccount).map((c) => c.handle));
  const replies = output.replies ?? [];
  const texts = replies.map((r) => r.text);
  const openings = new Set(texts.map((t) => t.trim().slice(0, 8).toLowerCase()));

  return {
    schemaValid: G1OutputZ.safeParse(output).success,
    notFallback: !fallback,
    kSatisfied: replies.length === Math.max(1, Math.min(input.k, 4)),
    handlesValid:
      replies.every((r) => cast.has(r.characterHandle) && !press.has(r.characterHandle)) &&
      output.memory_notes.every((n) => cast.has(n.handle)) &&
      Object.keys(output.relationship_deltas).every((h) => cast.has(h)),
    noBannedWords: !containsBanned([...texts, output.narrative, output.news?.text ?? ""].join(" ")),
    lengthOk:
      texts.every((t) => t.length > 0 && t.length <= 280) &&
      output.narrative.length <= 240 &&
      output.memory_notes.every((n) => n.note.length <= 200),
    emojiOk: texts.every((t) => countEmoji(t) <= 2),
    diverse:
      new Set(replies.map((r) => r.characterHandle)).size === replies.length &&
      new Set(texts).size === texts.length &&
      (replies.length <= 1 || openings.size === replies.length),
    newsRespected: input.includeNews ? output.news !== null : output.news === null,
  };
}

const ABSOLUTE_CHECKS = ["schemaValid", "notFallback", "noBannedWords"] as const;

export function machineScoreOf(checks: MachineChecks): number {
  const values = Object.values(checks);
  if (values.length === 0) return 0;
  for (const key of ABSOLUTE_CHECKS) if (checks[key] === false) return 0;
  return round(values.filter(Boolean).length / values.length);
}

/** The brief the judge sees next to the candidate — never the whole world bible (that is the point). */
export function judgeContext(input: G1Input): string {
  const cast = input.cast.map((c) => `${c.handle}${c.isPressAccount ? " [press, may not reply]" : ""}`).join(", ");
  return [
    `generator: G1 reaction fan-out`,
    `locale: ${input.locale}`,
    `world: ${input.worldSlug}`,
    `player: ${input.persona.handle} — ${input.persona.voiceNotes}`,
    `allowed handles: ${cast}`,
    `K (required replies): ${input.k}`,
    `news requested: ${input.includeNews ? "yes" : "no"}`,
    `safety gate softened the post: ${input.softened ? "yes" : "no"}`,
    `the post:\n"""\n${input.post.text}\n"""`,
  ].join("\n");
}

/**
 * Run one variant against a case set, entirely on the batch tier: one batch for the generator,
 * one batch for the judge. Every case resolves — a failed generation scores 0 rather than
 * vanishing from the denominator.
 */
export async function runEval(
  gateway: Gateway,
  args: { generator: string; variantId: string; cases: readonly EvalCaseRun[] },
): Promise<EvalRunResult> {
  const parsed: Array<{ run: EvalCaseRun; input: G1Input }> = [];
  const invalid: EvalCaseRun[] = [];
  for (const c of args.cases) {
    const check = G1InputZ.safeParse(c.input);
    if (check.success) parsed.push({ run: c, input: check.data });
    else invalid.push(c);
  }

  const items: Array<BatchItem<G1Input>> = parsed.map(({ run, input }) => ({
    customId: run.key,
    input,
    opts: { variantId: args.variantId },
  }));
  const generated = await gateway.batchG1(items);

  // Second batch: the judge, one entry per generated candidate.
  const judgeItems: Array<BatchItem<GJInput>> = [];
  for (const { run, input } of parsed) {
    const outcome = generated.get(run.key);
    if (outcome === undefined) continue;
    judgeItems.push({
      customId: run.key,
      input: {
        locale: run.locale,
        generator: "G1",
        caseLabel: run.label,
        context: judgeContext(input),
        candidate: JSON.stringify(outcome.output),
      },
    });
  }
  const judged = await gateway.batchGJ(judgeItems);

  const results: EvalCaseScore[] = [];
  let generatorCostUsd = 0;
  let judgeCostUsd = 0;

  for (const { run, input } of parsed) {
    const outcome = generated.get(run.key);
    const judgeOutcome = judged.get(run.key);
    const output = outcome?.output ?? null;
    const fallback = outcome?.meta.fallback ?? true;
    generatorCostUsd += outcome?.meta.costUsd ?? 0;
    judgeCostUsd += judgeOutcome?.meta.costUsd ?? 0;

    const checks =
      output === null
        ? { schemaValid: false, notFallback: false, kSatisfied: false, handlesValid: false, noBannedWords: false, lengthOk: false, emojiOk: false, diverse: false, newsRespected: false }
        : machineChecksG1(input, output, fallback);
    const machineScore = machineScoreOf(checks);
    const judgeOut = judgeOutcome?.output ?? JUDGE_UNAVAILABLE;
    const judgeScore = judgeScore01(judgeOut);
    const score = round(100 * (MACHINE_WEIGHT * machineScore + JUDGE_WEIGHT * judgeScore), 2);
    const passed =
      score >= EVAL_PASS_SCORE && ABSOLUTE_CHECKS.every((k) => checks[k] === true) && judgeOut.verdict !== "fail";

    results.push({
      key: run.key,
      label: run.label,
      machine: checks,
      machineScore,
      judge: judgeOut.scores,
      judgeVerdict: judgeOut.verdict,
      judgeScore: round(judgeScore),
      score,
      passed,
      fallback,
      costUsd: round((outcome?.meta.costUsd ?? 0) + (judgeOutcome?.meta.costUsd ?? 0), 8),
      latencyMs: (outcome?.meta.latencyMs ?? 0) + (judgeOutcome?.meta.latencyMs ?? 0),
      metas: [outcome?.meta, judgeOutcome?.meta].filter((m): m is GenerationMeta => m !== undefined),
    });
  }

  // A case whose stored input no longer parses is a real failure of the frozen set, not a gap.
  for (const c of invalid) {
    results.push({
      key: c.key,
      label: c.label,
      machine: { schemaValid: false, notFallback: false, kSatisfied: false, handlesValid: false, noBannedWords: false, lengthOk: false, emojiOk: false, diverse: false, newsRespected: false },
      machineScore: 0,
      judge: { inCharacter: 0, diversity: 0, humour: 0, emoji: 0, safety: 0, jpNaturalness: 0 },
      judgeVerdict: "fail",
      judgeScore: 0,
      score: 0,
      passed: false,
      fallback: true,
      costUsd: 0,
      latencyMs: 0,
      metas: [],
    });
  }

  const meanScore = results.length === 0 ? 0 : round(results.reduce((s, r) => s + r.score, 0) / results.length, 2);
  return {
    generator: args.generator,
    variantId: args.variantId,
    cases: results.length,
    passed: results.filter((r) => r.passed).length,
    meanScore,
    costUsd: round(generatorCostUsd + judgeCostUsd, 8),
    generatorCostUsd: round(generatorCostUsd, 8),
    judgeCostUsd: round(judgeCostUsd, 8),
    results,
  };
}

/* -------------------------------------------------------------- the gate ---- */

export interface GateInput {
  /** mean score of this variant, 0..100 */
  score: number;
  usdPerCase: number;
  championScore: number;
  championUsdPerCase: number;
}

export interface GateVerdict {
  scoreDelta: number;
  /** fraction cheaper than the champion; negative means dearer */
  costSaving: number;
  costDelta: number;
  passesGate: boolean;
}

/** §6.2 verbatim: within 2 points and >= 20% cheaper, or >= 3 points better. */
export function evaluateGate(input: GateInput): GateVerdict {
  const scoreDelta = round(input.score - input.championScore, 2);
  const costDelta =
    input.championUsdPerCase > 0 ? round(input.usdPerCase / input.championUsdPerCase - 1) : 0;
  const costSaving = round(-costDelta);
  const cheaperAndCloseEnough =
    scoreDelta >= -EVAL_GATE.MAX_SCORE_DROP && costSaving >= EVAL_GATE.MIN_COST_SAVING;
  const clearlyBetter = scoreDelta >= EVAL_GATE.MIN_SCORE_GAIN;
  return { scoreDelta, costSaving, costDelta, passesGate: cheaperAndCloseEnough || clearlyBetter };
}
