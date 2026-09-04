import { Hono } from "hono";
import { requireAuth } from "../auth";
import { ok } from "../http";
import { checkIn } from "../services/streak";
import type { AppEnv } from "../types";

/**
 * `GET /v1/streak` — the daily check-in (SCR-010's streak card).
 *
 * The check-in also runs on the first `/v1/me` of a UTC day, so this endpoint is idempotent by
 * construction: whichever call arrives first pays the ladder, the rest report `claimedToday`.
 */
export function streakRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    return ok(await checkIn(deps.prisma, deps.clock, user.id));
  });

  return app;
}
