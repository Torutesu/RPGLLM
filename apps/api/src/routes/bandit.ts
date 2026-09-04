import { Hono } from "hono";
import { BanditStateResZ, PromoteReqZ } from "@rpgllm/shared";
import { fail, ok, parseBody } from "../http";
import { banditState, promoteVariant, refreshAllocatorSnapshot } from "../services/bandit";
import { costAccessAllowed } from "./cost";
import type { AppEnv } from "../types";

/**
 * §6.3 — the bandit's read API and the manual override.
 *
 *   GET  /v1/bandit            arms, posteriors, allocation, p(best), promotable
 *   POST /v1/bandit/promote    move the champion by hand (audited like an automatic promotion)
 *
 * Same admin gate as `/v1/cost` — `costAccessAllowed` — for the same reason: this is fleet-wide
 * spend and quality data, and every non-admin request must be indistinguishable from a 404.
 */
export function banditRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    if (!costAccessAllowed(c.req.header("x-admin-token"))) return fail("NOT_FOUND", "No such route", 404);
    await next();
  });

  app.get("/", async (c) => {
    const deps = c.get("deps");
    const state = await banditState(deps.prisma, deps.clock.now());
    // the contract is the source of truth for the shape; extra keys would be silently dropped
    return ok(BanditStateResZ.parse(state));
  });

  app.post("/promote", async (c) => {
    const deps = c.get("deps");
    const body = await parseBody(c.req, PromoteReqZ);
    if (!body.ok) return body.res;
    const result = await promoteVariant(deps.prisma, {
      generator: body.value.generator,
      variantId: body.value.variantId,
      reason: `manual:${body.value.reason}`,
    });
    if (result === null) return fail("NOT_FOUND", "No such arm", 404);
    await refreshAllocatorSnapshot(deps.prisma, deps.clock.now());
    return ok(result);
  });

  return app;
}
