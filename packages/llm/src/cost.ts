import { BATCH_DISCOUNT, PRICING, type Usage } from "@rpgllm/shared";

const ZERO = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;

export interface PriceOptions {
  /**
   * Batch tier (cost-architecture §5.4). The 50% discount applies to **every** token of a
   * batched request — input, output, cache reads and cache writes alike.
   */
  batch?: boolean;
}

/**
 * USD cost of one call. `model` is the *billed* model id. In replay mode the gateway passes
 * the would-be model id so the $/action dashboard keeps working without an API key, while
 * `meta.model` still reports "replay".
 * Unknown model ids price at 0 instead of throwing (the gateway must never throw).
 */
export function priceOf(model: string, usage: Usage, opts: PriceOptions = {}): number {
  const p = PRICING[model] ?? ZERO;
  const multiplier = opts.batch === true ? BATCH_DISCOUNT : 1;
  const usd =
    ((usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheReadTokens * p.cacheRead +
      usage.cacheWriteTokens * p.cacheWrite) *
      multiplier) /
    1_000_000;
  return Math.max(0, Math.round(usd * 1e9) / 1e9);
}

export const EMPTY_USAGE: Usage = {
  inputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
};

/**
 * The batch marker. `GenerationLog` has no `batched` column and `packages/shared` is frozen, so a
 * batched call is marked by prefixing its `stopReason`: `end_turn` -> `batch:end_turn`,
 * `replay` -> `batch:replay`, `error` -> `batch:error`. Everything that reads a stop reason must
 * therefore compare `baseStopReason(...)`, and anything that wants the batch split filters on the
 * prefix. (Chosen over `variantId` because the bandit and the cost dashboard both join arms on
 * `variantId` — a decorated id would split every arm in two.)
 */
export const BATCH_STOP_PREFIX = "batch:";

export function batchStopReason(reason: string): string {
  return reason.startsWith(BATCH_STOP_PREFIX) ? reason : `${BATCH_STOP_PREFIX}${reason}`;
}

export function isBatchStopReason(reason: string): boolean {
  return reason.startsWith(BATCH_STOP_PREFIX);
}

/** `batch:error` -> `error`; anything else unchanged. */
export function baseStopReason(reason: string): string {
  return reason.startsWith(BATCH_STOP_PREFIX) ? reason.slice(BATCH_STOP_PREFIX.length) : reason;
}
