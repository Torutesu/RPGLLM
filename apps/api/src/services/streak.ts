import type { PrismaClient } from "@prisma/client";
import { STREAK_LADDER, rewardForStreakDay } from "@rpgllm/shared";
import type { Clock } from "../clock";
import { ensureWallet } from "./wallet";

/**
 * Daily streak + check-in.
 *
 * There is no `User.streakDays` column and `prisma/schema.prisma` is frozen for this pass, so the
 * streak is **derived from the ledger it pays into**: every check-in writes an energy `LedgerEntry`
 * whose ref encodes the whole state — `streak:<YYYY-MM-DD>:<day>:<best>`. One `findFirst` on the
 * newest such row is the entire read, the payout and the history can never disagree, and the wallet
 * screen already shows the entries. Recorded as a deviation in build-notes "## Agent L".
 */
const PREFIX = "streak:";
const utcDay = (d: Date): string => d.toISOString().slice(0, 10);
const dayBefore = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return utcDay(d);
};

export interface StreakLadderRow {
  day: number;
  energy: number;
  coffee: number;
  gems: number;
  reached: boolean;
}
export interface StreakState {
  days: number;
  best: number;
  /** true when today's reward had already been paid before this call */
  claimedToday: boolean;
  /**
   * The ladder value today is worth (kept non-null for the rest of the day so the card can show
   * it). The energy actually credited is capped at the wallet's daily maximum — see `checkIn`.
   */
  reward: { energy: number; coffee: number; gems: number } | null;
  ladder: StreakLadderRow[];
}

interface Parsed { date: string; day: number; best: number }

function parseRef(ref: string | null): Parsed | null {
  if (!ref || !ref.startsWith(PREFIX)) return null;
  const [date, day, best] = ref.slice(PREFIX.length).split(":");
  if (!date) return null;
  const d = Number(day);
  const b = Number(best);
  return { date, day: Number.isFinite(d) && d > 0 ? d : 1, best: Number.isFinite(b) && b > 0 ? b : 1 };
}

const ladderFor = (days: number): StreakLadderRow[] =>
  STREAK_LADDER.map((row) => ({ ...row, reached: row.day <= Math.min(days, STREAK_LADDER.length) }));

async function latestFor(prisma: PrismaClient, walletId: string): Promise<Parsed | null> {
  const row = await prisma.ledgerEntry.findFirst({
    where: { walletId, currency: "energy", source: "daily_refill", ref: { startsWith: PREFIX } },
    orderBy: { createdAt: "desc" },
    select: { ref: true },
  });
  return parseRef(row?.ref ?? null);
}

/**
 * Advance the streak for today and pay the ladder. Idempotent per UTC day: a second call the same
 * day pays nothing, reports `claimedToday: true`, and still reports what today paid.
 */
export async function checkIn(prisma: PrismaClient, clock: Clock, userId: string): Promise<StreakState> {
  const { wallet, dailyMax } = await ensureWallet(prisma, clock, userId);
  const now = clock.now();
  const today = utcDay(now);
  const latest = await latestFor(prisma, wallet.id);

  if (latest && latest.date === today) {
    return {
      days: latest.day,
      best: latest.best,
      claimedToday: true,
      reward: rewardForStreakDay(latest.day),
      ladder: ladderFor(latest.day),
    };
  }

  const days = latest && latest.date === dayBefore(today) ? latest.day + 1 : 1;
  const best = Math.max(days, latest?.best ?? 0);
  const reward = rewardForStreakDay(days);
  const ref = `${PREFIX}${today}:${days}:${best}`;

  // The streak **tops the tank back up**, it never overflows it: energy is capped at the wallet's
  // daily maximum (the same ceiling `ensureWallet` refills to), so a player who is already full
  // gets the coffee and gems and no free headroom. Coffee and gems have no ceiling.
  const energyGrant = Math.max(0, Math.min(reward.energy, dailyMax - wallet.energy));

  await prisma.$transaction(async (tx) => {
    // Re-check inside the transaction: two tabs opening at once must not pay twice.
    const again = await tx.ledgerEntry.findFirst({ where: { walletId: wallet.id, ref }, select: { id: true } });
    if (again) return;
    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        energy: { increment: energyGrant },
        coffee: { increment: reward.coffee },
        gems: { increment: reward.gems },
      },
    });
    const rows = [
      // The energy row is always written even at +0: it is the streak's own state record.
      { currency: "energy" as const, delta: energyGrant, always: true },
      { currency: "coffee" as const, delta: reward.coffee, always: false },
      { currency: "gems" as const, delta: reward.gems, always: false },
    ].filter((r) => r.always || r.delta > 0);
    for (const r of rows) {
      await tx.ledgerEntry.create({
        data: { walletId: wallet.id, currency: r.currency, delta: r.delta, source: "daily_refill", ref, createdAt: now },
      });
    }
  });

  return { days, best, claimedToday: false, reward, ladder: ladderFor(days) };
}

/** Read-only view (no payout), for anything that must not mutate the wallet. */
export async function readStreak(prisma: PrismaClient, clock: Clock, walletId: string): Promise<StreakState> {
  const latest = await latestFor(prisma, walletId);
  const today = utcDay(clock.now());
  if (!latest) return { days: 0, best: 0, claimedToday: false, reward: null, ladder: ladderFor(0) };
  const alive = latest.date === today || latest.date === dayBefore(today);
  const days = alive ? latest.day : 0;
  return {
    days,
    best: latest.best,
    claimedToday: latest.date === today,
    reward: latest.date === today ? rewardForStreakDay(latest.day) : null,
    ladder: ladderFor(days),
  };
}
