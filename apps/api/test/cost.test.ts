import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { COST_DASHBOARD, CostSummaryResZ } from "@rpgllm/shared";
import { call, makeHarness, prisma, resetDatabase, signup, type Harness } from "./helpers";
import { costReport, costWindow, COST_ALARMS } from "../src/services/cost";
import type { CostReport } from "../src/services/cost";

/**
 * S3-5. The fixture below is hand-computable on purpose: every number asserted here can be
 * re-derived from the table in `seedLogs()` with a pencil.
 *
 *   #  gen  variant         model             in   cW   cR   out   cost    lat  ttft  stop      when
 *   1  G1   g1-sonnet-v1    claude-sonnet-5   100   0   400   50   0.001   100    50  end_turn  dayA 23:59:59.999
 *   2  G1   g1-sonnet-v1    claude-sonnet-5   100   0   400   50   0.001   200    60  end_turn  dayB 00:00:00.000
 *   3  G1   g1-sonnet-v1    claude-sonnet-5   100   0   400   50   0.001   300    70  end_turn  dayB 12:00
 *   4  G1   g1-sonnet-v1    claude-sonnet-5   100   0   400   50   0.001   400  3500  end_turn  dayB 12:00 (escalatedFrom #1)
 *   5  G1   g1-haiku-v1     claude-haiku-4-5  100   0   400   50   0.002   500    80  end_turn  dayB 12:00
 *   6  G1   g1-haiku-v1     claude-haiku-4-5  100   0   400   50   0.002   600    90  end_turn  dayB 12:00
 *   7  G5   g5-opus-v1      claude-opus-5     200 100     0  100   0.010  1000  null  error     dayB 12:00
 *   -  plus one row 30 days back that every assertion must ignore.
 */

const DAY_MS = 86_400_000;

/** Start of the UTC day `n` days before `now`. */
const utcDayStart = (now: Date, n: number): Date => {
  const d = new Date(now.getTime() - n * DAY_MS);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};
const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

interface SeedRow {
  generator: "G1" | "G5";
  variantId: string;
  model: string;
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  costUsd: string;
  latencyMs: number;
  ttftMs: number | null;
  stopReason: string;
  createdAt: Date;
  userId: string;
  escalateFromIndex?: number;
}

interface Seeded {
  userA: string;
  userB: string;
  dayA: string;
  dayB: string;
  logIds: string[];
  /**
   * The window every aggregation assertion uses: the two whole UTC days the fixture sits on,
   * ending before today. `rpgllm_test` is shared with the other agents' suites, whose rows all
   * land at "now" — pinning the window to the past makes these assertions immune to them.
   */
  window: { since: Date; until: Date };
}

