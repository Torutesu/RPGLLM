import { ReviewDigestZ, type GenerationMeta, type Locale, type WorldSeed } from "@rpgllm/shared";
import { machineScoreOf, mapPooled, round, EVAL_PASS_SCORE, type MachineChecks } from "./eval-core.js";
import { caseWorld, type DigestEvalCaseSpec } from "./eval-cases-digest.js";
import {
  isGrounded,
  screenPassage,
  worldHaystack,
  CONFIDENCES,
  DIGEST_RULES,
  type DigestConfidence,
  type DigestRule,
  type ReviewPoint,
} from "./generators/g9/digest-offline.js";
import {
  readsAsVerdict,
  DIGEST_CONCERN_MAX,
  DIGEST_EVIDENCE_MAX,
  DIGEST_EVIDENCE_MIN,
  DIGEST_MAX_PER_RULE,
  DIGEST_MAX_POINTS,
} from "./generators/g9/digest.js";
import {
  reviewDigest,
  type DigestCoverage,
  type DigestModelStatus,
  type ReviewDigest,
  type ReviewDigestGateway,
} from "./generators/g9/digest-run.js";

/**
 * The review digest in the offline gate (cost-architecture §6.2, docs/moderation.md §3).
 *
 * G9 is gated on 40% measurement and 60% LLM judge, because a world has no right answer. **A
 * digest does.** Each case in `eval-cases-digest.ts` is a world we built and then damaged in one
 * named place, so "did it find the thing" is decidable by a machine, and "is what it said
 * checkable" is decidable by a machine, and those two are the whole quality question. Paying Opus
 * on the batch tier to have an opinion on top of a ground truth would add cost and noise to a
 * measurement that is already exact, so **this gate has no judge** and its score is the machine
 * score alone. That is a deliberate difference from `eval-g9.ts` and not an omission.
 *
 * ## The checks
 *
 * Four are **absolute** — failing one scores the case zero however well it did on the rest —
 * because each of them is a way for the digest to make a reviewer's job *worse* rather than
 * shorter:
 *
 *   `evidenceGrounded`  a point citing a passage the world does not contain. This is the failure
 *                       the whole design is built against: a reviewer who cannot check a claim has
 *                       not been given a shortcut, they have been given something to believe. It
 *                       is caught here by a machine and not by a reviewer noticing.
 *   `noVerdictLanguage` a point that decides. The digest has no authority to approve or reject and
 *                       must not sound as though it does.
 *   `emptyIsExplicit`   `points` empty with a `generatedAt` set (or the reverse). Silence has to
 *                       be legible as silence; a timestamp over an empty list reads as a pass.
 *   `foundExpected`     a planted defect the digest walked past. Vacuous on the clean cases.
 *
 * The rest are scored but not fatal: staying inside the caps, staying inside the taxonomy, the
 * confidence ladder, keeping the digest's own voice free of scaffolding, and staying quiet about
 * worlds that are not damaged.
 */

/* ------------------------------------------------------------------- checks ---- */

/** Failing one of these scores the case zero. */
export const DIGEST_ABSOLUTE_CHECKS: readonly string[] = [
  "evidenceGrounded",
  "noVerdictLanguage",
  "emptyIsExplicit",
  "foundExpected",
];

/** Markers that mean the digest is repeating our plumbing in its own voice rather than quoting it. */
const SELF_INSTRUCTION_MARKERS: readonly string[] = [
  "# TASK",
  "# ROLE",
  "<<<PREMISE",
  "PREMISE>>>",
  "system prompt:",
  "```",
];

const RULE_SET: ReadonlySet<string> = new Set(DIGEST_RULES);
const CONFIDENCE_SET: ReadonlySet<string> = new Set(CONFIDENCES);

/**
 * May this point be `high`?
 *
 * Only `original` is constrained, and only in one direction: a `high` original point has to be a
 * **literal entity match** — the passage itself contains the name — because no passage can
 * establish a resemblance. This is the machine-side statement of the cap `postprocess` applies to
 * model output, checked here against the finished digest so it holds no matter who produced it.
 */
