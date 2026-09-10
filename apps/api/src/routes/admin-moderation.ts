import { Hono } from "hono";
import { testHooksEnabled } from "../env";
import { fail, ok } from "../http";
import { adminTokenMatches } from "../services/moderation";
import { moderationMetrics } from "../services/moderation-metrics";
import type { AppEnv } from "../types";

/**
 * `GET /v1/admin/moderation/metrics` — the queue as it actually behaves, next to the thresholds
 * actually in force (see `services/moderation-metrics.ts` for every definition and its limits).
 *
 * Gated exactly like the review queue it describes: open while `TEST_HOOKS=1` (vitest + Playwright),
 * otherwise an `ADMIN_TOKEN` match presented as a bearer token or `x-admin-token`. This exposes
 * report volume, decision latency and spend for the whole product, so it is admin-only rather than
 * behind `requireAuth` — any signed-up account would qualify for that.
 */
export function adminModerationRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const presented = header.toLowerCase().startsWith("bearer ")
      ? header.slice(7).trim()
      : c.req.header("x-admin-token");
    if (!testHooksEnabled() && !adminTokenMatches(presented)) return fail("UNAUTHORIZED", "Admin only", 401);
    await next();
  });

  app.get("/metrics", async (c) => {
    const deps = c.get("deps");
    return ok(await moderationMetrics(deps.prisma, deps.clock.now()));
  });

  return app;
}