async function seedLogs(h: Harness): Promise<Seeded> {
  const now = h.clock.now();
  const dayAStart = utcDayStart(now, 2);
  const dayBStart = new Date(dayAStart.getTime() + DAY_MS);
  const endOfDayA = new Date(dayBStart.getTime() - 1); // dayA 23:59:59.999
  const noonB = new Date(dayBStart.getTime() + 12 * 3_600_000);

  const a = await signup(h);
  const b = await signup(h);

  const sonnet = (over: Partial<SeedRow>): SeedRow => ({
    generator: "G1", variantId: "g1-sonnet-v1", model: "claude-sonnet-5",
    inputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 400, outputTokens: 50,
    costUsd: "0.001000", latencyMs: 100, ttftMs: 50, stopReason: "end_turn",
    createdAt: noonB, userId: a.userId, ...over,
  });
  const haiku = (over: Partial<SeedRow>): SeedRow => ({
    ...sonnet({}), variantId: "g1-haiku-v1", model: "claude-haiku-4-5", costUsd: "0.002000",
    userId: b.userId, ...over,
  });

  const rows: SeedRow[] = [
    sonnet({ latencyMs: 100, ttftMs: 50, createdAt: endOfDayA }),
    sonnet({ latencyMs: 200, ttftMs: 60, createdAt: dayBStart }),
    sonnet({ latencyMs: 300, ttftMs: 70 }),
    sonnet({ latencyMs: 400, ttftMs: 3500, escalateFromIndex: 0 }),
    haiku({ latencyMs: 500, ttftMs: 80 }),
    haiku({ latencyMs: 600, ttftMs: 90 }),
    {
      generator: "G5", variantId: "g5-opus-v1", model: "claude-opus-5",
      inputTokens: 200, cacheWriteTokens: 100, cacheReadTokens: 0, outputTokens: 100,
      costUsd: "0.010000", latencyMs: 1000, ttftMs: null, stopReason: "error",
      createdAt: noonB, userId: b.userId,
    },
  ];

  const logIds: string[] = [];
  for (const r of rows) {
    const created = await prisma.generationLog.create({
      data: {
        userId: r.userId, generator: r.generator, variantId: r.variantId, model: r.model,
        promptHash: `hash-${logIds.length}`,
        inputTokens: r.inputTokens, cacheWriteTokens: r.cacheWriteTokens,
        cacheReadTokens: r.cacheReadTokens, outputTokens: r.outputTokens,
        costUsd: r.costUsd, ttftMs: r.ttftMs, latencyMs: r.latencyMs, stopReason: r.stopReason,
        escalatedFrom: r.escalateFromIndex === undefined ? null : (logIds[r.escalateFromIndex] ?? null),
        createdAt: r.createdAt,
      },
      select: { id: true },
    });
    logIds.push(created.id);
  }

  // Out of every window we query: proves the range filter is real, not decorative.
  await prisma.generationLog.create({
    data: {
      userId: a.userId, generator: "G1", variantId: "g1-sonnet-v1", model: "claude-sonnet-5",
      promptHash: "hash-ancient", inputTokens: 9_000, cacheWriteTokens: 9_000, cacheReadTokens: 9_000,
      outputTokens: 9_000, costUsd: "9.000000", ttftMs: 99_000, latencyMs: 99_000, stopReason: "end_turn",
      createdAt: new Date(now.getTime() - 30 * DAY_MS),
    },
  });

  // Ratings: 👍👍 on #1 (sonnet arm), 👎 + regenerate on #5 (haiku arm). Dated into the window.
  await prisma.rating.createMany({
    data: [
      { userId: a.userId, generationId: logIds[0]!, value: 1, regenerate: false, createdAt: noonB },
      { userId: b.userId, generationId: logIds[0]!, value: 1, regenerate: false, createdAt: noonB },
      { userId: b.userId, generationId: logIds[4]!, value: -1, regenerate: true, createdAt: noonB },
    ],
  });

  // 6 energy-spending actions inside the window + 1 outside it.
  const walletA = await prisma.wallet.upsert({ where: { userId: a.userId }, create: { userId: a.userId, dailyRefillAt: now }, update: {} });
  const walletB = await prisma.wallet.upsert({ where: { userId: b.userId }, create: { userId: b.userId, dailyRefillAt: now }, update: {} });
  await prisma.ledgerEntry.createMany({
    data: [
      ...[0, 1, 2].map((i) => ({ walletId: walletA.id, currency: "energy" as const, delta: -1, source: "spend" as const, ref: `post:a${i}`, createdAt: noonB })),
      ...[0, 1, 2].map((i) => ({ walletId: walletB.id, currency: "energy" as const, delta: -1, source: "spend" as const, ref: `post:b${i}`, createdAt: noonB })),
      // a refund is NOT a spend, so it must not change the action count
      { walletId: walletB.id, currency: "energy" as const, delta: 1, source: "admin" as const, ref: "refund:post:b2", createdAt: noonB },
      // and an old action belongs to an older window
      { walletId: walletA.id, currency: "energy" as const, delta: -1, source: "spend" as const, ref: "post:old", createdAt: new Date(now.getTime() - 30 * DAY_MS) },
    ],
  });

  return {
    userA: a.userId, userB: b.userId, dayA: isoDay(dayAStart), dayB: isoDay(dayBStart), logIds,
    window: { since: dayAStart, until: new Date(dayBStart.getTime() + DAY_MS - 1) },
  };
}

