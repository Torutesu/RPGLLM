/**
 * @rpgllm/llm — the only module that talks to an LLM.
 * Agent B implements this package. This stub defines the public surface used by apps/api.
 */
import type {
  G1Input, G1Output, G4Input, G4Output, G5Input, G5Output, G7Input, G7Output, G8Input, G8Output,
  GenerationResult, GeneratorId, ModelTier, WorldSeed,
} from "@rpgllm/shared";

export type LlmMode = "replay" | "live" | "fail";

export interface GatewayOptions {
  mode?: LlmMode;                                  // default: process.env.LLM_MODE ?? "replay"
  /** called for every generation (success, fallback, failure) — apps/api persists GenerationLog here */
  onGeneration?: (meta: GenerationResult<unknown>["meta"] & { userId: string | null; generator: GeneratorId }) => Promise<void> | void;
}
export interface RunOptions { tier?: ModelTier; variantId?: string; escalatedFrom?: string | null }

/**
 * Contract: generator methods NEVER throw. On any failure (fail mode, API error, invalid JSON after 1 retry, refusal)
 * they return a deterministic fallback output with meta.fallback=true and meta.stopReason in {"error","refusal","invalid_json"}.
 * apps/api refunds energy and emits a `fallback` SSE event when meta.fallback is true.
 * In replay mode outputs are deterministic for a given (worldSlug, locale, seed).
 */
export interface Gateway {
  mode(): LlmMode;
  setMode(mode: LlmMode): void;
  g1(input: G1Input, opts?: RunOptions): Promise<GenerationResult<G1Output>>;
  g4(input: G4Input, opts?: RunOptions): Promise<GenerationResult<G4Output>>;
  g5(input: G5Input, opts?: RunOptions): Promise<GenerationResult<G5Output>>;
  g7(input: G7Input, opts?: RunOptions): Promise<GenerationResult<G7Output>>;
  g8(input: G8Input, opts?: RunOptions): Promise<GenerationResult<G8Output>>;
  /** user-sticky experiment assignment (fixed allocation in MVP) */
  assignments(userId: string): Record<string, string>;
  champion(): Record<string, string>;
}

export declare function createGateway(opts?: GatewayOptions): Gateway;
export declare function loadWorldSeeds(): WorldSeed[];
export declare function estimateTokens(text: string): number;
