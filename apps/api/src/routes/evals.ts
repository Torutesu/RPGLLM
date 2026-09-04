import { Hono } from "hono";
import { EvalCompareResZ, EvalRunsResZ, StartEvalReqZ } from "@rpgllm/shared";
import { fail, ok, parseBody } from "../http";
import { compareEvals, listEvalRuns, seedEvalCases, startEvalRun } from "../services/evals";
import { loadArms } from "../services/bandit";
import { costAccessAllowed } from "./cost";
import type { AppEnv } from "../types";

/**
 * §6.2 — the offline evaluation gate's API.
 *
 *   GET  /v1/evals?generator=G1     the runs, newest first
 *   POST /v1/evals/run              start one run for one variant (StartEvalReqZ, `limit` capped)
 *   GET  /v1/evals/compare?generator=G1   the comparison table + the gate verdict per variant
 *   POST /v1/evals/seed             (re)build the frozen case set
 *
 * Admin-gated exactly like `/v1/cost` and `/v1/bandit`: an eval run spends money.
 */
export function evalRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    if (!costAccessAllowed(c.req.header("x-admin-token"))) return fail("NOT_FOUND", "No such route", 404);
    await next();
  });

  app.get("/", async (c) => {
    const deps = c.get("deps");
    const generator = c.req.query("generator");
    const runs = await listEvalRuns(deps.prisma, generator === undefined || generator === "" ? undefined : generator);
    return ok(EvalRunsResZ.parse({ runs }));
  });

  app.get("/compare", async (c) => {
    const deps = c.get("deps");
    const generator = c.req.query("generator") ?? "G1";
    const arms = await loadArms(deps.prisma, generator);
    const champion = arms.find((a) => a.isChampion)?.variantId ?? null;
    const table = await compareEvals(deps.prisma, generator, champion);
    return ok(EvalCompareResZ.parse(table));
  });

  app.post("/seed", async (c) => {
    const deps = c.get("deps");
    return ok(await seedEvalCases(deps.prisma));
  });

  app.post("/run", async (c) => {
    const deps = c.get("deps");
    const body = await parseBody(c.req, StartEvalReqZ);
    if (!body.ok) return body.res;
    const { runId, result, status } = await startEvalRun(deps, {
      generator: body.value.generator,
      variantId: body.value.variantId,
      limit: body.value.limit,
    });
    return ok({
      runId,
      status,
      generator: body.value.generator,
      variantId: body.value.variantId,
      cases: result?.cases ?? 0,
      passed: result?.passed ?? 0,
      meanScore: result?.meanScore ?? 0,
      costUsd: result?.costUsd ?? 0,
      generatorCostUsd: result?.generatorCostUsd ?? 0,
      judgeCostUsd: result?.judgeCostUsd ?? 0,
    });
  });

  return app;
}