const rowFor = (rows: CostReport["byDay"], key: string) => rows.find((r) => r.key === key);

describe("S3-5 cost aggregation", () => {
  let h: Harness;
  let seeded: Seeded;
  let report: CostReport;

  beforeAll(async () => {
    h = makeHarness();
    await resetDatabase();
    seeded = await seedLogs(h);
    report = await costReport(h.prisma, seeded.window);
  });

  it("totals every column over the window and ignores rows outside it", () => {
    expect(report.totals.calls).toBe(7);
    expect(report.totals.inputTokens).toBe(800); // 6 x 100 + 200
    expect(report.totals.cacheWriteTokens).toBe(100);
    expect(report.totals.cacheReadTokens).toBe(2_400); // 6 x 400
    expect(report.totals.outputTokens).toBe(400); // 6 x 50 + 100
    expect(report.totals.costUsd).toBeCloseTo(0.018, 6); // 4x0.001 + 2x0.002 + 0.010
    expect(report.totals.fallbacks).toBe(1); // stopReason "error"
  });

  it("computes nearest-rank percentiles, not averages", () => {
    // latencies 100,200,300,400,500,600,1000 (n=7): p50 = ceil(3.5)=4th = 400, p95 = ceil(6.65)=7th = 1000
    expect(report.totals.p50LatencyMs).toBe(400);
    expect(report.totals.p95LatencyMs).toBe(1000);
    // the average would be 442.85… — a P50 that equals it means someone swapped in avg()
    expect(report.totals.p50LatencyMs).not.toBe(Math.round((100 + 200 + 300 + 400 + 500 + 600 + 1000) / 7));
    // ttft 50,60,70,80,90,3500 (n=6, the null is excluded): p50 = 3rd = 70, p95 = 6th = 3500
    expect(report.ttft).toEqual({ p50Ms: 70, p95Ms: 3500, samples: 6 });
  });

  it("buckets by UTC day across the midnight boundary", () => {
    expect(report.byDay.map((r) => r.key)).toEqual([seeded.dayA, seeded.dayB]);
    const a = rowFor(report.byDay, seeded.dayA)!;
    const b = rowFor(report.byDay, seeded.dayB)!;
    // 23:59:59.999 and 00:00:00.000 are one millisecond apart and land in different buckets
    expect(a.calls).toBe(1);
    expect(b.calls).toBe(6);
    expect(a.p50LatencyMs).toBe(100);
    expect(a.p95LatencyMs).toBe(100);
    // dayB latencies 200,300,400,500,600,1000 (n=6): p50 = 3rd = 400, p95 = 6th = 1000
    expect(b.p50LatencyMs).toBe(400);
    expect(b.p95LatencyMs).toBe(1000);
    expect(a.costUsd + b.costUsd).toBeCloseTo(report.totals.costUsd, 6);
  });

  it("produces the daily $/action and $/DAU series", () => {
    expect(report.perDay.map((d) => d.day)).toEqual([seeded.dayA, seeded.dayB]);
    const a = report.perDay.find((d) => d.day === seeded.dayA)!;
    const b = report.perDay.find((d) => d.day === seeded.dayB)!;
    expect(a.calls).toBe(1);
    expect(a.actions).toBe(0); // all 6 spends are on dayB
    expect(a.costUsd).toBeCloseTo(0.001, 6);
    expect(a.usdPerAction).toBe(0); // no division by zero
    expect(b.calls).toBe(6);
    expect(b.actions).toBe(6);
    expect(b.activeUsers).toBe(2);
    expect(b.costUsd).toBeCloseTo(0.017, 6);
    expect(b.usdPerAction).toBeCloseTo(0.017 / 6, 6);
    expect(b.usdPerActiveUser).toBeCloseTo(0.017 / 2, 6);
    expect(b.ttftP95Ms).toBe(3500);
  });

  it("breaks down by generator, variant and model", () => {
    expect(report.byGenerator.map((r) => [r.key, r.calls])).toEqual([["G1", 6], ["G5", 1]]);
    expect(report.byVariant.map((r) => [r.key, r.calls])).toEqual([
      ["g1-haiku-v1", 2], ["g1-sonnet-v1", 4], ["g5-opus-v1", 1],
    ]);
    expect(report.byModel.map((r) => [r.key, r.calls])).toEqual([
      ["claude-haiku-4-5", 2], ["claude-opus-5", 1], ["claude-sonnet-5", 4],
    ]);
    expect(rowFor(report.byGenerator, "G5")!.fallbacks).toBe(1);
    expect(rowFor(report.byGenerator, "G1")!.fallbacks).toBe(0);
  });

  it("counts actions as energy spends and divides the window's cost by them", () => {
    expect(report.perAction.actions).toBe(6); // the refund and the 30-day-old spend are excluded
    expect(report.perAction.usdPerAction).toBeCloseTo(0.018 / 6, 6);
    // two distinct GenerationLog.userId values in the window
    expect(report.perAction.usdPerActiveUser).toBeCloseTo(0.018 / 2, 6);
  });

  it("computes the cache hit rate as cacheRead / (cacheRead + input)", () => {
    expect(report.cacheHitRate).toBeCloseTo(2_400 / (2_400 + 800), 4); // 0.75
    expect(report.alarms.cacheHitRateLow).toBe(true); // below the 80% floor
  });

  it("counts ratings and regenerations", () => {
    expect(report.ratings).toEqual({ up: 2, down: 1, regenerations: 1 });
  });

  it("scores each arm against its generator's champion", () => {
    const sonnet = report.variants.find((v) => v.variantId === "g1-sonnet-v1")!;
    const haiku = report.variants.find((v) => v.variantId === "g1-haiku-v1")!;
    expect(sonnet.isChampion).toBe(true);
    expect(sonnet.costVsChampion).toBeNull();
    expect(sonnet.allocation).toBeCloseTo(4 / 6, 4);
    expect(sonnet.usdPerCall).toBeCloseTo(0.001, 6);
    expect(sonnet.qualityProxy).toBeCloseTo(1 - 1 / 4, 4); // one regeneration, no 👎

    expect(haiku.isChampion).toBe(false);
    expect(haiku.usdPerCall).toBeCloseTo(0.002, 6);
    expect(haiku.costVsChampion).toBeCloseTo(1.0, 4); // +100% over the champion
    expect(haiku.allocation).toBeCloseTo(2 / 6, 4);
    expect(haiku.qualityProxy).toBeCloseTo(1 - 1 / 2, 4); // one 👎
  });

  it("raises the three §6.4 alarms", () => {
    expect(report.alarms).toEqual({
      cacheHitRateLow: true, // 75% < 80%
      costPerActionOverChampion: true, // haiku arm is +100% over g1-sonnet-v1
      ttftP95High: true, // 3500ms > 3000ms
    });
    expect(report.thresholds).toEqual(COST_ALARMS);
  });

  it("clamps the requested day count", () => {
    const now = h.clock.now();
    expect(costWindow(now, 7).days).toBe(7);
    expect(costWindow(now, 0).days).toBe(1);
    expect(costWindow(now, -5).days).toBe(1);
    expect(costWindow(now, 10_000).days).toBe(COST_DASHBOARD.MAX_DAYS);
    expect(costWindow(now, Number.NaN).days).toBe(COST_DASHBOARD.DEFAULT_DAYS);
    expect(Math.round((costWindow(now, 7).until.getTime() - costWindow(now, 7).since.getTime()) / DAY_MS)).toBe(7);
  });

  it("stays silent on an empty window", async () => {
    const now = h.clock.now();
    const empty = await costReport(h.prisma, { since: new Date(now.getTime() - 400 * DAY_MS), until: new Date(now.getTime() - 399 * DAY_MS) });
    expect(empty.totals.calls).toBe(0);
    expect(empty.perAction.usdPerAction).toBe(0);
    expect(empty.cacheHitRate).toBe(0);
    expect(empty.alarms).toEqual({ cacheHitRateLow: false, costPerActionOverChampion: false, ttftP95High: false });
  });
});

