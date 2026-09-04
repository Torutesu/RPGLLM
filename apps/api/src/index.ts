import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { PrismaClient } from "@prisma/client";
import { createApp } from "./app";
import { createClock } from "./clock";
import { assertProductionConfig } from "./config-guard";
import { loadGateway } from "./llm-loader";
import {
  adsMode, authDevCodeEnabled, billingMode, corsAllowAll, corsOrigins, isProduction, llmMode, nodeEnv,
  port, rateLimitEnabled, shutdownGraceMs, testHooksEnabled,
} from "./env";
import { logLine } from "./middleware/request-log";

/**
 * Minimal .env loader: repo-root `.env` first, then `.env.example` for defaults.
 * S0-3: `.env.example` carries development secrets (`JWT_SECRET=dev-secret-change-me`,
 * `AUTH_DEV_CODE=1`, test billing/ads) — in production it is never read. Real environment
 * variables always win over both files.
 */
function loadEnvFile(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const files = isProduction() ? [".env"] : [".env", ".env.example"];
  const applied: string[] = [];
  for (const file of files) {
    const path = resolve(here, "../../..", file);
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    let count = 0;
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
      if (process.env[key] === undefined) { process.env[key] = value; count += 1; }
    }
    applied.push(`${file} (+${count})`);
  }
  return applied;
}

async function main(): Promise<void> {
  const applied = loadEnvFile();
  // Fatal if production is misconfigured (S0-2). Runs after the env files so a `.env` counts.
  assertProductionConfig(process.env);

  const prisma = new PrismaClient();
  const clock = createClock();
  const { gateway, source } = await loadGateway();
  if (source === "fake") {
    console.warn("[api] running with the built-in FakeGateway — @rpgllm/llm is not implemented yet");
  }
  const app = createApp({ prisma, gateway, clock });
  const p = port();

  logLine({
    level: "info", msg: "api.start", nodeEnv: nodeEnv(), production: isProduction(),
    envFiles: applied, llm: `${gateway.mode()} (${source})`, envLlmMode: llmMode(),
    billing: billingMode(), ads: adsMode(), testHooks: testHooksEnabled(),
    devLoginCode: authDevCodeEnabled(), rateLimit: rateLimitEnabled(),
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
