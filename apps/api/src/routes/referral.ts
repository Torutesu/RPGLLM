import { Hono } from "hono";
import { RedeemReferralReqZ } from "@rpgllm/shared";
import { requireAuth } from "../auth";
import { fail, ok, parseBody } from "../http";
import { redeemReferral, referralStats } from "../services/referral";
import type { AppEnv } from "../types";

/** SCR-041 — invite a friend, both sides get a coffee (S2-5). */
export function referralRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    return ok(await referralStats(deps.prisma, deps.clock, user));
  });

  app.post("/redeem", requireAuth, async (c) => {
    const body = await parseBody(c.req, RedeemReferralReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const user = c.get("user");
    const outcome = await redeemReferral(deps.prisma, deps.clock, user, body.value.code);
    if (!outcome.ok) {
      const status = outcome.code === "NOT_FOUND" ? 404 : outcome.code === "ALREADY_DONE" ? 409 : 400;
      return fail(outcome.code, outcome.message, status);
    }
    return ok({ coffee: outcome.coffee, energy: outcome.energy });
  });

  return app;
}
