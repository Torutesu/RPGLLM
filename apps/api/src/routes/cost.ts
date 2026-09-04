import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import { COST_DASHBOARD } from "@rpgllm/shared";
import { testHooksEnabled, adminToken } from "../env";
import { fail, ok } from "../http";
import { costLive, costReport, costWindow } from "../services/cost";
import type { AppEnv } from "../types";

/**
 * S3-5 — the cost dashboard's read API (cost-architecture §6.4).
 *
 *   GET /v1/cost/summary?days=7   full report (CostSummaryResZ + ttft/variants/alarms)
 *   GET /v1/cost/live             the last hour, shaped for an uptime probe
 *
 * **Access.** These endpoints expose spend and user counts for the whole product, so they are not
 * behind `requireAuth` (any signed-up user would qualify) — they are admin-only:
 *   - open while `TEST_HOOKS=1` (vitest + Playwright), or
 *   - `x-admin-token` equal to the `ADMIN_TOKEN` env var (which must be set and non-empty).
 * Anything else answers **404**, the same body `app.notFound` produces, so an unauthenticated
 * scanner cannot tell the route exists. `ADMIN_TOKEN` is read lazily through `env.ts` here
 * rather than added to `src/env.ts`, which Agent F owns.
 */


/** Constant-time compare that does not leak the length through an early return. */
function tokenMatches(presented: string, expected: string): boolean {
  if (expected === "" || presented === "") return false;
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // still burn a comparison so the failure costs the same as a wrong-value one
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function costAccessAllowed(presentedToken: string | undefined): boolean {
  if (testHooksEnabled()) return true;
  return tokenMatches(presentedToken ?? "", adminToken());
}

export function costRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    if (!costAccessAllowed(c.req.header("x-admin-token"))) return fail("NOT_FOUND", "No such route", 404);
    await next();
  });

  app.get("/summary", async (c) => {
    const deps = c.get("deps");
    const raw = Number(c.req.query("days") ?? COST_DASHBOARD.DEFAULT_DAYS);
    const w = costWindow(deps.clock.now(), Number.isFinite(raw) ? raw : COST_DASHBOARD.DEFAULT_DAYS);
    const report = await costReport(deps.prisma, w);
    return ok({ ...report, days: w.days });
  });

  app.get("/live", async (c) => {
    const deps = c.get("deps");
    return ok(await costLive(deps.prisma, deps.clock.now()));
  });

  return app;
}
