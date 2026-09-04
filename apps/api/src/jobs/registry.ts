/**
 * The job registry: one entry per row of `@rpgllm/shared`'s `JOBS` table, the code it runs, and
 * the one function (`runJobOnce`) that every trigger goes through — the worker's scheduler,
 * `POST /v1/jobs/run` and the E2E test hook alike.
 *
 * Every run is: take the advisory lock → write a `JobRun` row → run → record processed/error.
 * A job that throws is recorded and swallowed; nothing a job does can take the worker down.
 */
import { hostname } from "node:os";
import type { PrismaClient } from "@prisma/client";
import type { Gateway } from "@rpgllm/llm";
import { JOBS } from "@rpgllm/shared";
import type { Clock } from "../clock";
import { envNum, envStr } from "../env";
import { logLine } from "../middleware/request-log";
import { purgeDeletedAccounts } from "../services/account";
import { purgeLoginCodes } from "../services/login-codes";
import { runAmbientRefill } from "./ambient-refill";
import { runBanditUpdate } from "./bandit-update";
import { runMemoryConsolidation } from "./memory-consolidate";
import { runOfflineDirector } from "./offline-director";
import { finishRun, pruneRuns, shortError, startRun, withJobLock, type JobRunRow } from "./runs";

export type ScheduledJobName = (typeof JOBS)[number]["name"];

export interface JobDeps {
  prisma: PrismaClient;
  gateway: Gateway;
  clock: Clock;
}

export interface JobOptions {
  /** narrow the run to one persona (offline-director / memory-consolidate) */
  personaId?: string | null;
  /** "schedule" (the worker), "manual" (POST /v1/jobs/run) or "test" */
  trigger?: string;
}

export interface JobOutcome {
  /** how many *things* the run dealt with — digests written, notes folded, rows deleted */
  processed: number;
  /** job-specific counters, echoed back to the caller of POST /v1/jobs/run */
  detail: Record<string, number>;
}

export interface JobDefinition {
  name: ScheduledJobName;
  schedule: string;
  description: string;
  run(deps: JobDeps, opts: JobOptions): Promise<JobOutcome>;
}

/** How long one job may hold its advisory lock before the holding transaction gives up. */
export const jobTimeoutMs = (): number => envNum("JOB_TIMEOUT_MS", 10 * 60 * 1000);
/** Comma-separated job names the worker must not run (still runnable by hand). */
export const disabledJobs = (): string[] =>
  envStr("JOBS_DISABLED", "").split(",").map((s) => s.trim()).filter(Boolean);
export const jobEnabled = (name: string): boolean => !disabledJobs().includes(name);
/** `JobRun` rows older than this are dropped by the purge job. */
const runRetentionDays = (): number => envNum("JOB_RUN_RETENTION_DAYS", 14);

const DAY_MS = 24 * 60 * 60 * 1000;

const RUNNERS: Record<ScheduledJobName, (deps: JobDeps, opts: JobOptions) => Promise<JobOutcome>> = {
  "offline-director": async (deps, opts) => {
    const r = await runOfflineDirector(deps.prisma, deps.gateway, deps.clock, {
      ...(opts.personaId ? { personaId: opts.personaId } : {}),
    });
    return { processed: r.generated.length, detail: { considered: r.considered, generated: r.generated.length, skipped: r.skipped } };
  },
  "memory-consolidate": async (deps, opts) => {
    const r = await runMemoryConsolidation(deps.prisma, deps.gateway, deps.clock, {
      ...(opts.personaId ? { personaId: opts.personaId } : {}),
    });
    return { processed: r.relationships, detail: { personas: r.personas, relationships: r.relationships, notes: r.notes } };
  },
  "ambient-refill": async (deps) => {
    const r = await runAmbientRefill(deps.prisma, deps.gateway, deps.clock, {});
    return { processed: r.created, detail: { pools: r.pools, created: r.created } };
  },
  "purge-deleted": async (deps) => {
    const r = await purgeDeletedAccounts(deps.prisma, deps.clock.now());
    return {
      processed: r.users,
      detail: { users: r.users, personas: r.personas, posts: r.posts, messages: r.messages, generations: r.generations },
    };
  },
  "purge-login-codes": async (deps) => {
    const now = deps.clock.now();
    const codes = await purgeLoginCodes(deps.prisma, now);
    // Same broom, same schedule: keep the run log itself bounded.
    const runs = await pruneRuns(deps.prisma, new Date(now.getTime() - runRetentionDays() * DAY_MS));
    return { processed: codes, detail: { codes, runs } };
  },
  "bandit-update": async (deps) => await runBanditUpdate(deps),
};

