/**
 * The scheduler — `pnpm --filter api worker`.
 *
 * A long-lived process, separate from the API, that runs the `JOBS` table from `@rpgllm/shared` on
 * its cron schedules. Until this landed, nothing called `runOfflineDirector` /
 * `runMemoryConsolidation` / `runAmbientRefill` / `purgeDeletedAccounts` except a read-path
 * fallback and the E2E test hook (build-notes "Agent H": *"There is no scheduler in this build"*).
 *
 * Properties that matter in production:
 *   - **one instance per job**: every run takes a Postgres advisory lock keyed on the job name
 *     (`jobs/runs.ts`), so a second worker, or the old pod during a rolling deploy, skips instead
 *     of double-running. Skips are logged, never queued.
 *   - **crash-proof**: `runJobOnce` never throws; a failing job is recorded in `JobRun` with its
 *     error and the loop carries on.
 *   - **drains on SIGTERM**: the in-flight job is awaited (up to `WORKER_SHUTDOWN_GRACE_MS`)
 *     before the process disconnects Prisma and exits 0.
 *
 * Usage:
 *   pnpm --filter api worker                     # run the schedule forever
 *   pnpm --filter api worker --once              # run every job once, then exit
 *   pnpm --filter api worker --once=ambient-refill
 *   pnpm --filter api worker --jobs=offline-director,purge-login-codes
 *   JOBS_DISABLED=bandit-update pnpm --filter api worker
 */
import { PrismaClient } from "@prisma/client";
import { createClock, type Clock } from "./clock";
import { assertProductionConfig } from "./config-guard";
import { envNum, isProduction, llmMode, nodeEnv } from "./env";
import { loadEnvFile } from "./env-file";
import { nextCronRun, parseCron, type CronExpression } from "./jobs/cron";
import {
  disabledJobs, jobDefinitions, jobEnabled, jobTimeoutMs, resolveJobName, runJobOnce,
  type JobDeps, type JobDefinition,
} from "./jobs/registry";
import { ensureJobRunTable } from "./jobs/runs";
import { loadGateway } from "./llm-loader";
import { logLine } from "./middleware/request-log";

/** How often the loop wakes up to see what is due. One minute is cron's own resolution. */
const tickMs = (): number => envNum("SCHEDULER_TICK_MS", 30_000);
/** How long SIGTERM waits for the in-flight job before exiting anyway. */
const shutdownGraceMs = (): number => envNum("WORKER_SHUTDOWN_GRACE_MS", 30_000);

