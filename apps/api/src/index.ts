import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { PrismaClient } from "@prisma/client";
import { createApp } from "./app";
import { createClock } from "./clock";
import { loadGateway } from "./llm-loader";
import { adsMode, billingMode, llmMode, port, testHooksEnabled } from "./env";

/** Minimal .env loader: repo-root `.env` first, then `.env.example` for defaults. Never overrides real env. */
function loadEnvFile(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const file of [".env", ".env.example"]) {
    const path = resolve(here, "../../..", file);
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

async function main(): Promise<void> {
  loadEnvFile();
  const prisma = new PrismaClient();
  const clock = createClock();
  const { gateway, source } = await loadGateway();
  if (source === "fake") {
    console.warn("[api] running with the built-in FakeGateway — @rpgllm/llm is not implemented yet");
  }
  const app = createApp({ prisma, gateway, clock });
  const p = port();
  console.log(`[api] llm=${gateway.mode()} (${source}) billing=${billingMode()} ads=${adsMode()} testHooks=${testHooksEnabled() ? "on" : "off"} env.LLM_MODE=${llmMode()}`);
  serve({ fetch: app.fetch, port: p }, () => console.log(`api listening on :${p}`));
}

main().catch((err: unknown) => {
  console.error("[api] failed to start", err);
  process.exit(1);
});
