import { Hono } from "hono";
import { COST_DASHBOARD } from "@rpgllm/shared";
import { testHooksEnabled } from "../env";
import { adminAuthorized } from "../services/admin-identity";
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
 *   - `x-admin-token` equal to a per-reviewer secret in `ADMIN_TOKENS`, or to the shared
 *     `ADMIN_TOKEN` (either must be set and non-empty).
 * Anything else answers **404**, the same body `app.notFound` produces, so an unauthenticated
 * scanner cannot tell the route exists. `ADMIN_TOKEN` is read lazily through `env.ts` here
 * rather than added to `src/env.ts`, which Agent F owns.
 */


export function costAccessAllowed(presentedToken: string | undefined): boolean {
  if (testHooksEnabled()) return true;
  // Per-reviewer secrets (`ADMIN_TOKENS`) open this too: an operator who can be revoked
  // individually is the point, and the cost dashboard is read by the same people.
  return adminAuthorized(presentedToken);
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
