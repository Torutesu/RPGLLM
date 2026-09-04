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
  else if (secret === DEFAULT_JWT_SECRET) problems.push(`JWT_SECRET is the known development default ("${DEFAULT_JWT_SECRET}")`);
  else if (secret.length < MIN_JWT_SECRET_LENGTH) problems.push(`JWT_SECRET is shorter than ${MIN_JWT_SECRET_LENGTH} characters`);

  if (env.AUTH_DEV_CODE === "1") problems.push("AUTH_DEV_CODE=1 accepts the constant dev login code for every account");
  if (env.TEST_HOOKS === "1") problems.push("TEST_HOOKS=1 exposes /__test/* (database reset, time travel, energy grants)");
  if (env.BILLING_MODE === "test") problems.push("BILLING_MODE=test lets anyone grant themselves a subscription");
  if (env.ADS_MODE === "test") problems.push("ADS_MODE=test accepts the constant TEST_AD_TOKEN as an ad reward proof");

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
