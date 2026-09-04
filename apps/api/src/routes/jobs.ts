import { Hono } from "hono";
import { RunJobReqZ } from "@rpgllm/shared";
import { fail, ok, parseBody } from "../http";
import { jobDefinitions, jobEnabled, resolveJobName, runJobOnce, toJobRunPayload } from "../jobs/registry";
import { latestRuns, recentRuns } from "../jobs/runs";
import { nextRunAtFor } from "../jobs/cron";
import type { AppEnv } from "../types";
import { costAccessAllowed } from "./cost";

/**
 * Scheduler visibility and manual triggers.
 *
 *   GET  /v1/jobs            → JobsResZ: every job, its cron line, whether it is enabled, its last
 *                              run and when it is next due. `?job=<name>` adds that job's last 20 runs.
 *   POST /v1/jobs/run        → RunJobReqZ `{job, personaId}` — run one job (or `"all"`) right now.
 *
 * **Access** is the same gate as `/v1/cost` (`costAccessAllowed`): open while `TEST_HOOKS=1`,
 * otherwise `x-admin-token` must equal a non-empty `ADMIN_TOKEN`. Anything else gets the ordinary
 * 404 body, so the route is invisible to a scanner. These endpoints spend money (a job calls the
 * LLM) — they are never user-reachable.
 *
 * The runs themselves happen in whichever process serves the request, but under the **same
 * advisory lock** the worker uses, so a manual trigger can never collide with the schedule.
 */
export function jobsRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    if (!costAccessAllowed(c.req.header("x-admin-token"))) return fail("NOT_FOUND", "No such route", 404);
    await next();
  });

  app.get("/", async (c) => {
    const deps = c.get("deps");
    const now = deps.clock.now();
    const last = await latestRuns(deps.prisma);
    const jobs = jobDefinitions.map((def) => {
      const run = last.get(def.name);
      const next = nextRunAtFor(def.schedule, now);
      return {
        name: def.name,
        schedule: def.schedule,
        description: def.description,
        enabled: jobEnabled(def.name),
        lastRun: run ? toJobRunPayload(run) : null,
        nextRunAt: next ? next.toISOString() : null,
      };
    });

    const detailFor = c.req.query("job");
    if (!detailFor) return ok({ jobs });
    const name = resolveJobName(detailFor);
    if (!name) return fail("VALIDATION", `Unknown job "${detailFor}"`, 400);
    const history = await recentRuns(deps.prisma, name, 20);
    return ok({ jobs, history: history.map(toJobRunPayload) });
  });

  app.post("/run", async (c) => {
    const body = await parseBody(c.req, RunJobReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const requested = body.value.job;
    const personaId = body.value.personaId;

    const targets = requested === "all"
      ? jobDefinitions.filter((d) => jobEnabled(d.name)).map((d) => d.name)
      : [resolveJobName(requested)];
    if (targets.some((t) => t === null)) return fail("VALIDATION", `Unknown job "${requested}"`, 400);

    const runs = [];
    for (const name of targets) {
      if (name === null) continue;
      const record = await runJobOnce(deps, name, { personaId, trigger: "manual" });
      runs.push({ ...toJobRunPayload(record), skipped: record.skipped, detail: record.detail });
    }
    return ok({ runs });
  });

  return app;
}