describe("S3-5 GET /v1/cost", () => {
  let h: Harness;

  beforeAll(async () => {
    h = makeHarness();
    await resetDatabase();
    await seedLogs(h);
  });

  beforeEach(() => {
    process.env["TEST_HOOKS"] = "1";
    delete process.env["ADMIN_TOKEN"];
  });

  afterAll(() => {
    process.env["TEST_HOOKS"] = "1";
    delete process.env["ADMIN_TOKEN"];
  });

  it("serves a CostSummaryResZ-shaped report", async () => {
    const res = await call<CostReport & { days: number }>(h, "GET", "/v1/cost/summary?days=7");
    expect(res.status).toBe(200);
    expect(() => CostSummaryResZ.parse(res.data)).not.toThrow();
    expect(res.data.days).toBe(7);
    // the fixture's 7 rows are inside a 7-day window; a concurrent suite may add more
    expect(res.data.totals.calls).toBeGreaterThanOrEqual(7);
    expect(res.data.perAction.actions).toBeGreaterThanOrEqual(6);
    expect(res.data.perAction.usdPerAction).toBeGreaterThan(0);
  });

  it("clamps days to COST_DASHBOARD.MAX_DAYS", async () => {
    const wide = await call<CostReport & { days: number }>(h, "GET", "/v1/cost/summary?days=100000");
    expect(wide.data.days).toBe(COST_DASHBOARD.MAX_DAYS);
    const spanDays = (Date.parse(wide.data.until) - Date.parse(wide.data.since)) / DAY_MS;
    expect(Math.round(spanDays)).toBe(COST_DASHBOARD.MAX_DAYS);

    const narrow = await call<CostReport & { days: number }>(h, "GET", "/v1/cost/summary?days=0");
    expect(narrow.data.days).toBe(1);
    const bad = await call<CostReport & { days: number }>(h, "GET", "/v1/cost/summary?days=banana");
    expect(bad.data.days).toBe(COST_DASHBOARD.DEFAULT_DAYS);
  });

  it("answers the live probe", async () => {
    const res = await call<{ cacheHitRate: number; fallbackRate: number; p95LatencyMs: number; alarms: Record<string, boolean> }>(
      h, "GET", "/v1/cost/live",
    );
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty("usdPerAction");
    expect(res.data).toHaveProperty("cacheHitRate");
    expect(res.data).toHaveProperty("fallbackRate");
    expect(res.data).toHaveProperty("p95LatencyMs");
    expect(res.data.alarms).toHaveProperty("cacheHitRateLow");
  });

  it("404s without the admin token once TEST_HOOKS is off, and 200s with it", async () => {
    process.env["TEST_HOOKS"] = "0";
    process.env["ADMIN_TOKEN"] = "cost-dashboard-admin-token";

    const anonymous = await call(h, "GET", "/v1/cost/summary?days=7");
    expect(anonymous.status).toBe(404);
    expect(anonymous.error?.code).toBe("NOT_FOUND");

    const wrong = await h.app.request("/v1/cost/summary?days=7", { headers: { "x-admin-token": "nope" } });
    expect(wrong.status).toBe(404);
    const wrongLength = await h.app.request("/v1/cost/summary?days=7", { headers: { "x-admin-token": "cost-dashboard-admin-token-extra" } });
    expect(wrongLength.status).toBe(404);

    const right = await h.app.request("/v1/cost/summary?days=7", { headers: { "x-admin-token": "cost-dashboard-admin-token" } });
    expect(right.status).toBe(200);
    const live = await h.app.request("/v1/cost/live", { headers: { "x-admin-token": "cost-dashboard-admin-token" } });
    expect(live.status).toBe(200);
  });

  it("404s when ADMIN_TOKEN is unset and TEST_HOOKS is off (no empty-token bypass)", async () => {
    process.env["TEST_HOOKS"] = "0";
    delete process.env["ADMIN_TOKEN"];
    const res = await h.app.request("/v1/cost/summary", { headers: { "x-admin-token": "" } });
    expect(res.status).toBe(404);
    const res2 = await h.app.request("/v1/cost/summary");
    expect(res2.status).toBe(404);
  });
});
