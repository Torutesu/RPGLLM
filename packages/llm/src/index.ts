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
export type { LlmMode, Gateway, GatewayOptions, RunOptions } from "./gateway.js";
export { createGateway } from "./gateway.js";

export { loadWorldSeeds, worldSeed } from "./worlds/index.js";
export { estimateTokens, fnv1a, pick, pickFrom } from "./tokens.js";
export { priceOf, EMPTY_USAGE } from "./cost.js";
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

export { g1, g4, g5, g7, g8, blockedPhrase, softenTerm, classifyOffline } from "./generators/index.js";
export { buildRequest, refusalFallbacksEnabled, REFUSAL_FALLBACK_BETA, type LiveRequest } from "./modes/live.js";
export { replayG1, replayG4, replayG5, replayG7, replayG8, isNegative } from "./modes/replay.js";
export { worldFixture, characterFixture, allFixtures } from "./fixtures/index.js";
export { GeneratorFailure } from "./errors.js";
