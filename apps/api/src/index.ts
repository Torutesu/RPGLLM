import { serve } from "@hono/node-server";
import { PrismaClient } from "@prisma/client";
import { createApp } from "./app";
import { createClock } from "./clock";
import { assertProductionConfig } from "./config-guard";
import { loadEnvFile } from "./env-file";
import { loadGateway } from "./llm-loader";
import {
  adsMode, authDevCodeEnabled, billingMode, corsAllowAll, corsOrigins, isProduction, llmMode, nodeEnv,
  port, rateLimitEnabled, shutdownGraceMs, testHooksEnabled,
} from "./env";
import { logLine } from "./middleware/request-log";
import { banditAllocate, refreshAllocatorSnapshot } from "./services/bandit";

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
  const app = createApp({ prisma, gateway, clock });
  const p = port();

  logLine({
    level: "info", msg: "api.start", nodeEnv: nodeEnv(), production: isProduction(),
    envFiles: applied, llm: `${gateway.mode()} (${source})`, envLlmMode: llmMode(),
    billing: billingMode(), ads: adsMode(), testHooks: testHooksEnabled(),
    devLoginCode: authDevCodeEnabled(), rateLimit: rateLimitEnabled(), banditArms: arms,
    cors: corsAllowAll() ? "*" : corsOrigins().join(","), port: p,
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
