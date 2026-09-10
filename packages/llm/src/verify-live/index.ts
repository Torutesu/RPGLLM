/**
 * The live verification harness (`pnpm --filter llm verify:live`).
 *
 * Everything the offline gate cannot answer without an API key, packaged as one command:
 * what a world really costs, whether two premises make two worlds, whether eight characters are
 * eight people, and — as far as a machine can take it — whether the Japanese is Japanese.
 */
export { main, parseArgs, exitCodeFor, USAGE, type CliArgs, type CliIo } from "./cli.js";
export {
  createCollector,
  estimateRun,
  gemEconomics,
  preflightLive,
  runVerification,
  VerifyRefusal,
  API_KEY_ENV,
  type CostEstimate,
  type VerifyOptions,
} from "./run.js";
export { planRun, toEvalCases, isWorldGenre, CALLS_PER_WORLD, type PlanOptions, type VerifyPlan } from "./plan.js";
export {
  bilingualPanel,
  cacheHitRate,
  castDistinctnessOf,
  jaccard,
  liveEvidenceOf,
  shingles,
  stageSpend,
  textOverlap,
  totalUsage,
  CAST_OVERLAP_LIMIT,
  JA_HUMAN_CHECKLIST,
  type BilingualRow,
  type CastDistinctness,
  type LiveEvidence,
  type StageSpend,
} from "./measure.js";
export { createStubLiveGateway, stubLiveWorld, type StubGatewayOptions } from "./stub-gateway.js";
export { renderHtml } from "./report-html.js";
export { renderText, estimateBanner, table } from "./report-text.js";
export type * from "./types.js";
export { createStubDigestGateway, stubDigestPoints, type StubDigestOptions } from "./digest-stub.js";
