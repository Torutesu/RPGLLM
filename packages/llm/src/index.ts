/**
 * @rpgllm/llm — the only module that talks to an LLM.
 *
 * Public surface used by apps/api (`src/llm-loader.ts` imports this namespace):
 *   createGateway(opts) -> Gateway   (g1/g4/g5/g7/g8, assignments, champion, mode, setMode)
 *   loadWorldSeeds()    -> WorldSeed[]
 *   estimateTokens(text) -> number
 *
 * Contract: generator methods NEVER throw. On any failure (fail mode, API error, invalid JSON
 * after one retry, refusal) they return a deterministic fallback output with
 * `meta.fallback = true` and `meta.stopReason` in {"error","refusal","invalid_json"}. apps/api
 * refunds energy and emits a `fallback` SSE event when `meta.fallback` is true.
 * In replay mode outputs are deterministic for a given (worldSlug, locale, seed).
 */
export type {
  LlmMode,
  Gateway,
  GatewayOptions,
  RunOptions,
  BatchItem,
  BatchOutcome,
  BatchResults,
  AnyBatchItem,
  AnyBatchOutcome,
} from "./gateway.js";
export { createGateway, isBatchable } from "./gateway.js";

export { loadWorldSeeds, worldSeed } from "./worlds/index.js";
export { estimateTokens, fnv1a, pick, pickFrom } from "./tokens.js";
export { priceOf, EMPTY_USAGE, BATCH_STOP_PREFIX, batchStopReason, isBatchStopReason, baseStopReason } from "./cost.js";
export { bareHandle, HANDLE_RE } from "./handles.js";

export {
  GENERATOR_EXPERIMENTS,
  PRODUCT_EXPERIMENTS,
  assignmentsFor,
  championVariants,
  escalateTier,
  modelForTier,
  variantFor,
  type GeneratorVariant,
  type GeneratorExperiment,
} from "./experiments.js";

export { GLOBAL_STYLE, SAFETY_POLICY, SAFETY_CATEGORIES } from "./prompts/global.js";
export type { RenderedPrompt } from "./prompts/render.js";
export type { GeneratorSpec } from "./types.js";

export {
  g1,
  g2,
  g4,
  g5,
  g7,
  g8,
  g10,
  gj,
  blockedPhrase,
  softenTerm,
  classifyOffline,
  ambientPoolFor,
  judgeScore01,
  scoreCandidateOffline,
  candidateLines,
  G2InputZ,
  G2OutputZ,
  G10InputZ,
  G10OutputZ,
  GJInputZ,
  GJOutputZ,
  GJ_AXES,
  GJ_WEIGHTS,
  GJ_RUBRIC,
  GJ_CRITERIA,
} from "./generators/index.js";
export type { G2Input, G2Output, G10Input, G10Output, GJInput, GJOutput, GJAxis } from "./generators/index.js";
export {
  buildBatchBody,
  chunkRequests,
  sanitizeCustomId,
  batchMaxRequests,
  BATCH_MAX_REQUESTS,
  type BatchApiRequest,
  type BatchEntryStatus,
} from "./modes/batch.js";
export { buildRequest, refusalFallbacksEnabled, REFUSAL_FALLBACK_BETA, type LiveRequest } from "./modes/live.js";
export { replayG1, replayG2, replayG4, replayG5, replayG7, replayG8, replayG10, replayGJ, isNegative } from "./modes/replay.js";
export { worldFixture, characterFixture, allFixtures } from "./fixtures/index.js";
export { GeneratorFailure } from "./errors.js";

/* Cost engine — Batch tier (§5.4), Thompson sampling (§6.3), offline eval gate (§6.2) */
export {
  allocate,
  betaSample,
  clamp01,
  credibleInterval,
  dayKey,
  foldReward,
  gammaSample,
  guardrailBreach,
  leaderOf,
  mulberry32,
  pBestByArm,
  posteriorMean,
  promotionDecision,
  qualityOf,
  rewardFor,
  seedFrom,
  GUARDRAIL_MIN_CALLS,
  UNRATED_QUALITY_PRIOR,
  type ArmMetrics,
  type ArmState,
  type CallSignals,
  type GuardrailBreach,
  type PromotionDecision,
} from "./bandit.js";

export {
  evaluateGate,
  judgeContext,
  machineChecksG1,
  machineScoreOf,
  runEval,
  EVAL_PASS_SCORE,
  JUDGE_WEIGHT,
  MACHINE_WEIGHT,
  type EvalCaseRun,
  type EvalCaseScore,
  type EvalRunResult,
  type GateInput,
  type GateVerdict,
  type MachineChecks,
} from "./eval.js";

export {
  buildG1Case,
  frozenEvalCases,
  HARD_CASES,
  type EvalCaseSpec,
} from "./eval-cases.js";

export {
  runAmbientRefillBatched,
  runMemoryConsolidationBatched,
  runOfflineDirectorBatched,
  runJudgeBatched,
  BATCH_JOBS,
  type BatchJobName,
} from "./batch-jobs.js";
