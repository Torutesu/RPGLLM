import { Hono } from "hono";
import { healthDbTimeoutMs } from "../env";
import { ok } from "../http";
import type { AppEnv } from "../types";
import type { PrismaClient } from "@prisma/client";

/** `SELECT 1` with a short budget — a hung pool must not hang the health probe (Agent F). */
export async function probeDb(prisma: PrismaClient, timeoutMs: number): Promise<"ok" | "down"> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      prisma.$queryRawUnsafe("SELECT 1"),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("db probe timeout")), timeoutMs); }),
    ]);
    return "ok";
  } catch {
    return "down";
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function healthRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get("/", async (c) => {
    const deps = c.get("deps");
    const db = await probeDb(deps.prisma, healthDbTimeoutMs());
    // Existing fields are unchanged; `db` is additive. A down database answers 503 so a load
    // balancer takes the instance out of rotation instead of serving 500s.
    return ok({ ok: db === "ok", llmMode: deps.gateway.mode(), champion: deps.gateway.champion(), db }, db === "ok" ? 200 : 503);
  });
  return app;
}
