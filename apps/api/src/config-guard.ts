/**
 * Startup posture check (Agent F, S0-2).
 *
 * Production must never boot with a development secret or with any of the test/dev escape
 * hatches enabled. Called from `index.ts` before the server starts listening; a violation is
 * fatal on purpose — a half-secure API is worse than a down one.
 */
import { DEFAULT_JWT_SECRET, MIN_JWT_SECRET_LENGTH } from "./env";

export interface ConfigEnv {
  NODE_ENV?: string | undefined;
  APP_ENV?: string | undefined;
  JWT_SECRET?: string | undefined;
  AUTH_DEV_CODE?: string | undefined;
  TEST_HOOKS?: string | undefined;
  BILLING_MODE?: string | undefined;
  ADS_MODE?: string | undefined;
  LLM_MODE?: string | undefined;
  ANTHROPIC_API_KEY?: string | undefined;
  CORS_ORIGINS?: string | undefined;
  ADMIN_TOKEN?: string | undefined;
  ADMIN_TOKENS?: string | undefined;
  PUBLIC_APP_URL?: string | undefined;
  REVENUECAT_WEBHOOK_SECRET?: string | undefined;
  MAIL_PROVIDER?: string | undefined;
  MAIL_API_KEY?: string | undefined;
  MAIL_FROM?: string | undefined;
  LLM_DAILY_BUDGET_USD?: string | undefined;
  RATE_LIMIT_STORE?: string | undefined;
  [key: string]: string | undefined;
}

export const isProductionEnv = (env: ConfigEnv): boolean =>
  env.NODE_ENV === "production" || env.APP_ENV === "production";

