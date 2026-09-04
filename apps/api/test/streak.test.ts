import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ENERGY, STREAK_LADDER, rewardForStreakDay } from "@rpgllm/shared";
import { call, getWallet, makeHarness, prisma, resetDatabase, setEnergy, signup, type Harness } from "./helpers";

let h: Harness;

beforeAll(() => { h = makeHarness(); });
beforeEach(async () => { await resetDatabase(); h.clock.reset(); });

interface StreakRes {
  days: number; best: number; claimedToday: boolean;
  reward: { energy: number; coffee: number; gems: number } | null;
  ladder: { day: number; energy: number; coffee: number; gems: number; reached: boolean }[];
}

const streak = (token: string) => call<StreakRes>(h, "GET", "/v1/streak", { token });

describe("daily streak (SCR-010 check-in)", () => {
  it("starts at day 1 and pays the day-1 rung", async () => {
    const { token } = await signup(h);
    await setEnergy(h, token, 0);
    const res = await streak(token);
    expect(res.status).toBe(200);
    expect(res.data.days).toBe(1);
    expect(res.data.best).toBe(1);
    expect(res.data.claimedToday).toBe(false);
    expect(res.data.reward).toEqual(rewardForStreakDay(1));
    expect((await getWallet(h, token)).data.energy).toBe(rewardForStreakDay(1).energy);
  });

  it("is idempotent within one UTC day: the second call pays nothing", async () => {
    const { token } = await signup(h);
    await setEnergy(h, token, 0);
    await streak(token);
    const energyAfterFirst = (await getWallet(h, token)).data.energy;

    const again = await streak(token);
    expect(again.data.claimedToday).toBe(true);
    expect(again.data.days).toBe(1);
    expect((await getWallet(h, token)).data.energy).toBe(energyAfterFirst);
  });

  it("advances on consecutive days and pays each rung of the ladder exactly", async () => {
    const { token } = await signup(h);
    for (let day = 1; day <= STREAK_LADDER.length; day += 1) {
      if (day > 1) h.clock.offsetDays(1);
      const before = (await getWallet(h, token)).data;
      const res = await streak(token);
      expect(res.data.days, `day ${day}`).toBe(day);
      expect(res.data.reward).toEqual(rewardForStreakDay(day));
      const after = (await getWallet(h, token)).data;
      // Coffee and gems are paid in full; energy is capped at the wallet's daily maximum.
      expect(after.coffee - before.coffee, `coffee on day ${day}`).toBe(rewardForStreakDay(day).coffee);
      expect(after.energy, `energy never exceeds the daily max on day ${day}`)
        .toBeLessThanOrEqual(Math.max(before.energy, ENERGY.FREE_DAILY));
      expect(res.data.ladder.filter((r) => r.reached)).toHaveLength(day);
    }
    expect((await streak(token)).data.best).toBe(STREAK_LADDER.length);
  });

  it("pays the whole rung when the tank is empty", async () => {
    const { token } = await signup(h);
    h.clock.offsetDays(1);
    await setEnergy(h, token, 0);
    const res = await streak(token);
    const paid = rewardForStreakDay(res.data.days);
    const wallet = (await getWallet(h, token)).data;
    expect(wallet.energy).toBe(Math.min(paid.energy, ENERGY.FREE_DAILY));
  });

  it("resets to day 1 after a gap and keeps the best", async () => {
    const { token } = await signup(h);
    await streak(token);
    h.clock.offsetDays(1);
    expect((await streak(token)).data.days).toBe(2);
    h.clock.offsetDays(3); // missed two days
    const res = await streak(token);
    expect(res.data.days).toBe(1);
    expect(res.data.best).toBe(2);
    expect(res.data.ladder.filter((r) => r.reached)).toHaveLength(1);
  });

  it("checks in on the first /v1/me of a day, so /v1/streak then reports it as claimed", async () => {
    const { token } = await signup(h);
    const me = await call<{ streak: StreakRes }>(h, "GET", "/v1/me", { token });
    expect(me.data.streak.days).toBe(1);
    expect(me.data.streak.claimedToday).toBe(false);
    const res = await streak(token);
    expect(res.data.claimedToday).toBe(true);
    expect(res.data.days).toBe(1);
    expect(res.data.reward).toEqual(rewardForStreakDay(1));
  });

  it("never lets the check-in push a full free tank above the daily maximum", async () => {
    const { token } = await signup(h);
    expect((await getWallet(h, token)).data.energy).toBe(ENERGY.FREE_DAILY);
    await streak(token);
    expect((await getWallet(h, token)).data.energy).toBe(ENERGY.FREE_DAILY);
  });

  it("requires a session", async () => {
    expect((await call(h, "GET", "/v1/streak")).status).toBe(401);
  });
});

