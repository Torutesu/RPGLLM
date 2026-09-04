import { PRICING, type Usage } from "@rpgllm/shared";

const ZERO = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;

/**
 * USD cost of one call. `model` is the *billed* model id. In replay mode the gateway passes
 * the would-be model id so the $/action dashboard keeps working without an API key, while
 * `meta.model` still reports "replay".
 * Unknown model ids price at 0 instead of throwing (the gateway must never throw).
 */
export function priceOf(model: string, usage: Usage): number {
  const p = PRICING[model] ?? ZERO;
  const usd =
    (usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheReadTokens * p.cacheRead +
      usage.cacheWriteTokens * p.cacheWrite) /
    1_000_000;
  return Math.max(0, Math.round(usd * 1e9) / 1e9);
}

export const EMPTY_USAGE: Usage = {
  inputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
};