/** Returns the list of production violations. Empty ⇒ safe to boot. */
export function productionConfigProblems(env: ConfigEnv): string[] {
  if (!isProductionEnv(env)) return [];
  const problems: string[] = [];

  const secret = env.JWT_SECRET ?? "";
  if (secret === "") problems.push("JWT_SECRET is not set");
  else if (secret === DEFAULT_JWT_SECRET)
    problems.push(`JWT_SECRET is the known development default ("${DEFAULT_JWT_SECRET}")`);
  else if (secret.length < MIN_JWT_SECRET_LENGTH)
    problems.push(`JWT_SECRET is shorter than ${MIN_JWT_SECRET_LENGTH} characters`);

  if (env.AUTH_DEV_CODE === "1") problems.push("AUTH_DEV_CODE=1 accepts the constant dev login code for every account");
  if (env.TEST_HOOKS === "1")
    problems.push("TEST_HOOKS=1 exposes /__test/* (database reset, time travel, energy grants)");
  if (env.BILLING_MODE === "test") problems.push("BILLING_MODE=test lets anyone grant themselves a subscription");
  else if (env.BILLING_MODE === undefined || env.BILLING_MODE === "")
    problems.push("BILLING_MODE is not set — set it explicitly (revenuecat)");
  if (env.ADS_MODE === "test") problems.push("ADS_MODE=test accepts the constant TEST_AD_TOKEN as an ad reward proof");
  else if (env.ADS_MODE === undefined || env.ADS_MODE === "")
    problems.push("ADS_MODE is not set — set it explicitly (admob)");

  /*
   * Everything below was added in the production-readiness pass, and every one of them is a way
   * this service could already boot in production and be quietly broken rather than loudly down.
   * The rule for what belongs here: a misconfiguration that a health check cannot see, that no
   * test can catch (because it is the *deployment* that is wrong, not the code), and that a real
   * user or a real invoice pays for.
   */

  // Fixtures served to paying users. `/v1/health` reports `llmMode`, so this is visible — but only
  // to somebody who thought to look, and the first symptom is every player in the world reading
  // the same three replies.
  const llm = env.LLM_MODE ?? "";
  if (llm !== "live") {
    problems.push(`LLM_MODE=${llm || "(unset)"} serves canned fixtures — production must be "live"`);
  } else if ((env.ANTHROPIC_API_KEY ?? "") === "") {
    problems.push("LLM_MODE=live without ANTHROPIC_API_KEY — every generation will fail to the fallback path");
  }

  // A wildcard origin plus a bearer token in localStorage is a cross-origin read of authenticated
  // JSON. `corsAllowAll()` also honours TEST_HOOKS, which is refused above.
  const cors = (env.CORS_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  if (cors.includes("*")) problems.push("CORS_ORIGINS contains * — any origin can read authenticated JSON");
  if (cors.length === 0) problems.push("CORS_ORIGINS is not set — the app's own origins must be listed explicitly");

  // Nobody can review a world without it, and a world that is never reviewed never reaches Explore:
  // the moderation queue simply fills up while the SLA clock runs.
  if ((env.ADMIN_TOKEN ?? "") === "" && (env.ADMIN_TOKENS ?? "") === "") {
    problems.push("neither ADMIN_TOKEN nor ADMIN_TOKENS is set — no reviewer can reach the moderation queue");
  }

  // Every invite and every "Open it" on a share card is built from this. Unset, they all point at
  // the placeholder host `rpgllm.example`, which we do not own — so the links work, and they take
  // people somewhere else.
  if ((env.PUBLIC_APP_URL ?? "") === "") {
    problems.push("PUBLIC_APP_URL is not set — invites and share links would point at the placeholder host");
  }

  // The one path where an unauthenticated request grants entitlements.
  if (env.BILLING_MODE === "revenuecat" && (env.REVENUECAT_WEBHOOK_SECRET ?? "") === "") {
    problems.push(
      "BILLING_MODE=revenuecat without REVENUECAT_WEBHOOK_SECRET — a forged webhook could grant subscriptions",
    );
  }

  /*
   * Where the rate-limit buckets live. In-process is correct for exactly one instance, so this is
   * not a wrong answer — it is an answer that stops being true the day somebody adds a replica,
   * silently, in the one budget that guards accounts. Saying `memory` out loud is allowed;
   * defaulting into it in production is not.
   */
  const store = (env.RATE_LIMIT_STORE ?? "").trim().toLowerCase();
  if (store === "") {
    problems.push(
      'RATE_LIMIT_STORE is not set — "shared" survives more than one instance, "memory" says you have exactly one',
    );
  } else if (store !== "memory" && store !== "shared") {
    problems.push(`RATE_LIMIT_STORE="${env.RATE_LIMIT_STORE ?? ""}" is neither "memory" nor "shared"`);
  }

  /*
   * The day's ceiling (`services/budget.ts`). Required — not because a cap is always right, but
   * because *no cap* has to be a decision somebody typed. `unlimited` is a legitimate answer and
   * the only way to say it; an empty variable is how you find out afterwards that the number
   * should have existed.
   */
  const budget = (env.LLM_DAILY_BUDGET_USD ?? "").trim().toLowerCase();
  if (budget === "") {
    problems.push('LLM_DAILY_BUDGET_USD is not set — set a daily ceiling in USD, or "unlimited" to say so on purpose');
  } else if (budget !== "unlimited" && !(Number(budget) > 0)) {
    problems.push(
      `LLM_DAILY_BUDGET_USD="${env.LLM_DAILY_BUDGET_USD ?? ""}" is neither a positive number nor "unlimited"`,
    );
  }

  // Mail. Without a provider the login code is printed to the log: nobody outside the team can
  // sign in, and every credential the system issues is in plaintext in the log pipeline.
  const provider = (env.MAIL_PROVIDER ?? "console").trim().toLowerCase();
  if (provider === "console" || provider === "") {
    problems.push("MAIL_PROVIDER is not set — sign-in codes would only be printed to the log, so nobody can sign in");
  } else if (provider !== "resend" && provider !== "postmark") {
    problems.push(`MAIL_PROVIDER="${provider}" is not a provider this build can talk to (resend, postmark)`);
  } else {
    if ((env.MAIL_API_KEY ?? "") === "")
      problems.push("MAIL_API_KEY is not set — the mail provider will refuse every send");
    if ((env.MAIL_FROM ?? "") === "") problems.push("MAIL_FROM is not set — the mail provider will refuse every send");
  }

  return problems;
}

/** Throws with every problem listed at once (so an operator fixes them in one pass). */
export function assertProductionConfig(env: ConfigEnv = process.env): void {
  const problems = productionConfigProblems(env);
  if (problems.length === 0) return;
  throw new Error(
    `Refusing to start in production with an insecure configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}\n` +
      "See docs/deploy.md for the required production environment.",
  );
}