export function confidenceAllowed(point: ReviewPoint, locale: Locale): boolean {
  if (point.rule !== "original" || point.confidence !== "high") return true;
  return screenPassage(point.evidence, locale).category === "real_person";
}

export interface DigestChecksArgs {
  world: WorldSeed;
  digest: ReviewDigest | null;
  expect: readonly DigestRule[];
  locale: Locale;
}

/** Every check, as booleans, for one case. */
export function machineChecksDigest(args: DigestChecksArgs): MachineChecks {
  const { world, digest, expect, locale } = args;
  if (digest === null) return { ...ZERO_CHECKS };
  const haystack = worldHaystack(world);
  const points = digest.points;
  const rules = new Set(points.map((p) => p.rule));
  const perRule = new Map<string, number>();
  for (const p of points) perRule.set(p.rule, (perRule.get(p.rule) ?? 0) + 1);

  return {
    schemaValid: ReviewDigestZ.safeParse(digest).success,
    evidenceGrounded: points.every((p) => isGrounded(p.evidence, haystack)),
    noVerdictLanguage: points.every((p) => !readsAsVerdict(p.concern)),
    emptyIsExplicit: (points.length === 0) === (digest.generatedAt === null),
    foundExpected: expect.every((r) => rules.has(r)),
    rulesInTaxonomy:
      points.every((p) => RULE_SET.has(p.rule)) && points.every((p) => CONFIDENCE_SET.has(p.confidence)),
    boundedSize:
      points.length <= DIGEST_MAX_POINTS &&
      [...perRule.values()].every((n) => n <= DIGEST_MAX_PER_RULE) &&
      points.every(
        (p) =>
          p.concern.length > 0 &&
          p.concern.length <= DIGEST_CONCERN_MAX &&
          p.evidence.length >= DIGEST_EVIDENCE_MIN &&
          p.evidence.length <= DIGEST_EVIDENCE_MAX,
      ),
    confidenceLadder: points.every((p) => confidenceAllowed(p, locale)),
    noSelfInstruction: points.every((p) => !SELF_INSTRUCTION_MARKERS.some((m) => p.concern.includes(m))),
    quietWhenClean: expect.length > 0 || points.length === 0,
  };
}

const ZERO_CHECKS: MachineChecks = {
  schemaValid: false,
  evidenceGrounded: false,
  noVerdictLanguage: false,
  emptyIsExplicit: false,
  foundExpected: false,
  rulesInTaxonomy: false,
  boundedSize: false,
  confidenceLadder: false,
  noSelfInstruction: false,
  quietWhenClean: false,
};

/* --------------------------------------------------------------- the run ---- */

export interface DigestCaseScore {
  key: string;
  label: string;
  note: string;
  expect: readonly DigestRule[];
  machine: MachineChecks;
  machineScore: number;
  /** 0..100. The machine score alone — this gate has no judge; see the header. */
  score: number;
  passed: boolean;
  points: ReviewPoint[];
  /** expected rules the digest raised, and the ones it did not */
  hit: DigestRule[];
  missed: DigestRule[];
  /** rules it raised that this case did not plant */
  unexpected: DigestRule[];
  model: DigestModelStatus;
  measuredCount: number;
  modelCount: number;
  coverage: DigestCoverage;
  costUsd: number;
  latencyMs: number;
  metas: GenerationMeta[];
}

export interface DigestEvalResult {
  generator: string;
  variantId: string;
  cases: number;
  passed: number;
  meanScore: number;
  /** planted rules raised / planted rules total */
  recall: number;
  /** points on a planted rule / all points, over every case — a clean case's every point is noise */
  precision: number;
  /** clean cases that stayed quiet, and how many clean cases there are */
  quiet: number;
  cleanCases: number;
  /** how the run's points were distributed over the ladder; all-one-level is the failure to watch */
  confidence: Record<DigestConfidence, number>;
  costUsd: number;
  results: DigestCaseScore[];
}

