/** Env access. Read lazily (not captured at import time) so tests can flip flags before creating the app. */
export const envStr = (key: string, fallback: string): string => {
  const v = process.env[key];
  return v === undefined || v === "" ? fallback : v;
};
export const envNum = (key: string, fallback: number): number => {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const jwtSecret = (): Uint8Array => new TextEncoder().encode(envStr("JWT_SECRET", "dev-secret-change-me"));
export const databaseUrl = (): string => envStr("DATABASE_URL", "postgresql://postgres@127.0.0.1:5432/rpgllm");
export const port = (): number => envNum("PORT", 4000);
export const llmMode = (): string => envStr("LLM_MODE", "replay");
export const testHooksEnabled = (): boolean => envStr("TEST_HOOKS", "0") === "1";
export const billingMode = (): string => envStr("BILLING_MODE", "test");
export const adsMode = (): string => envStr("ADS_MODE", "test");
/** SSE pacing — overridable so vitest does not wait on the 演出 delays */
export const postStreamDelayMs = (): number => envNum("STREAM_DELAY_MS", 150);
export const dmStreamDelayMs = (): number => envNum("DM_STREAM_DELAY_MS", 200);
export const modelForTier = (tier: "light" | "mid" | "high"): string =>
  tier === "high" ? envStr("LLM_MODEL_HIGH", "claude-opus-5")
    : tier === "mid" ? envStr("LLM_MODEL_MID", "claude-sonnet-5")
      : envStr("LLM_MODEL_LIGHT", "claude-haiku-4-5");
