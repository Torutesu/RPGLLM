import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JOBS } from "@rpgllm/shared";
import { cronMatches, nextCronRun, nextRunAtFor, parseCron } from "../src/jobs/cron";
import { findJob, resolveJobName, runDefinitionOnce, runJobOnce, type JobDeps } from "../src/jobs/registry";
import { ensurePushTicketTable, recordPushTickets, sweepPushReceipts } from "../src/jobs/push-receipts";
import { ensureJobRunTable, lockKeyFor, recentRuns, withJobLock } from "../src/jobs/runs";
import { call, makeHarness, prisma, resetDatabase, signupWithPersona, type Harness } from "./helpers";

let h: Harness;
let deps: JobDeps;

beforeAll(async () => {
  h = makeHarness();
  deps = { prisma: h.prisma, gateway: h.gateway, clock: h.clock };
  await ensureJobRunTable(prisma);
  await ensurePushTicketTable(prisma);
});
beforeEach(async () => {
  await resetDatabase();
  h.clock.reset();
  await prisma.$executeRawUnsafe(`DELETE FROM "JobRun"`);
});

const at = (iso: string): Date => new Date(iso);

describe("cron", () => {
  it("matches the JOBS table's own expressions", () => {
    expect(cronMatches(parseCron("0 * * * *"), at("2026-09-04T10:00:00Z"))).toBe(true);
    expect(cronMatches(parseCron("0 * * * *"), at("2026-09-04T10:01:00Z"))).toBe(false);
    expect(cronMatches(parseCron("*/30 * * * *"), at("2026-09-04T10:30:00Z"))).toBe(true);
    expect(cronMatches(parseCron("*/30 * * * *"), at("2026-09-04T10:31:00Z"))).toBe(false);
    expect(cronMatches(parseCron("0 3 * * *"), at("2026-09-04T03:00:00Z"))).toBe(true);
    expect(cronMatches(parseCron("30 3 * * *"), at("2026-09-04T03:30:00Z"))).toBe(true);
    expect(cronMatches(parseCron("30 3 * * *"), at("2026-09-04T04:30:00Z"))).toBe(false);
  });

  it("understands lists, ranges, steps and day-of-week", () => {
    expect(cronMatches(parseCron("5,10 1-3 * * *"), at("2026-09-04T02:10:00Z"))).toBe(true);
    expect(cronMatches(parseCron("5,10 1-3 * * *"), at("2026-09-04T04:10:00Z"))).toBe(false);
    // 2026-09-04 is a Friday (5); Sunday is both 0 and 7.
    expect(cronMatches(parseCron("0 0 * * 5"), at("2026-09-04T00:00:00Z"))).toBe(true);
    expect(cronMatches(parseCron("0 0 * * 7"), at("2026-09-06T00:00:00Z"))).toBe(true);
    expect(() => parseCron("0 0 * *")).toThrow(/5 fields/);
    expect(() => parseCron("99 * * * *")).toThrow(/out of range/);
  });

  it("computes the next run strictly after the given instant", () => {
    expect(nextCronRun(parseCron("0 * * * *"), at("2026-09-04T10:00:00Z"))?.toISOString()).toBe("2026-09-04T11:00:00.000Z");
    expect(nextCronRun(parseCron("0 3 * * *"), at("2026-09-04T10:00:00Z"))?.toISOString()).toBe("2026-09-05T03:00:00.000Z");
    // every job in the shared table has a next run
    for (const job of JOBS) expect(nextRunAtFor(job.schedule, at("2026-09-04T10:00:00Z"))).toBeInstanceOf(Date);
  });
});

describe("the job registry", () => {
  it("covers every row of the shared JOBS table, aliases included", () => {
    for (const job of JOBS) expect(findJob(job.name)?.schedule).toBe(job.schedule);
    expect(resolveJobName("digest")).toBe("offline-director");
    expect(resolveJobName("memory")).toBe("memory-consolidate");
    expect(resolveJobName("ambient")).toBe("ambient-refill");
    expect(resolveJobName("nope")).toBeNull();
  });

  it("records a run: start, finish, processed count", async () => {
    const record = await runJobOnce(deps, "purge-login-codes", { trigger: "test" });
    expect(record.ok).toBe(true);
    expect(record.skipped).toBe(false);
    const rows = await recentRuns(prisma, "purge-login-codes", 5);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.finishedAt).not.toBeNull();
    expect(rows[0]?.ok).toBe(true);
    expect(rows[0]?.trigger).toBe("test");
  });
});

