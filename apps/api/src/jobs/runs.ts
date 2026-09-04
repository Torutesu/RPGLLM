/**
 * Run history for the background jobs, and the Postgres advisory lock that keeps two workers (or a
 * worker and a redeploy) from running the same job at the same time.
 *
 * **Why raw SQL.** The run log has to be visible to a *different process* than the one that wrote
 * it — the worker runs the jobs, `GET /v1/jobs` reads them from the API — so it cannot live in
 * memory. `apps/api/prisma/schema.prisma` is not mine to edit this pass (build-notes: the
 * orchestrator owns it), so the table is created idempotently with `CREATE TABLE IF NOT EXISTS`
 * and read/written through parameterised raw queries. It is a plain table with no foreign keys;
 * the exact model to paste into `schema.prisma` when the orchestrator next touches it is in
 * `docs/deploy.md` §6 — after that, delete `ensureJobRunTable` and use `prisma.jobRun`.
 */
import { randomUUID } from "node:crypto";
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

const DDL = [
  `CREATE TABLE IF NOT EXISTS "JobRun" (
     "id" TEXT PRIMARY KEY,
     "job" TEXT NOT NULL,
     "startedAt" TIMESTAMP(3) NOT NULL,
     "finishedAt" TIMESTAMP(3),
     "ok" BOOLEAN NOT NULL DEFAULT false,
     "processed" INTEGER NOT NULL DEFAULT 0,
     "error" TEXT,
     "trigger" TEXT NOT NULL DEFAULT 'schedule',
     "host" TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS "JobRun_job_startedAt_idx" ON "JobRun" ("job", "startedAt" DESC)`,
] as const;

const ready = new WeakSet<PrismaClient>();

/** Kept for a deployment that predates the migration; a no-op once Prisma owns the table. */
export async function ensureJobRunTable(prisma: PrismaClient): Promise<void> {
  if (ready.has(prisma)) return;
  for (const stmt of DDL) await prisma.$executeRawUnsafe(stmt);
  ready.add(prisma);
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
  await ensureJobRunTable(prisma);
  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "JobRun" ("id", "job", "startedAt", "ok", "processed", "trigger", "host")
    VALUES (${id}, ${job}, ${startedAt}, false, 0, ${trigger}, ${host})`;
  return id;
}

export async function finishRun(
  prisma: PrismaClient,
  id: string,
  finishedAt: Date,
  result: { ok: boolean; processed: number; error: string | null },
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "JobRun"
       SET "finishedAt" = ${finishedAt}, "ok" = ${result.ok}, "processed" = ${result.processed}, "error" = ${result.error}
     WHERE "id" = ${id}`;
}

/** Newest run per job, in one query (`DISTINCT ON` does the grouping in Postgres, not in Node). */
export async function latestRuns(prisma: PrismaClient): Promise<Map<string, JobRunRow>> {
  await ensureJobRunTable(prisma);
  const rows = await prisma.$queryRaw<JobRunRow[]>`
    SELECT DISTINCT ON ("job") "id", "job", "startedAt", "finishedAt", "ok", "processed", "error", "trigger", "host"
      FROM "JobRun"
     ORDER BY "job", "startedAt" DESC`;
  return new Map(rows.map((r) => [r.job, r]));
}

/** Recent runs of one job, newest first — the detail view behind `GET /v1/jobs?job=`. */
export async function recentRuns(prisma: PrismaClient, job: string, limit: number): Promise<JobRunRow[]> {
  await ensureJobRunTable(prisma);
  return await prisma.$queryRaw<JobRunRow[]>`
    SELECT "id", "job", "startedAt", "finishedAt", "ok", "processed", "error", "trigger", "host"
      FROM "JobRun" WHERE "job" = ${job} ORDER BY "startedAt" DESC LIMIT ${limit}`;
}

/** House-keeping so the log cannot grow without bound (called by `purge-login-codes`). */
export async function pruneRuns(prisma: PrismaClient, before: Date): Promise<number> {
  await ensureJobRunTable(prisma);
  return await prisma.$executeRaw`DELETE FROM "JobRun" WHERE "startedAt" < ${before}`;
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
