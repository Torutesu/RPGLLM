import type { PrismaClient, Subscription, Wallet } from "@prisma/client";
import { ENERGY } from "@rpgllm/shared";
import type { Clock } from "../clock";
import { nextMidnight } from "../clock";
import { entitlementsFor } from "./entitlements";
import type { Tx } from "../types";

/**
 * Both of these are wrappers over `services/entitlements.ts` — the single place that decides what a
 * subscription is worth. `now` is optional so the existing call sites (routes/me, routes/wallet)
 * keep working; pass the clock's time wherever one is in hand so time-travel moves entitlements too.
 */
export const dailyMaxFor = (sub: Subscription | null, now?: Date): number =>
  entitlementsFor(sub, now).dailyEnergyMax;

export const adFreeFor = (sub: Subscription | null, now?: Date): boolean => entitlementsFor(sub, now).adFree;

/**
 * Lazy daily refill (job `wallet.dailyRefill` runs on read).
 * When now >= dailyRefillAt: energy = max(energy, dailyMax), adRewardsToday = 0,
 * dailyRefillAt = next UTC midnight.
 */
export async function ensureWallet(
  prisma: PrismaClient,
  clock: Clock,
  userId: string,
): Promise<{ wallet: Wallet; subscription: Subscription | null; dailyMax: number }> {
  const [existing, subscription] = await Promise.all([
    prisma.wallet.findUnique({ where: { userId } }),
    prisma.subscription.findUnique({ where: { userId } }),
  ]);
  const now = clock.now();
  const wallet = existing ?? (await prisma.wallet.create({
    data: { userId, energy: ENERGY.FREE_DAILY, coffee: ENERGY.STARTING_COFFEE, dailyRefillAt: nextMidnight(now) },
  }));
  const dailyMax = dailyMaxFor(subscription, now);
  if (now < wallet.dailyRefillAt) return { wallet, subscription, dailyMax };

  const target = Math.max(wallet.energy, dailyMax);
  const delta = target - wallet.energy;
  const refilled = await prisma.wallet.update({
    where: { id: wallet.id },
    data: { energy: target, adRewardsToday: 0, dailyRefillAt: nextMidnight(now) },
  });
  if (delta > 0) {
    await prisma.ledgerEntry.create({
      data: { walletId: wallet.id, currency: "energy", delta, source: "daily_refill", ref: `refill:${now.toISOString().slice(0, 10)}` },
    });
  }
  return { wallet: refilled, subscription, dailyMax };
}

export class EnergyRequiredError extends Error {
  constructor() { super("ENERGY_REQUIRED"); }
}

/** Decrement 1 energy + write the spend LedgerEntry in the caller's transaction. Throws when empty. */
export async function spendEnergy(tx: Tx, walletId: string, ref: string): Promise<number> {
  const res = await tx.wallet.updateMany({
    where: { id: walletId, energy: { gte: ENERGY.ACTION_COST } },
    data: { energy: { decrement: ENERGY.ACTION_COST } },
  });
  if (res.count === 0) throw new EnergyRequiredError();
  await tx.ledgerEntry.create({
    data: { walletId, currency: "energy", delta: -ENERGY.ACTION_COST, source: "spend", ref },
  });
  const w = await tx.wallet.findUniqueOrThrow({ where: { id: walletId }, select: { energy: true } });
  return w.energy;
}

/** Refund one energy when a generation came back with meta.fallback = true (CLAUDE.md rule 6). */
export async function refundEnergy(prisma: PrismaClient, walletId: string, ref: string): Promise<number> {
  return await prisma.$transaction(async (tx) => {
    const w = await tx.wallet.update({ where: { id: walletId }, data: { energy: { increment: ENERGY.ACTION_COST } } });
    await tx.ledgerEntry.create({
      data: { walletId, currency: "energy", delta: ENERGY.ACTION_COST, source: "admin", ref: `refund:${ref}` },
    });
    return w.energy;
  });
}

export async function currentEnergy(prisma: PrismaClient, walletId: string): Promise<number> {
  const w = await prisma.wallet.findUnique({ where: { id: walletId }, select: { energy: true } });
  return w?.energy ?? 0;
}