describe("the advisory lock", () => {
  it("gives the same job a stable key and different jobs different ones", () => {
    expect(lockKeyFor("ambient-refill")).toBe(lockKeyFor("ambient-refill"));
    expect(lockKeyFor("ambient-refill")).not.toBe(lockKeyFor("purge-deleted"));
  });

  it("stops a second concurrent run of the same job", async () => {
    let concurrent = 0;
    let sawOverlap = false;
    const slow = async (): Promise<string> => {
      concurrent += 1;
      if (concurrent > 1) sawOverlap = true;
      await new Promise((r) => setTimeout(r, 400));
      concurrent -= 1;
      return "done";
    };

    const [a, b] = await Promise.all([
      withJobLock(prisma, "lock-test", 30_000, slow),
      // start slightly later so the first transaction has certainly taken the lock
      new Promise((r) => setTimeout(r, 50)).then(() => withJobLock(prisma, "lock-test", 30_000, slow)),
    ]);

    expect([a.locked, b.locked].sort()).toEqual([false, true]);
    expect(sawOverlap).toBe(false);
  });

  it("lets a different job run at the same time", async () => {
    const hold = withJobLock(prisma, "lock-test-a", 30_000, async () => {
      await new Promise((r) => setTimeout(r, 300));
      return 1;
    });
    await new Promise((r) => setTimeout(r, 50));
    const other = await withJobLock(prisma, "lock-test-b", 30_000, () => Promise.resolve(2));
    expect(other.locked).toBe(true);
    expect((await hold).locked).toBe(true);
  });

  it("skips instead of double-running when the lock is held", async () => {
    const held = withJobLock(prisma, "purge-login-codes", 30_000, async () => {
      await new Promise((r) => setTimeout(r, 500));
      return 0;
    });
    await new Promise((r) => setTimeout(r, 60));
    const record = await runJobOnce(deps, "purge-login-codes", { trigger: "test" });
    expect(record.skipped).toBe(true);
    expect(await recentRuns(prisma, "purge-login-codes", 5)).toHaveLength(0);
    await held;
  });
});

describe("a failing job", () => {
  const exploding = {
    name: "purge-login-codes",
    run: (): Promise<never> => Promise.reject(new Error("boom: the job blew up")),
  };

  it("is recorded as a failure and never propagates", async () => {
    const record = await runDefinitionOnce(deps, exploding, { trigger: "test" });
    expect(record.ok).toBe(false);
    expect(record.error).toContain("boom");
    const rows = await recentRuns(prisma, "purge-login-codes", 5);
    expect(rows[0]?.ok).toBe(false);
    expect(rows[0]?.error).toContain("boom");
    expect(rows[0]?.finishedAt).not.toBeNull();
  });

  it("leaves the scheduler able to run the next job", async () => {
    await runDefinitionOnce(deps, exploding, { trigger: "test" });
    const after = await runJobOnce(deps, "purge-login-codes", { trigger: "test" });
    expect(after.ok).toBe(true);
    const rows = await recentRuns(prisma, "purge-login-codes", 5);
    expect(rows).toHaveLength(2);
  });
});

interface JobsRes {
  jobs: {
    name: string; schedule: string; enabled: boolean;
    lastRun: { job: string; ok: boolean; processed: number; startedAt: string; finishedAt: string | null; error: string | null } | null;
    nextRunAt: string | null;
  }[];
}

describe("GET /v1/jobs and POST /v1/jobs/run", () => {
  it("lists every job with its schedule and next run", async () => {
    const res = await call<JobsRes>(h, "GET", "/v1/jobs");
    expect(res.status).toBe(200);
    expect(res.data.jobs.map((j) => j.name).sort()).toEqual(JOBS.map((j) => j.name).sort());
    for (const job of res.data.jobs) {
      expect(job.enabled).toBe(true);
      expect(job.nextRunAt).not.toBeNull();
    }
  });

  it("runs one job on demand and then reports it as the last run", async () => {
    const ran = await call<{ runs: { job: string; ok: boolean; processed: number; skipped: boolean }[] }>(
      h, "POST", "/v1/jobs/run", { body: { job: "purge-login-codes" } },
    );
    expect(ran.status).toBe(200);
    expect(ran.data.runs[0]?.job).toBe("purge-login-codes");
    expect(ran.data.runs[0]?.ok).toBe(true);

    const res = await call<JobsRes>(h, "GET", "/v1/jobs");
    const row = res.data.jobs.find((j) => j.name === "purge-login-codes");
    expect(row?.lastRun?.ok).toBe(true);
    expect(row?.lastRun?.finishedAt).not.toBeNull();
  });

  it("accepts the legacy job aliases and rejects unknown names", async () => {
    const alias = await call<{ runs: { job: string }[] }>(h, "POST", "/v1/jobs/run", { body: { job: "ambient" } });
    expect(alias.data.runs[0]?.job).toBe("ambient-refill");
    const bad = await call(h, "POST", "/v1/jobs/run", { body: { job: "definitely-not-a-job" } });
    expect(bad.status).toBe(400);
  });

  it("runs the generative jobs on the Batch tier (cost-architecture §5.4)", async () => {
    const p = await signupWithPersona(h);
    // Away long enough for the offline director to have something to say.
    h.clock.offsetDays(1);

    const ambient = await call<{ runs: { job: string; ok: boolean; detail: Record<string, number> }[] }>(
      h, "POST", "/v1/jobs/run", { body: { job: "ambient-refill" } },
    );
    expect(ambient.data.runs[0]?.ok).toBe(true);

    const digest = await call<{ runs: { job: string; ok: boolean; processed: number }[] }>(
      h, "POST", "/v1/jobs/run", { body: { job: "offline-director", personaId: p.personaId } },
    );
    expect(digest.data.runs[0]?.ok).toBe(true);
    expect(digest.data.runs[0]?.processed, "one digest for the away player").toBe(1);
    expect(await prisma.digest.count({ where: { personaId: p.personaId } })).toBe(1);

    // Every call the scheduler makes is batched: G2 for the pool, G10 for the digest, and the
    // batch marker is on the stop reason (`packages/llm` has no `batched` column to set).
    const logs = await prisma.generationLog.findMany({ where: { generator: { in: ["G2", "G10"] } } });
    expect(logs.length).toBeGreaterThan(0);
    for (const log of logs) expect(log.stopReason?.startsWith("batch:"), `${log.generator} is batched`).toBe(true);
    h.clock.reset();
  });

  it("keeps the E2E test hook working", async () => {
    const res = await call<{ ran: string[] }>(h, "POST", "/v1/__test/run-job", { body: { job: "ambient" } });
    expect(res.status).toBe(200);
    expect(res.data.ran).toContain("ambient");
  });
});


