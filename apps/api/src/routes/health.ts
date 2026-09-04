import { Hono } from "hono";
import { ok } from "../http";
import type { AppEnv } from "../types";

export function healthRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get("/", (c) => {
    const deps = c.get("deps");
    return ok({ ok: true, llmMode: deps.gateway.mode(), champion: deps.gateway.champion() });
  });
  return app;
}
