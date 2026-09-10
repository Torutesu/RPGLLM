import { serve } from "@hono/node-server";
import { PrismaClient } from "@prisma/client";
import { PRODUCT } from "@rpgllm/shared";
import { createApp } from "./app";
import { setMailSender } from "./auth-codes";
import { createClock } from "./clock";
import { assertProductionConfig } from "./config-guard";
import { loadEnvFile } from "./env-file";
import { loadGateway } from "./llm-loader";
import {
  adsMode, authCodeTtlMs, authDevCodeEnabled, billingMode, corsAllowAll, corsOrigins, isProduction,
  llmMode, nodeEnv, port, rateLimitEnabled, shutdownGraceMs, testHooksEnabled,
} from "./env";
import { logLine } from "./middleware/request-log";
import { GoogleVerifierKeys, StaticVerifierKeys, setAdMobVerifierKeys } from "./services/ad-verify";
import { banditAllocate, refreshAllocatorSnapshot } from "./services/bandit";
import { dailyBudgetUsd, withBudget } from "./services/budget";
import { mailProvider, mailSenderFromEnv } from "./services/mail";

async function main(): Promise<void> {
  const applied = loadEnvFile();
  // Fatal if production is misconfigured (S0-2). Runs after the env files so a `.env` counts.
  assertProductionConfig(process.env);

  const prisma = new PrismaClient();
  const clock = createClock();

  /**
   * Thompson sampling on (cost-architecture §6.3, Agent N). `banditAllocate` reads a cached
   * snapshot of `BanditArm` and returns the variant for this (generator, user), or `null` when the
   * bandit has nothing to say — the gateway then falls back to the deterministic 50/50 split in
   * `experiments.ts`, which is also exactly what happens on a cold database. The snapshot is warmed
   * here and refreshed by the hourly `bandit-update` job in the worker.
   */
  const { gateway, source } = await loadGateway({ allocate: banditAllocate });
  const arms = await refreshAllocatorSnapshot(prisma, clock.now()).catch((err: unknown) => {
    logLine({ level: "warn", msg: "api.bandit.snapshot.failed", error: String(err) });
    return 0;
  });
  if (source === "fake") {
    console.warn("[api] running with the built-in FakeGateway — @rpgllm/llm is not implemented yet");
  }
  /**
   * Email delivery. `mailSenderFromEnv` returns null for `MAIL_PROVIDER=console`, which leaves the
   * log-printing default in place — fine in dev, and refused outright in production by
   * `assertProductionConfig` above, so a launch cannot happen with nobody able to sign in.
   *
   * The locale lookup is what makes a returning Japanese player get a Japanese email: the address
   * is all we know at `POST /auth/email/start`, and for anyone who has signed in before it is
   * enough. A first-time address has no row and gets `en`.
   */
  const mail = mailSenderFromEnv({
    ttlMinutes: Math.round(authCodeTtlMs() / 60_000),
    localeFor: async (email: string) => {
      const row = await prisma.user.findUnique({ where: { email }, select: { locale: true } }).catch(() => null);
      return row?.locale === "ja" ? "ja" : "en";
    },
  });
  if (mail) setMailSender(mail);

  /**
   * AdMob reward verification. Without a key set `verifyAdMobSSV` fails closed and no ad ever pays
   * out — which is safe, and is also the entire free-energy loop silently switched off. An
   * operator-pinned key set (`ADMOB_VERIFIER_KEYS_JSON`) wins where one is given, because an
   * air-gapped deployment cannot reach gstatic; otherwise the published set is fetched lazily.
   */
  if (adsMode() !== "test") {
    const pinned = process.env["ADMOB_VERIFIER_KEYS_JSON"] ?? "";
    if (pinned) {
      try {
        setAdMobVerifierKeys(new StaticVerifierKeys(JSON.parse(pinned) as Record<string, string>));
      } catch (err: unknown) {
        // Fail closed and say so: a malformed pin must not silently become "fetch from Google".
        logLine({ level: "error", msg: "api.admob.keys.invalid", error: String(err).slice(0, 200) });
      }
    } else {
      setAdMobVerifierKeys(new GoogleVerifierKeys());
    }
  }

  /**
   * The day's ceiling (`services/budget.ts`). Wrapping the gateway is what makes this total: every
   * LLM call in the product goes through it by rule, so there is no second path that spends money
   * without passing here — including the jobs, which wrap it the same way in `worker.ts`.
   */
  const metered = withBudget(gateway, prisma, () => clock.now());
  const app = createApp({ prisma, gateway: metered, clock });
  const p = port();

  logLine({
    level: "info", msg: "api.start", nodeEnv: nodeEnv(), production: isProduction(),
    envFiles: applied, llm: `${gateway.mode()} (${source})`, envLlmMode: llmMode(),
    billing: billingMode(), ads: adsMode(), mail: mailProvider(), testHooks: testHooksEnabled(),
    devLoginCode: authDevCodeEnabled(), rateLimit: rateLimitEnabled(), banditArms: arms,
    cors: corsAllowAll() ? "*" : corsOrigins().join(","), port: p,
    dailyBudgetUsd: dailyBudgetUsd() ?? "unlimited",
    // Visible on every boot until somebody names the product (packages/shared → PRODUCT).
    product: PRODUCT.isPlaceholder ? `${PRODUCT.name} (placeholder)` : PRODUCT.name,
  });

  const server = serve({ fetch: app.fetch, port: p }, () => console.log(`api listening on :${p}`));

  /**
   * Graceful shutdown: stop accepting connections, let in-flight SSE streams finish (bounded by
   * SHUTDOWN_GRACE_MS, default 10s), disconnect Prisma, exit 0.
   */
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logLine({ level: "info", msg: "api.shutdown", signal, graceMs: shutdownGraceMs() });

    const finish = (forced: boolean): void => {
      void prisma.$disconnect()
        .catch((err: unknown) => { logLine({ level: "error", msg: "api.shutdown.prisma", error: String(err) }); })
        .finally(() => {
          logLine({ level: "info", msg: "api.shutdown.done", forced });
          process.exit(0);
        });
    };

    const deadline = setTimeout(() => finish(true), shutdownGraceMs());
    // Idle keep-alive sockets are dropped immediately; streaming ones get the grace period.
    const maybeIdle = (server as { closeIdleConnections?: () => void }).closeIdleConnections;
    if (typeof maybeIdle === "function") maybeIdle.call(server);
    server.close(() => { clearTimeout(deadline); finish(false); });
  };
  process.on("SIGTERM", () => { shutdown("SIGTERM"); });
  process.on("SIGINT", () => { shutdown("SIGINT"); });
}

main().catch((err: unknown) => {
  console.error("[api] failed to start", err);
  process.exit(1);
});