export const jobDefinitions: JobDefinition[] = JOBS.map((row) => ({
  name: row.name,
  schedule: row.schedule,
  description: row.description,
  run: RUNNERS[row.name],
}));

export const jobNames: ScheduledJobName[] = jobDefinitions.map((j) => j.name);
export const findJob = (name: string): JobDefinition | undefined => jobDefinitions.find((j) => j.name === name);

/**
 * Legacy aliases: `POST /v1/__test/run-job` (Agent H) uses these names and the E2E suite calls it.
 * They stay valid everywhere a job name is accepted.
 */
export const JOB_ALIASES: Record<string, ScheduledJobName> = {
  digest: "offline-director",
  memory: "memory-consolidate",
  ambient: "ambient-refill",
};
export const resolveJobName = (name: string): ScheduledJobName | null =>
  findJob(name)?.name ?? JOB_ALIASES[name] ?? null;

export interface JobRunRecord {
  job: string;
  startedAt: Date;
  finishedAt: Date;
  ok: boolean;
  processed: number;
  error: string | null;
  /** true when another process held the lock and this call did nothing */
  skipped: boolean;
  detail: Record<string, number>;
}

const HOST = hostname();

/**
 * Run one job exactly once, under its advisory lock, recording the attempt.
 * Never throws: a failing job comes back as `{ok:false, error}` so a scheduler tick — or an
 * operator's `POST /v1/jobs/run` — is never taken down by the work it triggered.
 */
export async function runJobOnce(
  deps: JobDeps,
  name: ScheduledJobName,
  opts: JobOptions = {},
): Promise<JobRunRecord> {
  const def = findJob(name);
  if (!def) {
    const at = deps.clock.now();
    return { job: name, startedAt: at, finishedAt: at, ok: false, processed: 0, error: `unknown job "${name}"`, skipped: false, detail: {} };
  }
  return await runDefinitionOnce(deps, def, opts);
}

/**
 * The generic half: lock → record → run → record. Takes the definition rather than a name so the
 * tests can drive a deliberately failing job through the exact production path.
 */
export async function runDefinitionOnce(
  deps: JobDeps,
  def: { name: string; run: (deps: JobDeps, opts: JobOptions) => Promise<JobOutcome> },
  opts: JobOptions = {},
): Promise<JobRunRecord> {
  const name = def.name;
  const trigger = opts.trigger ?? "manual";
  const startedAt = deps.clock.now();
  // The lock callback runs in a closure, so what it learns lives in an object rather than in
  // `let`s the compiler would happily narrow away.
  const tracking: { runId: string | null; error: string | null } = { runId: null, error: null };
  let outcome: JobOutcome | null = null;

  try {
    const lock = await withJobLock(deps.prisma, name, jobTimeoutMs(), async () => {
      const runId = await startRun(deps.prisma, name, startedAt, trigger, HOST);
      tracking.runId = runId;
      logLine({ level: "info", msg: "job.start", job: name, trigger, runId });
      try {
        return await def.run(deps, opts);
      } catch (err: unknown) {
        tracking.error = shortError(err);
        return null;
      }
    });
    if (!lock.locked) {
      logLine({ level: "warn", msg: "job.skipped", job: name, trigger, reason: "locked" });
      return { job: name, startedAt, finishedAt: deps.clock.now(), ok: true, processed: 0, error: null, skipped: true, detail: {} };
    }
    outcome = lock.value;
  } catch (err: unknown) {
    // The lock transaction itself failed (timeout, connection loss). Still a recorded failure.
    tracking.error ??= shortError(err);
  }

  const finishedAt = deps.clock.now();
  const record: JobRunRecord = {
    job: name,
    startedAt,
    finishedAt,
    ok: tracking.error === null,
    processed: outcome?.processed ?? 0,
    error: tracking.error,
    skipped: false,
    detail: outcome?.detail ?? {},
  };
  const runId = tracking.runId;
  if (runId !== null) {
    try {
      await finishRun(deps.prisma, runId, finishedAt, { ok: record.ok, processed: record.processed, error: record.error });
    } catch (err: unknown) {
      logLine({ level: "error", msg: "job.record.failed", job: name, error: shortError(err) });
    }
  }
  logLine({
    level: record.ok ? "info" : "error",
    msg: record.ok ? "job.done" : "job.failed",
    job: name, trigger, processed: record.processed,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    ...(record.error ? { error: record.error } : {}),
  });
  return record;
}

export const toJobRunPayload = (row: JobRunRow | JobRunRecord & { id?: string }): {
  job: string; startedAt: string; finishedAt: string | null; ok: boolean; processed: number; error: string | null;
} => ({
  job: row.job,
  startedAt: row.startedAt.toISOString(),
  finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
  ok: row.ok,
  processed: row.processed,
  error: row.error,
});