interface Args {
  once: boolean;
  onceJobs: string[];
  jobs: string[];
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { once: false, onceJobs: [], jobs: [] };
  for (const raw of argv) {
    const [flag, value] = raw.includes("=") ? [raw.slice(0, raw.indexOf("=")), raw.slice(raw.indexOf("=") + 1)] : [raw, ""];
    if (flag === "--once") {
      args.once = true;
      if (value && value !== "all") args.onceJobs = value.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (flag === "--jobs") {
      args.jobs = value.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return args;
}

interface Entry {
  def: JobDefinition;
  expr: CronExpression;
  nextAt: Date | null;
}

/** The jobs this worker is responsible for: the table, minus `--jobs`/`JOBS_DISABLED` filtering. */
export function selectJobs(only: readonly string[]): JobDefinition[] {
  const wanted = only.length > 0 ? new Set(only.map((n) => resolveJobName(n) ?? n)) : null;
  return jobDefinitions.filter((j) => (wanted ? wanted.has(j.name) : true) && jobEnabled(j.name));
}

/** A sleep the shutdown handler can cut short. */
function interruptibleSleep(ms: number): { promise: Promise<void>; wake: () => void } {
  let wake = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    wake = () => { clearTimeout(timer); resolve(); };
  });
  return { promise, wake };
}

async function main(): Promise<void> {
  const applied = loadEnvFile();
  // The worker talks to the same database and the same LLM as the API, so it gets the same
  // production posture check (S0-2): a worker booted with dev secrets is just as dangerous.
  assertProductionConfig(process.env);

  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  const clock: Clock = createClock();
  const { gateway, source } = await loadGateway();
  const deps: JobDeps = { prisma, gateway, clock };
  await ensureJobRunTable(prisma);

  const selected = selectJobs(args.once && args.onceJobs.length > 0 ? args.onceJobs : args.jobs);
  if (selected.length === 0) {
    logLine({ level: "error", msg: "worker.no-jobs", requested: args.jobs.join(",") || args.onceJobs.join(",") });
    await prisma.$disconnect();
    process.exit(1);
  }

  logLine({
    level: "info", msg: "worker.start", nodeEnv: nodeEnv(), production: isProduction(), envFiles: applied,
    llm: `${gateway.mode()} (${source})`, envLlmMode: llmMode(), tickMs: tickMs(), jobTimeoutMs: jobTimeoutMs(),
    disabled: disabledJobs().join(",") || null,
    jobs: selected.map((j) => `${j.name}@${j.schedule}`),
    mode: args.once ? "once" : "schedule",
  });

  // ---- one-shot mode: run each selected job once and exit with the worst outcome ----
  if (args.once) {
    let failures = 0;
    for (const def of selected) {
      const record = await runJobOnce(deps, def.name, { trigger: "manual" });
      if (!record.ok) failures += 1;
      process.stdout.write(`${JSON.stringify({ job: record.job, ok: record.ok, skipped: record.skipped, processed: record.processed, detail: record.detail, error: record.error })}\n`);
    }
    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
  }

  // ---- schedule mode ----
  const now = clock.now();
  const entries: Entry[] = selected.map((def) => {
    const expr = parseCron(def.schedule);
    return { def, expr, nextAt: nextCronRun(expr, now) };
  });

  /**
   * Loop state in one object rather than three `let`s: the signal handler mutates it from a
   * callback the compiler cannot see, and reading it through a property keeps that honest.
   */
  const state: { stopping: boolean; inFlight: Promise<unknown> | null; waker: (() => void) | null } = {
    stopping: false,
    inFlight: null,
    waker: null,
  };

  const shutdown = (signal: string): void => {
    if (state.stopping) return;
    state.stopping = true;
    logLine({ level: "info", msg: "worker.shutdown", signal, draining: state.inFlight !== null, graceMs: shutdownGraceMs() });
    state.waker?.();
    // Last resort: a job that ignores the grace window must not keep the pod alive forever.
    const forced = setTimeout(() => {
      logLine({ level: "warn", msg: "worker.shutdown.forced" });
      process.exit(0);
    }, shutdownGraceMs());
    forced.unref();
  };
  process.on("SIGTERM", () => { shutdown("SIGTERM"); });
  process.on("SIGINT", () => { shutdown("SIGINT"); });

  /** Read through a call: the flag is set from a signal handler, so it must never be narrowed. */
  const stopping = (): boolean => state.stopping;

  while (!stopping()) {
    const tickAt = clock.now();
    for (const entry of entries) {
      if (stopping()) break;
      // `nextAt` decides *when to ask*; it is advanced before the run, so a job that overruns its
      // own slot never fires twice for the same minute.
      if (entry.nextAt === null || tickAt < entry.nextAt) continue;
      entry.nextAt = nextCronRun(entry.expr, tickAt);
      state.inFlight = runJobOnce(deps, entry.def.name, { trigger: "schedule" });
      await state.inFlight;
      state.inFlight = null;
    }
    if (stopping()) break;
    const sleep = interruptibleSleep(tickMs());
    state.waker = sleep.wake;
    await sleep.promise;
    state.waker = null;
  }

  // SIGTERM during a job: drain it before letting the process go.
  const draining = state.inFlight;
  if (draining) await draining;
  await prisma.$disconnect();
  logLine({ level: "info", msg: "worker.shutdown.done" });
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error("[worker] failed to start", err);
  process.exit(1);
});