describe("the Expo receipt second pass", () => {
  const HOUR = 3_600_000;
  const now = new Date("2026-09-04T12:00:00.000Z");

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM "PushTicket"`);
    delete process.env.PUSH_ENABLED;
  });

  /** One receipt map, shaped the way Expo answers `getReceipts`. */
  const receiptsFetch = (body: Record<string, unknown>): typeof fetch =>
    ((): Promise<Response> => Promise.resolve(new Response(JSON.stringify({ data: body }), {
      status: 200, headers: { "content-type": "application/json" },
    }))) as unknown as typeof fetch;

  async function tokenFor(userId: string, token: string): Promise<void> {
    await prisma.pushToken.create({ data: { userId, token, platform: "ios" } });
  }

  it("deletes the tokens Expo reports as DeviceNotRegistered, and keeps the healthy ones", async () => {
    const p = await signupWithPersona(h);
    await tokenFor(p.userId, "ExponentPushToken[dead]");
    await tokenFor(p.userId, "ExponentPushToken[alive]");
    await recordPushTickets(prisma, [
      { ticketId: "ticket-dead", token: "ExponentPushToken[dead]" },
      { ticketId: "ticket-alive", token: "ExponentPushToken[alive]" },
    ], new Date(now.getTime() - HOUR));

    process.env.PUSH_ENABLED = "1";
    const result = await sweepPushReceipts(prisma, now, {
      fetchImpl: receiptsFetch({
        "ticket-dead": { status: "error", details: { error: "DeviceNotRegistered" } },
        "ticket-alive": { status: "ok" },
      }),
    });

    expect(result.checked).toBe(2);
    expect(result.pruned).toBe(1);
    const left = await prisma.pushToken.findMany({ where: { userId: p.userId } });
    expect(left.map((t) => t.token)).toEqual(["ExponentPushToken[alive]"]);
    // Both tickets were answered, so neither is asked about again.
    expect(await sweepPushReceipts(prisma, now, { fetchImpl: receiptsFetch({}) })).toMatchObject({ checked: 0 });
  });

  it("leaves a ticket alone until it has had time to settle", async () => {
    const p = await signupWithPersona(h);
    await tokenFor(p.userId, "ExponentPushToken[fresh]");
    await recordPushTickets(prisma, [{ ticketId: "ticket-fresh", token: "ExponentPushToken[fresh]" }], now);

    process.env.PUSH_ENABLED = "1";
    const result = await sweepPushReceipts(prisma, now, { fetchImpl: receiptsFetch({}) });
    expect(result.checked, "a ticket seconds old is not worth asking about").toBe(0);
    expect(await prisma.pushToken.count({ where: { userId: p.userId } })).toBe(1);
  });

  it("forgets tickets past Expo's retention, and does nothing at all while push is off", async () => {
    const p = await signupWithPersona(h);
    await tokenFor(p.userId, "ExponentPushToken[old]");
    await recordPushTickets(prisma, [{ ticketId: "ticket-old", token: "ExponentPushToken[old]" }],
      new Date(now.getTime() - 48 * HOUR));

    const result = await sweepPushReceipts(prisma, now);   // PUSH_ENABLED unset: no network at all
    expect(result.dropped).toBe(1);
    expect(result.checked).toBe(0);
    expect(await prisma.pushToken.count({ where: { userId: p.userId } })).toBe(1);
  });

  it("runs as its own scheduled job", async () => {
    const record = await runJobOnce(deps, "push-receipts", { trigger: "test" });
    expect(record.ok).toBe(true);
    expect(record.detail).toHaveProperty("checked");
    expect(record.detail).toHaveProperty("pruned");
  });

  it("is no longer folded into the housekeeping job", async () => {
    const record = await runJobOnce(deps, "purge-login-codes", { trigger: "test" });
    expect(record.ok).toBe(true);
    expect(record.detail).toHaveProperty("codes");
    expect(record.detail).not.toHaveProperty("pruned");
  });
});
