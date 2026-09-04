import type { PrismaClient, User } from "@prisma/client";
import { STREAK_LADDER, rewardForStreakDay } from "@rpgllm/shared";
import type { Clock } from "../clock";
import type { Tx } from "../types";
import { ensureWallet } from "./wallet";

/**
 * Daily streak + check-in.
 *
 * The streak lives on **`User.streakDays` / `streakBestDays` / `streakLastAt`** (Agent O). Agent L
 * originally derived it from the `LedgerEntry` row each check-in writes, because the columns had
 * not landed; that made the streak only as durable as the ledger (a retention policy pruning
 * `LedgerEntry` would silently reset everyone) — see build-notes "Orchestrator — streak storage".
 *
 * The ledger is still written on every payout: it stays the **payment record** (and the wallet
 * screen renders it), with the same `ref = "streak:<YYYY-MM-DD>:<day>:<best>"` shape, which is also
 * what `migrateLegacyStreak()` reads once per account to carry a pre-columns streak across.
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

/** What the columns say, normalised: `day` is the UTC date of the last check-in. */
interface Columns { date: string | null; days: number; best: number; lastAt: Date | null }

const ladderFor = (days: number): StreakLadderRow[] =>
  STREAK_LADDER.map((row) => ({ ...row, reached: row.day <= Math.min(days, STREAK_LADDER.length) }));

function parseRef(ref: string | null | undefined): { date: string; days: number; best: number } | null {
  if (!ref?.startsWith(PREFIX)) return null;
  const [date, day, best] = ref.slice(PREFIX.length).split(":");
  if (!date) return null;
  const d = Number(day);
  const b = Number(best);
  return { date, days: Number.isFinite(d) && d > 0 ? d : 1, best: Number.isFinite(b) && b > 0 ? b : 1 };
}

/**
 * Opportunistic migration: an account that checked in before the columns existed has
 * `streakLastAt = null` but a `streak:` ledger row. Read it once, write the columns, and the
 * account keeps its days. Runs at most once per account (afterwards `streakLastAt` is set), and is
 * a no-op for everyone who has never checked in.
 */
export async function migrateLegacyStreak(
  prisma: PrismaClient,
  user: Pick<User, "id" | "streakDays" | "streakBestDays" | "streakLastAt">,
  walletId: string,
): Promise<Columns> {
  if (user.streakLastAt) {
    return { date: utcDay(user.streakLastAt), days: user.streakDays, best: user.streakBestDays, lastAt: user.streakLastAt };
  }
  const row = await prisma.ledgerEntry.findFirst({
    where: { walletId, currency: "energy", source: "daily_refill", ref: { startsWith: PREFIX } },
    orderBy: { createdAt: "desc" },
    select: { ref: true, createdAt: true },
  });
  const legacy = parseRef(row?.ref);
  if (!legacy || !row) return { date: null, days: 0, best: user.streakBestDays, lastAt: null };

  // Prefer the ledger row's own timestamp when it agrees with the encoded date (it carries the
  // clock the check-in ran on, time travel included); otherwise pin to that date's midnight.
  const lastAt = utcDay(row.createdAt) === legacy.date ? row.createdAt : new Date(`${legacy.date}T00:00:00.000Z`);
  const best = Math.max(legacy.best, legacy.days, user.streakBestDays);
  await prisma.user.updateMany({
    where: { id: user.id, streakLastAt: null },
    data: { streakDays: legacy.days, streakBestDays: best, streakLastAt: lastAt },
  });
  return { date: legacy.date, days: legacy.days, best, lastAt };
}

async function loadColumns(prisma: PrismaClient, userId: string, walletId: string): Promise<Columns> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, streakDays: true, streakBestDays: true, streakLastAt: true },
  });
  return await migrateLegacyStreak(prisma, user, walletId);
}

const stateFor = (days: number, best: number, claimedToday: boolean, reward: StreakState["reward"]): StreakState =>
  ({ days, best, claimedToday, reward, ladder: ladderFor(days) });

/**
 * Advance the streak for today and pay the ladder. Idempotent per UTC day: a second call the same
 * day pays nothing, reports `claimedToday: true`, and still reports what today paid.
 */
export async function checkIn(prisma: PrismaClient, clock: Clock, userId: string): Promise<StreakState> {
  const { wallet, dailyMax } = await ensureWallet(prisma, clock, userId);
  const now = clock.now();
  const today = utcDay(now);
  const current = await loadColumns(prisma, userId, wallet.id);

  if (current.date === today) return stateFor(current.days, current.best, true, rewardForStreakDay(current.days));

  const days = current.date === dayBefore(today) ? current.days + 1 : 1;
  const best = Math.max(days, current.best);
  const reward = rewardForStreakDay(days);
  const ref = `${PREFIX}${today}:${days}:${best}`;

  // The streak **tops the tank back up**, it never overflows it: energy is capped at the wallet's
  // daily maximum (the same ceiling `ensureWallet` refills to), so a player who is already full
  // gets the coffee and gems and no free headroom. Coffee and gems have no ceiling.
  const energyGrant = Math.max(0, Math.min(reward.energy, dailyMax - wallet.energy));

  const paid = await prisma.$transaction(async (tx) => {
    // Claim the day with a conditional update: two tabs opening at once, or the `/v1/me` check-in
    // racing `GET /v1/streak`, and only one of them moves `streakLastAt` off its previous value.
    const claim = await tx.user.updateMany({
      where: { id: userId, streakLastAt: current.lastAt },
      data: { streakDays: days, streakBestDays: best, streakLastAt: now },
    });
    if (claim.count === 0) return false;
    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        energy: { increment: energyGrant },
        coffee: { increment: reward.coffee },
        gems: { increment: reward.gems },
      },
    });
    await writeLedger(tx, wallet.id, ref, now, { energy: energyGrant, coffee: reward.coffee, gems: reward.gems });
    return true;
  });

  if (!paid) {
    // The other caller won the day; report what it wrote.
    const after = await loadColumns(prisma, userId, wallet.id);
    return stateFor(after.days, after.best, true, rewardForStreakDay(after.days));
  }
  return stateFor(days, best, false, reward);
}

/** The payment record. The energy row is written even at +0: it is the receipt for the day. */
async function writeLedger(
  tx: Tx,
  walletId: string,
  ref: string,
  now: Date,
  amounts: { energy: number; coffee: number; gems: number },
): Promise<void> {
  const rows = [
    { currency: "energy" as const, delta: amounts.energy, always: true },
    { currency: "coffee" as const, delta: amounts.coffee, always: false },
    { currency: "gems" as const, delta: amounts.gems, always: false },
  ].filter((r) => r.always || r.delta > 0);
  for (const r of rows) {
    await tx.ledgerEntry.create({
      data: { walletId, currency: r.currency, delta: r.delta, source: "daily_refill", ref, createdAt: now },
    });
  }
}

/** Read-only view (no payout), for anything that must not mutate the wallet. */
export async function readStreak(prisma: PrismaClient, clock: Clock, userId: string): Promise<StreakState> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { streakDays: true, streakBestDays: true, streakLastAt: true },
  });
  const today = utcDay(clock.now());
  if (!user.streakLastAt) return stateFor(0, user.streakBestDays, false, null);
  const date = utcDay(user.streakLastAt);
  // A streak stays "alive" through the day after its last check-in — that is the day you can
  // still extend it. Older than that and the ladder is back to zero.
  const alive = date === today || date === dayBefore(today);
  return stateFor(
    alive ? user.streakDays : 0,
    user.streakBestDays,
    date === today,
    date === today ? rewardForStreakDay(user.streakDays) : null,
  );
}
