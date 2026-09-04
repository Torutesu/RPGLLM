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

/** The historical development fallback. `assertProductionConfig()` refuses to boot with it. */
export const DEFAULT_JWT_SECRET = "dev-secret-change-me";
export const MIN_JWT_SECRET_LENGTH = 32;

export const jwtSecret = (): Uint8Array => new TextEncoder().encode(envStr("JWT_SECRET", DEFAULT_JWT_SECRET));
export const databaseUrl = (): string => envStr("DATABASE_URL", "postgresql://postgres@127.0.0.1:5432/rpgllm");
export const port = (): number => envNum("PORT", 4000);
export const llmMode = (): string => envStr("LLM_MODE", "replay");
export const testHooksEnabled = (): boolean => envStr("TEST_HOOKS", "0") === "1";
/** Defaults are the *test* adapters in dev and the real ones in production (defence in depth:
 *  `assertProductionConfig()` also refuses to boot when either is unset or set to "test"). */
export const billingMode = (): string => envStr("BILLING_MODE", isProduction() ? "revenuecat" : "test");
export const adsMode = (): string => envStr("ADS_MODE", isProduction() ? "admob" : "test");
/** SSE pacing — overridable so vitest does not wait on the 演出 delays */
export const postStreamDelayMs = (): number => envNum("STREAM_DELAY_MS", 150);
export const dmStreamDelayMs = (): number => envNum("DM_STREAM_DELAY_MS", 200);
export const modelForTier = (tier: "light" | "mid" | "high"): string =>
  tier === "high" ? envStr("LLM_MODEL_HIGH", "claude-opus-5")
    : tier === "mid" ? envStr("LLM_MODEL_MID", "claude-sonnet-5")
      : envStr("LLM_MODEL_LIGHT", "claude-haiku-4-5");

/** ---------- Agent F: environment posture ---------- */

export const nodeEnv = (): string => envStr("NODE_ENV", "development");
export const appEnv = (): string => envStr("APP_ENV", "");
/** Production is either NODE_ENV or APP_ENV — deploy targets disagree about which one they set. */
export const isProduction = (): boolean => nodeEnv() === "production" || appEnv() === "production";

/**
 * The constant dev login code (`DEV_EMAIL_CODE`) is accepted ONLY when this is on.
 * `TEST_HOOKS=1` implies it so the vitest + Playwright harnesses keep working unchanged;
 * `assertProductionConfig()` forbids both in production.
 */
export const authDevCodeEnabled = (): boolean => envStr("AUTH_DEV_CODE", "0") === "1" || testHooksEnabled();

/** One-time login codes: 6 digits, 10 minutes, 5 verify attempts. */
export const authCodeTtlMs = (): number => envNum("AUTH_CODE_TTL_MS", 10 * 60 * 1000);
export const authCodeMaxAttempts = (): number => envNum("AUTH_CODE_MAX_ATTEMPTS", 5);

/** CORS allow-list. `TEST_HOOKS=1` keeps the wildcard so the E2E harness can move the web origin. */
export const DEFAULT_CORS_ORIGINS = ["http://localhost:8081", "http://localhost:8082"] as const;
export const corsOrigins = (): string[] => {
  const raw = envStr("CORS_ORIGINS", "");
  if (!raw) return [...DEFAULT_CORS_ORIGINS];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
};
export const corsAllowAll = (): boolean => testHooksEnabled() || corsOrigins().includes("*");

/** Rate limiting. Off while TEST_HOOKS=1 unless RATE_LIMIT_ENABLED forces a value. */
export const rateLimitEnabled = (): boolean => {
  const v = envStr("RATE_LIMIT_ENABLED", "");
  if (v === "1") return true;
  if (v === "0") return false;
  return !testHooksEnabled();
};
export const rateLimitAuthPerMin = (): number => envNum("RATE_LIMIT_AUTH_PER_MIN", 5);
export const rateLimitWritePerMin = (): number => envNum("RATE_LIMIT_WRITE_PER_MIN", 20);
export const rateLimitAdPerMin = (): number => envNum("RATE_LIMIT_AD_PER_MIN", 10);
export const rateLimitDefaultPerMin = (): number => envNum("RATE_LIMIT_DEFAULT_PER_MIN", 120);

/** `/v1/health` DB probe budget. */
export const healthDbTimeoutMs = (): number => envNum("HEALTH_DB_TIMEOUT_MS", 1500);
/** How long SIGTERM waits for in-flight SSE streams before forcing the exit. */
export const shutdownGraceMs = (): number => envNum("SHUTDOWN_GRACE_MS", 10_000);
export const requestLogEnabled = (): boolean => envStr("REQUEST_LOG", "1") !== "0";
