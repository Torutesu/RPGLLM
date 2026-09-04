import type { z } from "zod";
import type { FeedItemCtxZ, RelationshipCtxZ } from "@rpgllm/shared";
import type { GeneratorId, ModelTier } from "@rpgllm/shared";
import type { RenderedPrompt } from "./prompts/render.js";

/** Context pieces that packages/shared declares as schemas but not as exported TS types. */
export type FeedItemCtx = z.infer<typeof FeedItemCtxZ>;
export type RelationshipCtx = z.infer<typeof RelationshipCtxZ>;
export type { CharacterCard, PersonaState } from "@rpgllm/shared";

/**
 * One generator = one prompt + one schema + one deterministic fallback.
 * `packages/llm` never has a code path that produces "nothing"; the fallback is always ready.
 */
export interface GeneratorSpec<TIn, TOut> {
  id: GeneratorId;
  /** max_tokens backstop only — output length is controlled by the prompt (cost-architecture 3.2) */
  maxTokens: number;
  defaultTier: ModelTier;
  schema: z.ZodType<TOut>;
  render(input: TIn): RenderedPrompt;
  fallback(input: TIn): TOut;
  /**
   * Structural repair applied to every candidate output, live or replay:
   * drop unknown handles, clamp lengths, enforce minimums.
   * Returning `null` means "unsalvageable" and the gateway uses `fallback` instead.
   */
  postprocess(raw: TOut, input: TIn): TOut | null;
}
