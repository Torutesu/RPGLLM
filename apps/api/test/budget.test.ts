import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Gateway } from "@rpgllm/llm";
import {
  BudgetExhaustedError, budgetStatus, dailyBudgetUsd, dayKeyOf, noteSpend, resetBudgetCache,
  spentTodayUsd, withBudget,
} from "../src/services/budget";
import { call, makeHarness, prisma, resetDatabase, signup, type Harness } from "./helpers";

/**
 * The day's ceiling (production-readiness pass).
 *
 * Nothing in this product bounded the invoice: energy bounds a user, the rate limiter bounds a
 * minute, and neither of them says anything about a retry loop, an expensive arm the bandit just
 * promoted, or one account automating the studio. These cases pin the three properties that make
 * a ceiling worth having — it counts real money, it stops spending when it is reached, and it
 * degrades the way an outage does rather than inventing a new failure for every call site.
 */

let h: Harness;

function withEnv(patch: Record<string, string | undefined>): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [k, v] of Object.entries(patch)) {
    previous.set(k, process.env[k]);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => { for (const [k, v] of previous) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
}

let restore: (() => void) | null = null;

beforeAll(() => { h = makeHarness(); });
beforeEach(async () => { await resetDatabase(); resetBudgetCache(); });
afterEach(() => { restore?.(); restore = null; resetBudgetCache(); });

/** A generation that cost real money, dated whenever we say. */
async function logSpend(userId: string | null, usd: number, at: Date): Promise<void> {
  await prisma.generationLog.create({
    data: {
      userId, generator: "G1", variantId: "v1", model: "claude-sonnet-5", promptHash: "h",
      inputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 50,
      costUsd: usd.toFixed(6), latencyMs: 10, stopReason: "end_turn", createdAt: at,
    },
  });
}

/** A gateway that reports `live` and records what it was asked for. */
function fakeLiveGateway(costUsd = 0): { gateway: Gateway; calls: string[] } {
  const calls: string[] = [];
  const meta = { costUsd, generator: "G1", usage: {} };
  const handler: ProxyHandler<object> = {
    get(_t, prop: string | symbol) {
      if (prop === "mode") return () => "live";
      if (typeof prop !== "string") return undefined;
      return (..._args: unknown[]) => { calls.push(prop); return Promise.resolve({ output: {}, meta }); };
    },
  };
  return { gateway: new Proxy({}, handler) as unknown as Gateway, calls };
}

describe("reading the ceiling", () => {
  it("treats an unset or unlimited budget as no ceiling", () => {
    restore = withEnv({ LLM_DAILY_BUDGET_USD: undefined });
    expect(dailyBudgetUsd()).toBeNull();
    restore();
    restore = withEnv({ LLM_DAILY_BUDGET_USD: "unlimited" });
    expect(dailyBudgetUsd()).toBeNull();
  });

  it("reads a number", () => {
    restore = withEnv({ LLM_DAILY_BUDGET_USD: "12.50" });
    expect(dailyBudgetUsd()).toBe(12.5);
  });
});

describe("what the day has cost", () => {
  it("sums today and ignores yesterday", async () => {
    const now = new Date("2026-09-10T12:00:00.000Z");
    await logSpend(null, 1.25, new Date("2026-09-10T00:00:01.000Z"));
    await logSpend(null, 0.75, new Date("2026-09-10T11:59:59.000Z"));
    // 23:59:59 the previous day — the boundary is UTC, like every other daily reset here.
    await logSpend(null, 99, new Date("2026-09-09T23:59:59.000Z"));

    expect(await spentTodayUsd(prisma, now)).toBeCloseTo(2.0, 6);
  });

  it("reports what is left, and when it is gone", async () => {
    const now = new Date("2026-09-10T12:00:00.000Z");
    restore = withEnv({ LLM_DAILY_BUDGET_USD: "10" });
    await logSpend(null, 4, now);

    let status = await budgetStatus(prisma, now);
    expect(status.spentUsd).toBeCloseTo(4, 6);
    expect(status.remainingUsd).toBeCloseTo(6, 6);
    expect(status.exhausted).toBe(false);

    resetBudgetCache();
    await logSpend(null, 6, now);
    status = await budgetStatus(prisma, now);
    expect(status.exhausted, "at the ceiling, not merely past it").toBe(true);
    expect(status.remainingUsd).toBe(0);
  });

  it("caches for a few seconds, and never across a day boundary", async () => {
    restore = withEnv({ LLM_DAILY_BUDGET_USD: "10", LLM_BUDGET_REFRESH_MS: "60000" });
    const now = new Date("2026-09-10T12:00:00.000Z");
    await logSpend(null, 1, now);
    expect((await budgetStatus(prisma, now)).cached).toBe(false);
    expect((await budgetStatus(prisma, now)).cached, "the second read is free").toBe(true);

    // A spend written behind the cache's back is invisible until it refreshes…
    await logSpend(null, 50, now);
    expect((await budgetStatus(prisma, now)).spentUsd).toBeCloseTo(1, 6);

    // …but the rollover is not staleness, it is the whole of yesterday being wrong.
    const tomorrow = new Date("2026-09-11T00:00:01.000Z");
    const rolled = await budgetStatus(prisma, tomorrow);
    expect(rolled.cached).toBe(false);
    expect(rolled.dayKey).toBe("2026-09-11");
    expect(rolled.spentUsd, "yesterday's spend does not follow us into today").toBeCloseTo(0, 6);
  });

  it("counts a call's own cost immediately, so a burst inside one window still moves", async () => {
    restore = withEnv({ LLM_DAILY_BUDGET_USD: "10", LLM_BUDGET_REFRESH_MS: "60000" });
    const now = new Date("2026-09-10T12:00:00.000Z");
    await budgetStatus(prisma, now);
    for (let i = 0; i < 20; i += 1) noteSpend(0.6, now);
    // 12 dollars of calls inside one refresh window: the ceiling has to see them.
    expect((await budgetStatus(prisma, now)).exhausted).toBe(true);
  });
});

describe("the metered gateway", () => {
  const now = new Date("2026-09-10T12:00:00.000Z");

  it("passes calls through while there is room, and charges the cache as it goes", async () => {
    restore = withEnv({ LLM_DAILY_BUDGET_USD: "10", LLM_BUDGET_REFRESH_MS: "60000" });
    const { gateway, calls } = fakeLiveGateway(3);
    const metered = withBudget(gateway, prisma, () => now);

    await metered.g1({} as never);
    await metered.g1({} as never);
    expect(calls).toEqual(["g1", "g1"]);
    expect((await budgetStatus(prisma, now)).spentUsd, "the wrapper counted its own calls").toBeCloseTo(6, 6);

    await metered.g1({} as never);
    // 9 of 10 spent; the next one is over, and the refusal is a throw the call sites already know.
    await metered.g1({} as never).catch(() => undefined);
    await expect(metered.g1({} as never)).rejects.toBeInstanceOf(BudgetExhaustedError);
  });

  it("stops every generator, not a list somebody remembered to update", async () => {
    restore = withEnv({ LLM_DAILY_BUDGET_USD: "1" });
    await logSpend(null, 5, now);
    const { gateway, calls } = fakeLiveGateway();
    const metered = withBudget(gateway, prisma, () => now);

    for (const name of ["g1", "g5", "g9", "g9Screen", "gj", "batchG1", "batch"] as const) {
      await expect((metered[name] as (...a: unknown[]) => Promise<unknown>)({}), name).rejects.toBeInstanceOf(BudgetExhaustedError);
    }
    expect(calls, "nothing reached the model").toEqual([]);
  });

  it("leaves the bookkeeping members alone", async () => {
    restore = withEnv({ LLM_DAILY_BUDGET_USD: "1" });
    await logSpend(null, 5, now);
    const metered = withBudget(fakeLiveGateway().gateway, prisma, () => now);
    // Being out of budget must not make the service unable to say what mode it is in.
    expect(metered.mode()).toBe("live");
  });

  it("does not cap replay — an imaginary budget is not a reason for a real outage", async () => {
    restore = withEnv({ LLM_DAILY_BUDGET_USD: "0.01" });
    await logSpend(null, 5, now);
    const { calls } = fakeLiveGateway();
    // The harness gateway is a replay gateway; the wrapper must let it through untouched.
    const metered = withBudget(h.gateway, prisma, () => now);
    expect(metered.mode()).toBe("replay");
    await expect(metered.g8({ text: "hello", locale: "en" } as never)).resolves.toBeDefined();
    expect(calls).toEqual([]);
  });

  it("is off entirely when there is no ceiling", async () => {
    restore = withEnv({ LLM_DAILY_BUDGET_USD: "unlimited" });
    // `costUsd` is Decimal(10,6), so one row tops out just under $10,000 — plenty.
    await logSpend(null, 9_000, now);
    const { gateway, calls } = fakeLiveGateway();
    await withBudget(gateway, prisma, () => now).g1({} as never);
    expect(calls).toEqual(["g1"]);
  });
});

describe("the operator's view", () => {
  it("puts the ceiling on the live cost payload, where an incident is diagnosed", async () => {
    restore = withEnv({ LLM_DAILY_BUDGET_USD: "10" });
    const account = await signup(h);
    await logSpend(account.userId, 4, h.clock.now());
    resetBudgetCache();

    const res = await call<{ budget: { limitUsd: number; spentUsd: number; exhausted: boolean; dayKey: string } }>(
      h, "GET", "/v1/cost/live", { headers: { "x-admin-token": "" } },
    );
    // TEST_HOOKS=1 is the gate in this harness, so the read succeeds without a token.
    expect(res.status).toBe(200);
    expect(res.data.budget.limitUsd).toBe(10);
    expect(res.data.budget.spentUsd).toBeCloseTo(4, 2);
    expect(res.data.budget.exhausted).toBe(false);
    expect(res.data.budget.dayKey).toBe(dayKeyOf(h.clock.now()));
  });
});
