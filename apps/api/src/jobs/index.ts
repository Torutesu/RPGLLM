import { Hono } from "hono";
import { z } from "zod";
import { LOCALES } from "@rpgllm/shared";
import { testHooksEnabled } from "../env";
import { fail, ok, parseBody } from "../http";
import type { AppEnv } from "../types";
import { runAmbientRefill, type AmbientRefillResult } from "./ambient-refill";
import { runMemoryConsolidation, type MemoryConsolidateResult } from "./memory-consolidate";
import { runOfflineDirector, type OfflineDirectorResult } from "./offline-director";

export * from "./ambient-refill";
export * from "./memory-consolidate";
export * from "./offline-director";

/**
 * S2 background work. The **scheduler is `src/worker.ts`** (Agent O) — it runs the whole `JOBS`
 * table from `@rpgllm/shared` on cron, under a per-job Postgres advisory lock, and `GET /v1/jobs`
 * shows what it did. What lives in *this* file is the older, narrower path that the E2E suite
 * drives: three of the jobs called directly, with the extra `force`/`limit` knobs a test needs.
 * Each of those three also keeps its opportunistic trigger on a read, so the product still works
 * if nobody deploys the worker:
 *
 *   | job      | function                 | opportunistic trigger        | scheduled name      | test hook                          |
 *   |----------|--------------------------|------------------------------|---------------------|------------------------------------|
 *   | digest   | runOfflineDirector       | GET /v1/digest               | `offline-director`  | POST /v1/__test/run-job {digest}   |
 *   | memory   | runMemoryConsolidation   | GET /v1/memory/:characterId  | `memory-consolidate`| POST /v1/__test/run-job {memory}   |
 *   | ambient  | runAmbientRefill         | —                            | `ambient-refill`    | POST /v1/__test/run-job {ambient}  |
 *
 * For everything else (`purge-deleted`, `purge-login-codes`, `bandit-update`) and for the locked,
 * logged version of these three, use `POST /v1/jobs/run` (`routes/jobs.ts`) or
 * `pnpm --filter api worker --once=<job>`.
 */
export const JOB_NAMES = ["digest", "memory", "ambient", "all"] as const;
export type JobName = (typeof JOB_NAMES)[number];

export const RunJobReqZ = z.object({
  job: z.enum(JOB_NAMES).default("all"),
  personaId: z.string().optional(),
  worldId: z.string().optional(),
  locale: z.enum(LOCALES).optional(),
  force: z.boolean().default(false),
  minNotes: z.number().int().min(1).max(100).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
export type RunJobReq = z.infer<typeof RunJobReqZ>;

export interface RunJobResult {
  ran: JobName[];
  digest: OfflineDirectorResult | null;
  memory: MemoryConsolidateResult | null;
  ambient: AmbientRefillResult | null;
}

export async function runJobs(deps: {
  prisma: import("@prisma/client").PrismaClient;
  gateway: import("@rpgllm/llm").Gateway;
  clock: import("../clock").Clock;
}, req: RunJobReq): Promise<RunJobResult> {
  const wants = (name: Exclude<JobName, "all">): boolean => req.job === "all" || req.job === name;
  const result: RunJobResult = { ran: [], digest: null, memory: null, ambient: null };

  if (wants("digest")) {
    result.digest = await runOfflineDirector(deps.prisma, deps.gateway, deps.clock, {
      ...(req.personaId ? { personaId: req.personaId } : {}),
      force: req.force,
      ...(req.limit ? { limit: req.limit } : {}),
    });
    result.ran.push("digest");
  }
  if (wants("memory")) {
    result.memory = await runMemoryConsolidation(deps.prisma, deps.gateway, deps.clock, {
      ...(req.personaId ? { personaId: req.personaId } : {}),
      ...(req.minNotes ? { minNotes: req.minNotes } : {}),
      ...(req.limit ? { limit: req.limit } : {}),
    });
    result.ran.push("memory");
  }
  if (wants("ambient")) {
    result.ambient = await runAmbientRefill(deps.prisma, deps.gateway, deps.clock, {
      ...(req.worldId ? { worldId: req.worldId } : {}),
      ...(req.locale ? { locale: req.locale } : {}),
      force: req.force,
    });
    result.ran.push("ambient");
  }
  return result;
}

/**
 * `POST /v1/__test/run-job` — the manual scheduler. Guarded here (not in `routes/test-hooks.ts`,
 * which Agent F owns) so the router can be mounted unconditionally.
 */
export function jobRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/run-job", async (c) => {
    if (!testHooksEnabled()) return fail("NOT_FOUND", "No such route", 404);
    const body = await parseBody(c.req, RunJobReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    return ok(await runJobs(deps, body.value));
  });

  return app;
}
