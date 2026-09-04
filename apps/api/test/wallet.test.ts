import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ENERGY, PLANS, TEST_AD_TOKEN } from "@rpgllm/shared";
import { call, getWallet, makeHarness, prisma, resetDatabase, setEnergy, signup, type Harness } from "./helpers";

let h: Harness;

beforeAll(() => { h = makeHarness(); });
beforeEach(async () => { await resetDatabase(); });

describe("wallet (E2E-007, E2E-008, E2E-015)", () => {
  it("grants ad rewards up to the daily cap then answers 429 AD_LIMIT", async () => {
    const { token } = await signup(h);
    await setEnergy(h, token, 0);

    for (let i = 1; i <= ENERGY.AD_DAILY_MAX; i++) {
      const res = await call<{ energy: number; adRewardsToday: number }>(h, "POST", "/v1/wallet/ad-reward", {
        token, body: { adToken: TEST_AD_TOKEN },
      });
      expect(res.status).toBe(200);
      expect(res.data.energy).toBe(i * ENERGY.AD_REWARD);
      expect(res.data.adRewardsToday).toBe(i);
    }
    const over = await call(h, "POST", "/v1/wallet/ad-reward", { token, body: { adToken: TEST_AD_TOKEN } });
    expect(over.status).toBe(429);
    expect(over.error?.code).toBe("AD_LIMIT");
  });

  it("rejects an unknown ad token in ADS_MODE=test", async () => {
    const { token } = await signup(h);
    const res = await call(h, "POST", "/v1/wallet/ad-reward", { token, body: { adToken: "not-the-token" } });
    expect(res.status).toBe(400);
  });

  it("spends a coffee for +8 energy", async () => {
    const { token, userId } = await signup(h);
    await prisma.wallet.update({ where: { userId }, data: { coffee: 2 } });
    await setEnergy(h, token, 0);
    const res = await call<{ energy: number; coffee: number }>(h, "POST", "/v1/wallet/coffee", { token, body: { count: 1 } });
    expect(res.data.energy).toBe(ENERGY.COFFEE_ENERGY);
    expect(res.data.coffee).toBe(1);
  });

  it("dev-purchase activates Plus: energy 50 and ads off", async () => {
    const { token } = await signup(h);
    await setEnergy(h, token, 0);

    const offerings = await call<{ plans: { id: string; highlighted: boolean }[]; experiments: { trialDays: number; showAdFree: boolean } }>(
      h, "GET", "/v1/billing/offerings", { token },
    );
    expect(offerings.data.plans.find((p) => p.id === "plus_monthly")?.highlighted).toBe(true);
    expect([0, 7]).toContain(offerings.data.experiments.trialDays);

    const res = await call<{ subscription: { plan: string; active: boolean }; energy: number }>(
      h, "POST", "/v1/billing/dev-purchase", { token, body: { plan: "plus_monthly" } },
    );
    expect(res.status).toBe(200);
    expect(res.data.energy).toBe(PLANS.plus_monthly.energyDaily);
    expect(res.data.subscription.active).toBe(true);

    const wallet = await getWallet(h, token);
    expect(wallet.data.energy).toBe(ENERGY.PLUS_DAILY);
    expect(wallet.data.adsEnabled).toBe(false);
    expect(wallet.data.dailyMax).toBe(ENERGY.PLUS_DAILY);

    const me = await call<{ subscription: { active: boolean } | null }>(h, "GET", "/v1/me", { token });
    expect(me.data.subscription?.active).toBe(true);
    expect(await prisma.purchase.count()).toBe(1);
  });

  it("refills to the free daily amount after time travel (E2E-015)", async () => {
    const { token } = await signup(h);
    await setEnergy(h, token, 0);
    const before = await getWallet(h, token);
    expect(before.data.energy).toBe(0);

    await call(h, "POST", "/v1/__test/time-travel", { token, body: { days: 1 } });

    const after = await getWallet(h, token);
    expect(after.data.energy).toBe(ENERGY.FREE_DAILY);
    expect(new Date(after.data.dailyRefillAt).getTime()).toBeGreaterThan(new Date(before.data.dailyRefillAt).getTime());
    expect(await prisma.ledgerEntry.count({ where: { source: "daily_refill" } })).toBe(1);

    // idempotent within the same day
    const again = await getWallet(h, token);
    expect(again.data.energy).toBe(ENERGY.FREE_DAILY);
    expect(await prisma.ledgerEntry.count({ where: { source: "daily_refill" } })).toBe(1);
  });
});
