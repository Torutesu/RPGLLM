/**
 * Run history for the background jobs, and the Postgres advisory lock that keeps two workers (or a
 * worker and a redeploy) from running the same job at the same time.
 *
 * The run log has to be visible to a *different process* than the one that wrote it — the worker
 * runs the jobs, `GET /v1/jobs` reads them from the API — so it cannot live in memory. It was a
 * table this file created at runtime with `CREATE TABLE IF NOT EXISTS` and read back with raw SQL,
 * because the schema was frozen for that pass; `prisma migrate dev` therefore wanted to drop it
 * on sight, which is a loaded gun pointed at the run history of every deployment.
 *
 * The model and its migration exist now, so this file is ordinary Prisma. The one piece of raw SQL
 * left is `pg_try_advisory_xact_lock`, which has no Prisma equivalent and is the whole point of
 * `withJobLock`.
 */
import type { PrismaClient } from "@prisma/client";

export interface JobRunRow {
  id: string;
  job: string;
  startedAt: Date;
  finishedAt: Date | null;
  ok: boolean;
  processed: number;
  error: string | null;
  /** "schedule" | "manual" | "test" — how the run was triggered */
  trigger: string;
  /** which process ran it, for "why did this fire twice" questions */
  host: string | null;
}

/** Truncate a failure so one enormous stack cannot bloat every `GET /v1/jobs`. */
const MAX_ERROR_CHARS = 500;
export const shortError = (err: unknown): string => {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return text.length > MAX_ERROR_CHARS ? `${text.slice(0, MAX_ERROR_CHARS)}…` : text;
};

export async function startRun(
  prisma: PrismaClient,
  job: string,
  startedAt: Date,
  trigger: string,
  host: string | null,
): Promise<string> {
  const row = await prisma.jobRun.create({
    data: { job, startedAt, ok: false, processed: 0, trigger, host },
    select: { id: true },
  });
  return row.id;
}

export async function finishRun(
  prisma: PrismaClient,
  id: string,
  finishedAt: Date,
  result: { ok: boolean; processed: number; error: string | null },
): Promise<void> {
  await prisma.jobRun.update({
    where: { id },
    data: { finishedAt, ok: result.ok, processed: result.processed, error: result.error },
  });
}

/**
 * Newest run per job. `DISTINCT ON` has no Prisma expression, and `findMany` + group-in-Node over
 * the whole history is not the same query — so this reads the most recent runs (bounded) and keeps
 * the first per job. The table is pruned to `JOB_RUN_RETENTION_DAYS`, and there are seven jobs, so
 * the bound is generous by two orders of magnitude.
 */
export async function latestRuns(prisma: PrismaClient): Promise<Map<string, JobRunRow>> {
  const rows = await prisma.jobRun.findMany({ orderBy: [{ startedAt: "desc" }, { id: "desc" }], take: 500 });
  const out = new Map<string, JobRunRow>();
  for (const r of rows) if (!out.has(r.job)) out.set(r.job, r);
  return out;
}

/** Recent runs of one job, newest first — the detail view behind `GET /v1/jobs?job=`. */
export async function recentRuns(prisma: PrismaClient, job: string, limit: number): Promise<JobRunRow[]> {
  return await prisma.jobRun.findMany({
    where: { job }, orderBy: [{ startedAt: "desc" }, { id: "desc" }], take: limit,
  });
}

/** House-keeping so the log cannot grow without bound (called by `purge-login-codes`). */
export async function pruneRuns(prisma: PrismaClient, before: Date): Promise<number> {
  const { count } = await prisma.jobRun.deleteMany({ where: { startedAt: { lt: before } } });
  return count;
}

/**
 * Advisory-lock namespace. `pg_try_advisory_xact_lock(classId, objId)` takes two int4s: the first
 * is a constant that keeps these locks from colliding with anyone else's, the second is a hash of
 * the job name.
 */
export const LOCK_CLASS_ID = 20260904;

/** FNV-1a, folded into a signed int4 — stable across processes and restarts. */
export function lockKeyFor(job: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < job.length; i += 1) {
    h ^= job.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

export interface LockOutcome<T> {
  locked: boolean;
  value: T | null;
}

/**
 * Runs `fn` while holding the per-job advisory lock; returns `{locked:false}` immediately when
 * another process already holds it (jobs are skipped, never queued — the next tick will try again).
 *
 * The lock is a **transaction-scoped** advisory lock, taken inside an interactive transaction whose
 * only job is to hold it: Prisma pools connections, so a session-scoped lock could be released on a
 * connection the next query never sees. `fn` therefore runs on other connections (it is handed the
 * ordinary `PrismaClient`), and the transaction's `timeout` bounds how long a wedged job can hold
 * the lock — after that the transaction rolls back, the lock is released and the run is recorded as
 * a failure by the caller.
 */
export async function withJobLock<T>(
  prisma: PrismaClient,
  job: string,
  timeoutMs: number,
  fn: () => Promise<T>,
): Promise<LockOutcome<T>> {
  return await prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${LOCK_CLASS_ID}::int4, ${lockKeyFor(job)}::int4) AS locked`;
      if (rows[0]?.locked !== true) return { locked: false, value: null };
      return { locked: true, value: await fn() };
    },
    { timeout: timeoutMs, maxWait: 15_000 },
  );
}
