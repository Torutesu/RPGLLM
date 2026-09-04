import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { BANDIT_LAMBDA, BanditStateResZ } from "@rpgllm/shared";
import { call, makeHarness, prisma, resetDatabase, signup, type Harness } from "./helpers";
import {
  banditState,
  checkGuardrails,
  clearAllocatorSnapshot,
  banditAllocate,
  ensureArms,
  loadArms,
  maybePromote,
  promoteVariant,
  readWatermark,
  refreshAllocatorSnapshot,
  updateFromLogs,
  windowStats,
  WATERMARK_REASON,
} from "../src/services/bandit";

/**
 * §6.3 — Thompson sampling, persisted.
 *
 * Like `cost.test.ts`, the fixture sits in the **past** (two whole UTC days before today) so a
 * concurrent suite writing rows at "now" cannot perturb the assertions, and every number below is
 * re-derivable by hand from `seedLogs()`.
 */

const DAY_MS = 86_400_000;
const CHAMP = "g1-sonnet-v1";
const CHALLENGER = "g1-haiku-v1";

let h: Harness;

beforeAll(() => {
  h = makeHarness();
});
afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  clearAllocatorSnapshot();
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "EvalResult", "EvalRun", "EvalCase", "PromotionEvent", "BanditArm" RESTART IDENTITY CASCADE`);
});

interface LogSpec {
  variantId: string;
  model: string;
  costUsd: string;
  count: number;
  rating?: 1 | -1;
  regenerate?: boolean;
  stopReason?: string;
  safety?: "block" | "soften";
  at: Date;
  userId: string;
}

async function seedLogs(specs: LogSpec[]): Promise<void> {
  for (const spec of specs) {
    for (let i = 0; i < spec.count; i += 1) {
      const log = await prisma.generationLog.create({
        data: {
          userId: spec.userId,
          generator: "G1",
          variantId: spec.variantId,
          model: spec.model,
          promptHash: `h${spec.variantId}${i}`,
          inputTokens: 100,
          cacheWriteTokens: 0,
          cacheReadTokens: 4096,
          outputTokens: 50,
          costUsd: spec.costUsd,
          ttftMs: 50,
          latencyMs: 200,
          stopReason: spec.stopReason ?? "replay",
          safetyVerdict: spec.safety ?? null,
          createdAt: spec.at,
        },
        select: { id: true },
      });
      if (spec.rating !== undefined || spec.regenerate === true) {
        await prisma.rating.create({
          data: {
            userId: spec.userId,
            generationId: log.id,
            value: spec.rating ?? 0,
            regenerate: spec.regenerate ?? false,
            createdAt: spec.at,
          },
        });
      }
    }
  }
}

const past = (now: Date, days: number): Date => new Date(now.getTime() - days * DAY_MS);

describe("arms", () => {
  it("creates one row per registry variant, with the registry champion marked", async () => {
    const created = await ensureArms(prisma);
    expect(created).toBeGreaterThanOrEqual(6);
    const arms = await loadArms(prisma, "G1");
    expect(arms.map((a) => a.variantId).sort()).toEqual([CHALLENGER, CHAMP]);
    expect(arms.find((a) => a.variantId === CHAMP)?.isChampion).toBe(true);
    expect(arms.find((a) => a.variantId === CHALLENGER)?.isChampion).toBe(false);
    // idempotent
    expect(await ensureArms(prisma)).toBe(0);
  });
});

describe("updateFromLogs", () => {
  it("folds ratings and cost into the posteriors, and rewards the cheaper arm", async () => {
    const now = h.clock.now();
    const user = await signup(h);
    await seedLogs([
      { variantId: CHAMP, model: "claude-sonnet-5", costUsd: "0.004000", count: 10, rating: 1, at: past(now, 2), userId: user.userId },
      { variantId: CHALLENGER, model: "claude-haiku-4-5", costUsd: "0.001000", count: 10, rating: 1, at: past(now, 2), userId: user.userId },
    ]);

    const result = await updateFromLogs(prisma, now);
    expect(result.calls).toBe(20);

    const arms = await loadArms(prisma, "G1");
    const champ = arms.find((a) => a.variantId === CHAMP);
    const challenger = arms.find((a) => a.variantId === CHALLENGER);
    expect(champ?.calls).toBe(10);
    expect(challenger?.calls).toBe(10);

    // both were rated 👍; the challenger costs a quarter as much, so its reward is higher
    // champion reward = 1 - lambda*1 ; challenger = 1 - lambda*0.25
    expect((champ?.alpha ?? 0) - 1).toBeCloseTo(10 * (1 - BANDIT_LAMBDA), 4);
    expect((challenger?.alpha ?? 0) - 1).toBeCloseTo(10 * (1 - BANDIT_LAMBDA * 0.25), 4);
    expect(challenger?.alpha ?? 0).toBeGreaterThan(champ?.alpha ?? 0);
  });

  it("is idempotent across re-runs (the watermark stops double counting)", async () => {
    const now = h.clock.now();
    const user = await signup(h);
    await seedLogs([
      { variantId: CHAMP, model: "claude-sonnet-5", costUsd: "0.004000", count: 6, rating: 1, at: past(now, 2), userId: user.userId },
    ]);

    await updateFromLogs(prisma, now);
    const first = await loadArms(prisma, "G1");
    const second = await updateFromLogs(prisma, new Date(now.getTime() + 1000));
    const after = await loadArms(prisma, "G1");

    expect(second.calls).toBe(0);
    expect(after).toEqual(first);

    const watermark = await readWatermark(prisma, "G1");
    expect(watermark).not.toBeNull();
    const rows = await prisma.promotionEvent.findMany({ where: { generator: "G1", reason: WATERMARK_REASON } });
    expect(rows).toHaveLength(1); // updated in place, never appended
  });

  it("treats a 👎, a regeneration and a fallback as zero quality, and silence as the soft prior", async () => {
    const now = h.clock.now();
    const user = await signup(h);
    await seedLogs([
      { variantId: CHAMP, model: "claude-sonnet-5", costUsd: "0.001000", count: 4, rating: -1, at: past(now, 2), userId: user.userId },
      { variantId: CHAMP, model: "claude-sonnet-5", costUsd: "0.001000", count: 2, regenerate: true, at: past(now, 2), userId: user.userId },
      { variantId: CHAMP, model: "claude-sonnet-5", costUsd: "0.001000", count: 2, stopReason: "error", at: past(now, 2), userId: user.userId },
      { variantId: CHAMP, model: "claude-sonnet-5", costUsd: "0.001000", count: 10, at: past(now, 2), userId: user.userId },
    ]);
    const stats = (await windowStats(prisma, past(now, 3), now)).filter((s) => s.variantId === CHAMP);
    expect(stats[0]?.bad).toBe(8);
    expect(stats[0]?.unrated).toBe(10);
    expect(stats[0]?.good).toBe(0);

    await updateFromLogs(prisma, now);
    const champ = (await loadArms(prisma, "G1")).find((a) => a.variantId === CHAMP);
    // 8 zero-reward calls + 10 at (0.6 - lambda), against a champion cost ratio of 1
    expect((champ?.alpha ?? 0) - 1).toBeCloseTo(10 * (0.6 - BANDIT_LAMBDA), 4);
    expect(champ?.calls).toBe(18);
  });

  it("ignores batched (offline) calls — an eval run must not move production traffic", async () => {
    const now = h.clock.now();
    const user = await signup(h);
    await seedLogs([
      { variantId: CHALLENGER, model: "claude-haiku-4-5", costUsd: "0.001000", count: 40, stopReason: "batch:replay", at: past(now, 2), userId: user.userId },
      { variantId: CHALLENGER, model: "claude-haiku-4-5", costUsd: "0.001000", count: 3, rating: 1, at: past(now, 2), userId: user.userId },
    ]);
    await updateFromLogs(prisma, now);
    const challenger = (await loadArms(prisma, "G1")).find((a) => a.variantId === CHALLENGER);
    expect(challenger?.calls).toBe(3);
  });

  it("ignores escalated regenerations, which run under the user's arm one tier up", async () => {
    const now = h.clock.now();
    const user = await signup(h);
    const parent = await prisma.generationLog.create({
      data: {
        userId: user.userId, generator: "G1", variantId: CHALLENGER, model: "claude-haiku-4-5", promptHash: "p",
        inputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 1, outputTokens: 1, costUsd: "0.001000",
        latencyMs: 1, stopReason: "replay", createdAt: past(now, 2),
      },
      select: { id: true },
    });
    await prisma.generationLog.create({
      data: {
        userId: user.userId, generator: "G1", variantId: CHALLENGER, model: "claude-sonnet-5", promptHash: "p2",
        inputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 1, outputTokens: 1, costUsd: "0.020000",
        latencyMs: 1, stopReason: "replay", escalatedFrom: parent.id, createdAt: past(now, 2),
      },
    });

    await updateFromLogs(prisma, now);
    const challenger = (await loadArms(prisma, "G1")).find((a) => a.variantId === CHALLENGER);
    expect(challenger?.calls).toBe(1);
    expect(challenger?.costSum).toBeCloseTo(0.001, 6);
  });
});

describe("guardrails", () => {
  it("disables a breaching arm, records the event, and sends its traffic back to the champion", async () => {
    const now = h.clock.now();
    const user = await signup(h);
    await ensureArms(prisma);
    // 60 calls, 20 of them regenerated: 33% regeneration rate against a 8% limit
    await seedLogs([
      { variantId: CHALLENGER, model: "claude-haiku-4-5", costUsd: "0.001000", count: 20, regenerate: true, at: new Date(now.getTime() - 3600_000), userId: user.userId },
      { variantId: CHALLENGER, model: "claude-haiku-4-5", costUsd: "0.001000", count: 40, rating: 1, at: new Date(now.getTime() - 3600_000), userId: user.userId },
      { variantId: CHAMP, model: "claude-sonnet-5", costUsd: "0.004000", count: 60, rating: 1, at: new Date(now.getTime() - 3600_000), userId: user.userId },
    ]);
    await updateFromLogs(prisma, now);

    const result = await checkGuardrails(prisma, now);
    expect(result.disabled).toHaveLength(1);
    expect(result.disabled[0]?.variantId).toBe(CHALLENGER);
    expect(result.disabled[0]?.metric).toBe("regenerate_rate");

    const arm = (await loadArms(prisma, "G1")).find((a) => a.variantId === CHALLENGER);
    expect(arm?.disabled).toBe(true);
    expect(arm?.disabledReason).toContain("regenerate_rate");

    const events = await prisma.promotionEvent.findMany({ where: { generator: "G1", reason: { startsWith: "guardrail:" } } });
    expect(events).toHaveLength(1);
    expect(events[0]?.toVariant).toBe(CHAMP);

    // traffic reverts: every user now allocates to the champion
    await refreshAllocatorSnapshot(prisma, now);
    for (let i = 0; i < 50; i += 1) expect(banditAllocate("G1", `user-${i}`, now)).toBe(CHAMP);

    // and it does not fire twice for the same arm
    expect((await checkGuardrails(prisma, now)).disabled).toHaveLength(0);
  });

  it("never disables the champion", async () => {
    const now = h.clock.now();
    const user = await signup(h);
    await ensureArms(prisma);
    await seedLogs([
      { variantId: CHAMP, model: "claude-sonnet-5", costUsd: "0.004000", count: 60, regenerate: true, at: new Date(now.getTime() - 3600_000), userId: user.userId },
    ]);
    expect((await checkGuardrails(prisma, now)).disabled).toHaveLength(0);
    expect((await loadArms(prisma, "G1")).find((a) => a.variantId === CHAMP)?.disabled).toBe(false);
  });
});

describe("promotion", () => {
  async function makeChallengerWin(now: Date, userId: string): Promise<void> {
    await ensureArms(prisma);
    await seedLogs([
      { variantId: CHALLENGER, model: "claude-haiku-4-5", costUsd: "0.001000", count: 60, rating: 1, at: past(now, 2), userId },
      { variantId: CHAMP, model: "claude-sonnet-5", costUsd: "0.008000", count: 60, rating: -1, at: past(now, 2), userId },
    ]);
    await updateFromLogs(prisma, now);
  }

  /** A finished eval run per variant, shaped so the challenger clears the §6.2 gate. */
  async function seedGatePassingRuns(): Promise<void> {
    await prisma.evalRun.create({
      data: { generator: "G1", variantId: CHAMP, status: "finished", cases: 50, passed: 48, meanScore: 80, costUsd: "0.500000", finishedAt: new Date() },
    });
    await prisma.evalRun.create({
      data: { generator: "G1", variantId: CHALLENGER, status: "finished", cases: 50, passed: 47, meanScore: 79, costUsd: "0.100000", finishedAt: new Date() },
    });
  }

  it("refuses to promote without the offline gate, however good the online numbers are", async () => {
    const now = h.clock.now();
    const user = await signup(h);
    await makeChallengerWin(now, user.userId);

    const decision = await maybePromote(prisma, "G1", { minCalls: 50 });
    expect(decision.promoted).toBe(false);
    expect(decision.reason).toContain("offline gate");
    expect((await loadArms(prisma, "G1")).find((a) => a.isChampion)?.variantId).toBe(CHAMP);
  });

  it("refuses to promote without the call count, even with the gate passed", async () => {
    const now = h.clock.now();
    const user = await signup(h);
    await makeChallengerWin(now, user.userId);
    await seedGatePassingRuns();

    const decision = await maybePromote(prisma, "G1", { minCalls: 5000 });
    expect(decision.promoted).toBe(false);
    expect(decision.reason).toContain("5000 calls");
  });

  it("promotes when the posterior, the call count and the gate all agree, and audits it", async () => {
    const now = h.clock.now();
    const user = await signup(h);
    await makeChallengerWin(now, user.userId);
    await seedGatePassingRuns();

    const decision = await maybePromote(prisma, "G1", { minCalls: 50 });
    expect(decision.promoted).toBe(true);
    expect(decision.to).toBe(CHALLENGER);
    expect(decision.pBest).toBeGreaterThanOrEqual(0.95);

    const arms = await loadArms(prisma, "G1");
    expect(arms.find((a) => a.isChampion)?.variantId).toBe(CHALLENGER);
    const events = await prisma.promotionEvent.findMany({ where: { generator: "G1", reason: "auto:thompson+gate" } });
    expect(events).toHaveLength(1);
    expect(events[0]?.fromVariant).toBe(CHAMP);
  });
});

describe("the API", () => {
  it("GET /v1/bandit returns the contract shape", async () => {
    const now = h.clock.now();
    const user = await signup(h);
    await ensureArms(prisma);
    await seedLogs([
      { variantId: CHAMP, model: "claude-sonnet-5", costUsd: "0.004000", count: 5, rating: 1, at: past(now, 1), userId: user.userId },
      { variantId: CHALLENGER, model: "claude-haiku-4-5", costUsd: "0.001000", count: 5, rating: 1, at: past(now, 1), userId: user.userId },
    ]);
    await updateFromLogs(prisma, now);

    const res = await call<unknown>(h, "GET", "/v1/bandit");
    expect(res.status).toBe(200);
    const parsed = BanditStateResZ.parse(res.data);
    const g1 = parsed.generators.find((g) => g.generator === "G1");
    expect(g1?.champion).toBe(CHAMP);
    expect(g1?.arms).toHaveLength(2);
    expect(parsed.lambda).toBe(BANDIT_LAMBDA);
    const challenger = g1?.arms.find((a) => a.variantId === CHALLENGER);
    expect(challenger?.calls).toBe(5);
    expect(challenger?.usdPerCall).toBeCloseTo(0.001, 6);
    expect(challenger?.ci[0]).toBeLessThanOrEqual(challenger?.meanReward ?? 0);
    expect(challenger?.ci[1]).toBeGreaterThanOrEqual(challenger?.meanReward ?? 0);
    expect(challenger?.allocation).toBeCloseTo(0.5, 2);
  });

  it("POST /v1/bandit/promote moves the champion and writes the audit row", async () => {
    await ensureArms(prisma);
    const res = await call<{ champion: string; previous: string | null }>(h, "POST", "/v1/bandit/promote", {
      body: { generator: "G1", variantId: CHALLENGER, reason: "operator override" },
    });
    expect(res.status).toBe(200);
    expect(res.data.champion).toBe(CHALLENGER);
    expect(res.data.previous).toBe(CHAMP);

    const arms = await loadArms(prisma, "G1");
    expect(arms.find((a) => a.isChampion)?.variantId).toBe(CHALLENGER);
    const events = await prisma.promotionEvent.findMany({ where: { generator: "G1", reason: { startsWith: "manual:" } } });
    expect(events).toHaveLength(1);
  });

  it("POST /v1/bandit/promote 404s on an unknown arm", async () => {
    await ensureArms(prisma);
    const res = await call(h, "POST", "/v1/bandit/promote", { body: { generator: "G1", variantId: "nope", reason: "x" } });
    expect(res.status).toBe(404);
  });

  it("promoting an arm clears a guardrail disable (promotion says it is the safe one)", async () => {
    await ensureArms(prisma);
    await prisma.banditArm.update({
      where: { generator_variantId: { generator: "G1", variantId: CHALLENGER } },
      data: { disabledAt: new Date(), disabledReason: "guardrail:test" },
    });
    await promoteVariant(prisma, { generator: "G1", variantId: CHALLENGER, reason: "manual:test" });
    const arm = (await loadArms(prisma, "G1")).find((a) => a.variantId === CHALLENGER);
    expect(arm?.disabled).toBe(false);
    expect(arm?.isChampion).toBe(true);
  });
});

describe("the allocator the gateway calls", () => {
  it("returns null with no snapshot, and is user-sticky once warmed", async () => {
    expect(banditAllocate("G1", "u1")).toBeNull();

    const now = h.clock.now();
    const user = await signup(h);
    await ensureArms(prisma);
    await seedLogs([
      { variantId: CHAMP, model: "claude-sonnet-5", costUsd: "0.008000", count: 20, rating: -1, at: past(now, 1), userId: user.userId },
      { variantId: CHALLENGER, model: "claude-haiku-4-5", costUsd: "0.001000", count: 20, rating: 1, at: past(now, 1), userId: user.userId },
    ]);
    await updateFromLogs(prisma, now);
    await refreshAllocatorSnapshot(prisma, now);

    const first = banditAllocate("G1", "user-42", now);
    expect(first).not.toBeNull();
    for (let i = 0; i < 5; i += 1) expect(banditAllocate("G1", "user-42", now)).toBe(first);

    // the better arm takes the bulk of the traffic
    let challengerCount = 0;
    for (let i = 0; i < 200; i += 1) if (banditAllocate("G1", `u${i}`, now) === CHALLENGER) challengerCount += 1;
    expect(challengerCount).toBeGreaterThan(150);
  });

  it("state reports the champion even before any traffic exists", async () => {
    const state = await banditState(prisma, h.clock.now());
    const g1 = state.generators.find((g) => g.generator === "G1");
    expect(g1?.champion).toBe(CHAMP);
    expect(g1?.promotable).toBe(false);
    for (const arm of g1?.arms ?? []) expect(arm.allocation).toBe(0);
  });
});
