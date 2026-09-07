import { beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import { WORLD_MODERATION, WORLD_MODERATION_ENV } from "@rpgllm/shared";
import { runJobOnce, type JobDeps } from "../src/jobs/registry";
import { median, percentile, reviewMinutesPerWorld, safeRate } from "../src/services/moderation-metrics";
import { call, grantShelfGems, makeHarness, prisma, resetDatabase, signup, type Harness } from "./helpers";

/**
 * `GET /v1/admin/moderation/metrics` — the queue as it actually behaves, next to the thresholds
 * actually in force (gtm.md §5: a moderation cost that is not in the unit economics is a wish).
 *
 * The cases that matter here are the arithmetic ones. A percentile over an empty window has to be
 * `null` — "nobody reviewed anything" is not "it took no time" — and every rate has a zero
 * denominator on day one, which is exactly the day an operator first opens this.
 */

let h: Harness;
let deps: JobDeps;
let restoreEnv: (() => void) | null = null;

function withEnv(patch: Record<string, string | undefined>): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [k, v] of Object.entries(patch)) {
    previous.set(k, process.env[k]);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => {
    for (const [k, v] of previous) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

interface Metrics {
  thresholds: { reportsToPull: number; reviewSlaHours: number; resubmitCooldownHours: number; claimMinutes: number };
  queue: { waiting: number; overdue: number; appeals: number; pulled: number; oldestWaitingHours: number };
  decisions: {
    last7d: number; approved: number; rejected: number; approvalRate: number;
    medianLatencyHours: number | null; p90LatencyHours: number | null;
  };
  reports: { open: number; last7d: number; perThousandPlays: number; pullsLast7d: number; pullsReapproved: number };
  economics: {
    worldsReviewedLast7d: number; estimatedReviewMinutes: number; generationCostUsd: number;
    reviewCostUsd: number; reviewHourlyUsd: number; minutesPerWorld: number;
  };
  sampling: {
    trustApprovals: number; trustSampleEvery: number; shelfFeeGems: number; trustedCreators: number;
    submissionsLast7d: number; sampledAwayLast7d: number; readByAHumanLast7d: number;
    sampledShare: number; reviewMinutesAvoided: number; reviewCostAvoidedUsd: number;
    sampledAwayAllTime: number; gemsChargedLast7d: number; gemsRefundedLast7d: number;
    queuedWithDigest: number;
  };
}

beforeAll(() => {
  h = makeHarness();
  deps = { prisma: h.prisma, gateway: h.gateway, clock: h.clock };
});
beforeEach(async () => {
  await resetDatabase();
  h.clock.reset();
  h.gateway.setMode("replay");
});
afterEach(() => { restoreEnv?.(); restoreEnv = null; });

const metrics = (headers?: Record<string, string>) =>
  call<Metrics>(h, "GET", "/v1/admin/moderation/metrics", headers ? { headers } : {});

const HOUR_MS = 3_600_000;

/** A built world waiting for a person. */
async function submittedWorld(premise: string): Promise<{ token: string; worldId: string }> {
  const { token, userId } = await signup(h);
  const created = await call<{ world: { id: string } }>(h, "POST", "/v1/worlds", {
    token, body: { premise, genre: "idol", locale: "en", visibility: "private" },
  });
  expect(created.status).toBe(201);
  expect((await runJobOnce(deps, "world-build", { trigger: "test" })).error).toBeNull();
  // The shelf costs gems on top of the world (gtm.md §2 exit 1); a fresh account has none left.
  await grantShelfGems(userId, 4);
  const worldId = created.data.world.id;
  expect((await call(h, "POST", `/v1/worlds/${worldId}/publish`, { token, body: { visibility: "public" } })).status).toBe(202);
  return { token, worldId };
}

/** Rewind when this world joined the queue, so the wait it is about to be credited with is known. */
const waited = (worldId: string, hours: number) =>
  prisma.world.update({
    where: { id: worldId },
    data: { reviewRequestedAt: new Date(h.clock.now().getTime() - hours * HOUR_MS) },
  });

const decide = (worldId: string, decision: "approve" | "reject") =>
  call(h, "POST", `/v1/admin/worlds/${worldId}/review`, { body: { decision, reason: decision === "reject" ? "off-limits" : "" } });

/** `n` distinct accounts, each reporting the world once. */
async function reporters(worldId: string, n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    const who = await signup(h);
    const filed = await call(h, "POST", "/v1/moderation/report", {
      token: who.token, body: { target: "world", targetId: worldId, reason: "harassment", note: `complaint ${i}` },
    });
    expect(filed.status).toBe(201);
  }
}

/* ---------------------------------------------------------------------- the gate ---- */

describe("who may read the moderation numbers", () => {
  it("is admin-only once TEST_HOOKS is off, by bearer or x-admin-token", async () => {
    restoreEnv = withEnv({ TEST_HOOKS: "0", RATE_LIMIT_ENABLED: "0", ADMIN_TOKEN: "moderation-metrics-token" });

    expect((await metrics()).status, "report volume and spend are not a logged-in user's business").toBe(401);
    expect((await metrics({ "x-admin-token": "wrong" })).status).toBe(401);
    expect((await metrics({ "x-admin-token": "moderation-metrics-token" })).status).toBe(200);
    expect((await metrics({ authorization: "Bearer moderation-metrics-token" })).status).toBe(200);
  });

  it("has no empty-token bypass when ADMIN_TOKEN is unset", async () => {
    restoreEnv = withEnv({ TEST_HOOKS: "0", RATE_LIMIT_ENABLED: "0", ADMIN_TOKEN: undefined });
    expect((await metrics()).status).toBe(401);
    expect((await metrics({ "x-admin-token": "" })).status).toBe(401);
  });
});

/* ------------------------------------------------------------------- the numbers ---- */

describe("the queue, measured", () => {
  it("reports null percentiles on an empty window and divides by zero nowhere", async () => {
    const res = await metrics();
    expect(res.status).toBe(200);
    const m = res.data;

    expect(m.decisions.last7d).toBe(0);
    expect(m.decisions.medianLatencyHours, "nobody reviewed anything ≠ it took no time").toBeNull();
    expect(m.decisions.p90LatencyHours).toBeNull();
    expect(m.decisions.approvalRate, "a rate over no decisions is 0, not NaN").toBe(0);
    expect(m.reports.perThousandPlays, "…and a rate over no plays is 0, not Infinity").toBe(0);
    expect(Number.isFinite(m.reports.perThousandPlays)).toBe(true);
    expect(m.economics).toEqual({
      worldsReviewedLast7d: 0, estimatedReviewMinutes: 0, generationCostUsd: 0,
      // gtm.md §2 puts a dollar figure on the queue, so the surface does too. Nobody reviewed
      // anything, so it cost nothing — but the rate and the minutes it multiplies are still stated,
      // because an operator cannot check a total whose inputs are invisible.
      reviewCostUsd: 0, reviewHourlyUsd: 15, minutesPerWorld: WORLD_MODERATION.CLAIM_MINUTES,
    });
    expect(m.queue).toEqual({ waiting: 0, overdue: 0, appeals: 0, pulled: 0, oldestWaitingHours: 0 });

    // The point of the endpoint: the thresholds actually in force, next to what they are doing.
    expect(m.thresholds).toEqual({
      reportsToPull: WORLD_MODERATION.REPORTS_TO_PULL,
      reviewSlaHours: WORLD_MODERATION.REVIEW_SLA_HOURS,
      resubmitCooldownHours: WORLD_MODERATION.RESUBMIT_COOLDOWN_HOURS,
      claimMinutes: WORLD_MODERATION.CLAIM_MINUTES,
    });
  });

  it("shows what is waiting, and what has waited too long", async () => {
    const { worldId } = await submittedWorld("Seven rookies, one debut slot, and a leaked group chat");
    let m = (await metrics()).data;
    expect(m.queue.waiting).toBe(1);
    expect(m.queue.overdue).toBe(0);

    await waited(worldId, WORLD_MODERATION.REVIEW_SLA_HOURS + 1);
    m = (await metrics()).data;
    expect(m.queue.overdue).toBe(1);
    expect(m.queue.oldestWaitingHours).toBeGreaterThanOrEqual(WORLD_MODERATION.REVIEW_SLA_HOURS);
    expect(m.decisions.last7d, "waiting is not a decision").toBe(0);
  });

  it("counts human decisions, how long each waited, and what the reviewing cost", async () => {
    const yes = await submittedWorld("A choir school where the acoustics decide who leads");
    const no = await submittedWorld("A late-night radio host and the town that calls in");
    await waited(yes.worldId, 3);
    await waited(no.worldId, 9);
    expect((await decide(yes.worldId, "approve")).status).toBe(200);
    expect((await decide(no.worldId, "reject")).status).toBe(200);

    const m = (await metrics()).data;
    expect(m.decisions.last7d).toBe(2);
    expect(m.decisions.approved).toBe(1);
    expect(m.decisions.rejected).toBe(1);
    expect(m.decisions.approvalRate).toBe(0.5);
    expect(m.decisions.medianLatencyHours).toBeCloseTo(6, 1);
    expect(m.decisions.p90LatencyHours).toBeCloseTo(9, 1);

    // Reviewer time is an operator's number, not ours: a rate from env over a documented default.
    expect(m.economics.worldsReviewedLast7d).toBe(2);
    expect(m.economics.estimatedReviewMinutes).toBe(2 * reviewMinutesPerWorld());
    // …and what those two worlds cost to make comes from GenerationLog, never from a constant.
    expect(m.economics.generationCostUsd).toBeGreaterThan(0);
  });

  it("takes the per-world review rate from the environment", async () => {
    const { worldId } = await submittedWorld("A ferry crew who only meet at the turnaround");
    await decide(worldId, "approve");

    restoreEnv = withEnv({ WORLD_REVIEW_MINUTES_PER_WORLD: "3.5" });
    expect((await metrics()).data.economics.estimatedReviewMinutes).toBe(3.5);

    // A value that is not a positive number is a typo, not a policy: the default stands — and the
    // default is the claim lease, because that is this service's own assertion about how long
    // reading a world takes. Asserted against the constant so the two cannot drift; a literal here
    // is how the default came to be a tenth of the real figure in the first place.
    restoreEnv();
    restoreEnv = withEnv({ WORLD_REVIEW_MINUTES_PER_WORLD: "0" });
    expect((await metrics()).data.economics.estimatedReviewMinutes).toBe(WORLD_MODERATION.CLAIM_MINUTES);
  });

  it("counts a pull, and the pulls a human immediately put back — the threshold's own error rate", async () => {
    const { worldId } = await submittedWorld("An archive that only opens for people who have lost something");
    await decide(worldId, "approve");
    await reporters(worldId, WORLD_MODERATION.REPORTS_TO_PULL);

    let m = (await metrics()).data;
    expect(m.queue.pulled, "players took it off the shelf").toBe(1);
    expect(m.reports.pullsLast7d).toBe(1);
    expect(m.reports.open).toBe(WORLD_MODERATION.REPORTS_TO_PULL);
    expect(m.reports.pullsReapproved, "nobody has looked at it yet").toBe(0);

    expect((await decide(worldId, "approve")).status).toBe(200);
    m = (await metrics()).data;
    expect(m.reports.pullsReapproved, "a person read the complaints and disagreed").toBe(1);
    expect(m.queue.pulled).toBe(0);
    expect(m.reports.open, "the decision closes the complaints it answers").toBe(0);
    expect(m.reports.last7d).toBe(WORLD_MODERATION.REPORTS_TO_PULL);
  });

  it("expresses report volume per thousand plays, because that is what the threshold is about", async () => {
    const { worldId } = await submittedWorld("Two rival bakeries and one shared wall");
    await decide(worldId, "approve");
    await reporters(worldId, 2);
    await prisma.world.update({ where: { id: worldId }, data: { playCount: 4_000 } });

    const m = (await metrics()).data;
    expect(m.reports.perThousandPlays).toBe(0.5);
  });
});

/* ------------------------------------------------- the load the exits removed ---- */

/**
 * gtm.md §2 exists because of one number: $5.00 of human time per public world, $30,000 a month at
 * 200 submissions a day. The point of all three exits is that number going down — **and if it
 * cannot be seen going down, none of this was engineering.** So this is the case that says the
 * surface can see it.
 */
describe("what the three exits actually removed", () => {
  it("counts submissions nobody read, and prices them at the configured rate", async () => {
    // Every submission is drawn: trust changes nothing, and the saving is honestly zero.
    restoreEnv = withEnv({ [WORLD_MODERATION_ENV.TRUST_SAMPLE_EVERY]: "1" });
    const { token, userId } = await signup(h);
    let n = 0;
    const build = async (): Promise<string> => {
      n += 1;
      const created = await call<{ world: { id: string } }>(h, "POST", "/v1/worlds", {
        token,
        body: { premise: `A rival bakery on the ${n}th street corner`, genre: "idol", locale: "en", visibility: "private" },
      });
      expect(created.status).toBe(201);
      expect((await runJobOnce(deps, "world-build", { trigger: "test" })).error).toBeNull();
      // The daily cap is a spend limit; this case needs more worlds than one day allows.
      await prisma.world.updateMany({ where: { createdBy: userId }, data: { createdAt: new Date(h.clock.now().getTime() - 2 * 86_400_000) } });
      await grantShelfGems(userId, 4);
      return created.data.world.id;
    };
    const submit = (id: string) => call<{ needsReview: boolean }>(h, "POST", `/v1/worlds/${id}/publish`, { token, body: { visibility: "public" } });

    // Earn trust the long way — every one of these is a human read, and is counted as one.
    for (let i = 0; i < WORLD_MODERATION.TRUST_APPROVALS; i += 1) {
      const id = await build();
      expect((await submit(id)).data.needsReview).toBe(true);
      await decide(id, "approve");
    }
    // …plus the guaranteed read the first submission after graduating gets.
    await submit(await build());

    const before = (await metrics()).data;
    expect(before.sampling.trustedCreators).toBe(1);
    expect(before.sampling.sampledAwayLast7d, "at sample-every 1, nothing is sampled away").toBe(0);
    expect(before.sampling.sampledShare).toBe(0);
    expect(before.sampling.reviewCostAvoidedUsd).toBe(0);
    expect(before.sampling.submissionsLast7d).toBe(WORLD_MODERATION.TRUST_APPROVALS + 1);
    expect(before.sampling.readByAHumanLast7d).toBe(WORLD_MODERATION.TRUST_APPROVALS + 1);
    expect(before.sampling.gemsChargedLast7d).toBe(WORLD_MODERATION.PUBLIC_SUBMIT_GEMS * (WORLD_MODERATION.TRUST_APPROVALS + 1));
    expect(before.sampling.queuedWithDigest, "every queued world carries advice").toBeGreaterThan(0);
    // What the queue cost: minutes at the rate an operator supplies.
    expect(before.economics.reviewCostUsd)
      .toBeCloseTo((before.economics.estimatedReviewMinutes / 60) * before.economics.reviewHourlyUsd, 2);

    // Now turn the sampling on. The same creator, the same worlds, and no reviewer.
    restoreEnv?.();
    restoreEnv = withEnv({ [WORLD_MODERATION_ENV.TRUST_SAMPLE_EVERY]: "100000" });
    const away = [await build(), await build()];
    for (const id of away) expect((await submit(id)).data.needsReview).toBe(false);

    const after = (await metrics()).data;
    expect(after.sampling.sampledAwayLast7d).toBe(2);
    expect(after.sampling.sampledAwayAllTime).toBe(2);
    expect(after.sampling.submissionsLast7d).toBe(WORLD_MODERATION.TRUST_APPROVALS + 3);
    expect(after.sampling.readByAHumanLast7d).toBe(WORLD_MODERATION.TRUST_APPROVALS + 1);
    expect(after.sampling.sampledShare).toBeCloseTo(2 / (WORLD_MODERATION.TRUST_APPROVALS + 3), 4);

    // The dollars. Two twenty-minute reads that did not happen, at the rate in force.
    const minutes = 2 * reviewMinutesPerWorld();
    expect(after.sampling.reviewMinutesAvoided).toBe(minutes);
    expect(after.sampling.reviewCostAvoidedUsd)
      .toBeCloseTo((minutes / 60) * after.economics.reviewHourlyUsd, 2);
    expect(after.sampling.reviewCostAvoidedUsd, "the number this whole pass exists to move").toBeGreaterThan(0);

    // And the thresholds that produced it are named next to it, so the figure can be checked.
    expect(after.sampling.trustSampleEvery).toBe(100000);
    expect(after.sampling.trustApprovals).toBe(WORLD_MODERATION.TRUST_APPROVALS);
    expect(after.sampling.shelfFeeGems).toBe(WORLD_MODERATION.PUBLIC_SUBMIT_GEMS);
  });

  it("nets a refunded submission out of what the shelf collected", async () => {
    const { token, worldId } = await submittedWorld("A lighthouse keeper with a podcast");
    const m0 = (await metrics()).data;
    expect(m0.sampling.gemsChargedLast7d).toBe(WORLD_MODERATION.PUBLIC_SUBMIT_GEMS);
    expect(m0.sampling.gemsRefundedLast7d).toBe(0);

    // Withdrawn before anyone opened it: the fee bought nothing and went back.
    await call(h, "POST", `/v1/worlds/${worldId}/publish`, { token, body: { visibility: "private" } });
    const m1 = (await metrics()).data;
    expect(m1.sampling.gemsRefundedLast7d).toBe(WORLD_MODERATION.PUBLIC_SUBMIT_GEMS);
  });
});

/* ------------------------------------------------------------------- the maths ---- */

describe("the statistics the endpoint is made of", () => {
  it("returns null for an empty sample rather than pretending it is zero", () => {
    expect(median([])).toBeNull();
    expect(percentile([], 0.9)).toBeNull();
    expect(median([4])).toBe(4);
    expect(median([1, 3])).toBe(2);
    expect(median([1, 2, 3])).toBe(2);
    // Nearest rank: p90 of ten samples is the ninth.
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
    expect(percentile([5], 0.9)).toBe(5);
  });

  it("answers 0 for a rate with nothing underneath it", () => {
    expect(safeRate(3, 0)).toBe(0);
    expect(safeRate(0, 0)).toBe(0);
    expect(safeRate(1, 4)).toBe(0.25);
  });
});