export interface DigestEvalArgs {
  variantId: string;
  cases: readonly DigestEvalCaseSpec[];
  /** the `generatedAt` every digest in this run is stamped with. Nothing here reads a clock. */
  at: string;
  concurrency?: number;
  timeoutMs?: number;
}

/**
 * Run the digest case set. Works against the real gateway, against `createStubDigestGateway`, and
 * in replay mode against nothing at all — in which case the digests are the deterministic half and
 * the table says so (`model: "skipped"` on every row).
 */
export async function runEvalDigest(
  gateway: ReviewDigestGateway,
  args: DigestEvalArgs,
): Promise<DigestEvalResult> {
  const built = await mapPooled(args.cases, args.concurrency ?? args.cases.length, async (spec) => {
    const world = caseWorld(spec);
    const res = await reviewDigest(gateway, {
      world,
      premise: spec.input.premise,
      genre: spec.input.genre,
      locale: spec.input.locale,
      sampled: false,
      at: args.at,
      ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
    });
    return { spec, world, res };
  });

  const results: DigestCaseScore[] = [];
  const confidence: Record<DigestConfidence, number> = { high: 0, medium: 0, low: 0 };
  let costUsd = 0;
  let plantedRules = 0;
  let plantedHit = 0;
  let totalPoints = 0;
  let onTargetPoints = 0;
  let quiet = 0;
  let cleanCases = 0;

  for (const { spec, world, res } of built) {
    const digest = res.digest;
    const points = digest?.points ?? [];
    const raised = new Set(points.map((p) => p.rule));
    const checks = machineChecksDigest({
      world,
      digest,
      expect: spec.expect,
      locale: spec.input.locale,
    });
    const machineScore = machineScoreOf(checks, DIGEST_ABSOLUTE_CHECKS);
    const score = round(100 * machineScore, 2);
    const cost = res.meta?.costUsd ?? 0;
    costUsd += cost;

    plantedRules += spec.expect.length;
    plantedHit += spec.expect.filter((r) => raised.has(r)).length;
    totalPoints += points.length;
    onTargetPoints += points.filter((p) => spec.expect.includes(p.rule)).length;
    if (spec.expect.length === 0) {
      cleanCases += 1;
      if (points.length === 0) quiet += 1;
    }
    for (const p of points) confidence[p.confidence] += 1;

    results.push({
      key: spec.key,
      label: spec.label,
      note: spec.note,
      expect: spec.expect,
      machine: checks,
      machineScore,
      score,
      passed: score >= EVAL_PASS_SCORE && DIGEST_ABSOLUTE_CHECKS.every((k) => checks[k] === true),
      points: [...points],
      hit: spec.expect.filter((r) => raised.has(r)),
      missed: spec.expect.filter((r) => !raised.has(r)),
      unexpected: [...raised].filter((r) => !spec.expect.includes(r)),
      model: res.model,
      measuredCount: res.measuredCount,
      modelCount: res.modelCount,
      coverage: res.coverage,
      costUsd: round(cost, 8),
      latencyMs: res.meta?.latencyMs ?? 0,
      metas: res.meta === null ? [] : [res.meta],
    });
  }

  return {
    generator: "G9-digest",
    variantId: args.variantId,
    cases: results.length,
    passed: results.filter((r) => r.passed).length,
    meanScore:
      results.length === 0 ? 0 : round(results.reduce((s, r) => s + r.score, 0) / results.length, 2),
    recall: plantedRules === 0 ? 1 : round(plantedHit / plantedRules),
    precision: totalPoints === 0 ? 1 : round(onTargetPoints / totalPoints),
    quiet,
    cleanCases,
    confidence,
    costUsd: round(costUsd, 8),
    results,
  };
}