/**
 * Agent O: the streak now lives on `User.streakDays` / `streakBestDays` / `streakLastAt`. These
 * cases pin the storage itself — the columns are written, and an account whose streak was only ever
 * recorded in the ledger (every account created before the columns landed) keeps its days.
 */
const utcDay = (d: Date): string => d.toISOString().slice(0, 10);
const dayOffset = (from: Date, days: number): Date => new Date(from.getTime() + days * 24 * 60 * 60 * 1000);

/** Rewinds an account to look exactly like a pre-columns one: ledger row only, no columns. */
async function makeLegacyAccount(userId: string, day: Date, days: number, best: number): Promise<void> {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
  await prisma.ledgerEntry.create({
    data: {
      walletId: wallet.id, currency: "energy", delta: 0, source: "daily_refill",
      ref: `streak:${utcDay(day)}:${days}:${best}`, createdAt: day,
    },
  });
  await prisma.user.update({ where: { id: userId }, data: { streakDays: 0, streakBestDays: 0, streakLastAt: null } });
}

describe("streak storage (User columns, with a migration from the ledger)", () => {
  it("writes the columns on check-in, and keeps the ledger as the receipt", async () => {
    const { token, userId } = await signup(h);
    await setEnergy(h, token, 0);
    const res = await streak(token);
    expect(res.data.days).toBe(1);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.streakDays).toBe(1);
    expect(user.streakBestDays).toBe(1);
    expect(user.streakLastAt).not.toBeNull();
    expect(utcDay(user.streakLastAt!)).toBe(utcDay(h.clock.now()));

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    const entries = await prisma.ledgerEntry.findMany({ where: { walletId: wallet.id, ref: { startsWith: "streak:" } } });
    expect(entries.length).toBeGreaterThan(0);
  });

  it("migrates a legacy ledger-derived streak without losing a day", async () => {
    const { token, userId } = await signup(h);
    await makeLegacyAccount(userId, dayOffset(h.clock.now(), -1), 3, 5);
    await setEnergy(h, token, 0);

    const res = await streak(token);
    // yesterday's day-3 becomes today's day-4; the best it ever reached survives
    expect(res.data.days).toBe(4);
    expect(res.data.best).toBe(5);
    expect(res.data.reward).toEqual(rewardForStreakDay(4));

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.streakDays).toBe(4);
    expect(user.streakBestDays).toBe(5);
  });

  it("migrates a lapsed legacy streak to day 1 and still keeps the best", async () => {
    const { token, userId } = await signup(h);
    await makeLegacyAccount(userId, dayOffset(h.clock.now(), -4), 6, 6);

    const res = await streak(token);
    expect(res.data.days).toBe(1);
    expect(res.data.best).toBe(6);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.streakBestDays).toBe(6);
  });

  it("pays once when two check-ins race the same day", async () => {
    const { token, userId } = await signup(h);
    await setEnergy(h, token, 0);
    const [a, b] = await Promise.all([streak(token), streak(token)]);
    expect(a.data.days).toBe(1);
    expect(b.data.days).toBe(1);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    expect(wallet.energy).toBe(rewardForStreakDay(1).energy);
    const energyRows = await prisma.ledgerEntry.findMany({
      where: { walletId: wallet.id, currency: "energy", ref: { startsWith: "streak:" } },
    });
    expect(energyRows).toHaveLength(1);
  });
});
