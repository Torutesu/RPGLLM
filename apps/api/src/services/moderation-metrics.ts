/**
 * Moderation, measured (gtm.md §5: "モデレーション費用をユニットエコノミクスに入れていないなら、
 * それは計画ではなく願望").
 *
 * Every number in `WORLD_MODERATION` was picked for a product with no users: three distinct
 * reporters, a day of SLA, a day of cooldown, twenty minutes on a claim. The point of this surface
 * is to make those four **re-derivable** rather than permanent — so it returns the queue as it
 * actually behaves next to the thresholds actually in force, and the two numbers an operator needs
 * before they can price any of it: how much reviewer time the last week cost, and what the worlds
 * that time was spent on cost to generate.
 *
 * ### Where each number comes from, and what it cannot say
 *
 * There is no decision log table. Three consequences, stated here rather than discovered later:
 *
 *  - **Decisions are read off `World` rows** (`reviewedAt` + `reviewedBy`), so a world reviewed
 *    twice inside the window counts once — the latest decision. `reviewedBy` is what separates a
 *    human decision from the pre-publish safety gate, which notifies the creator but writes no
 *    reviewer.
 *  - **Approved vs rejected** is `rejectedReason` (set by a rejection, cleared by an approval —
 *    the same field `resubmitCooldownHours` keys on) together with `status`. A rejection filed with
 *    an empty reason whose creator then republished it privately would read as an approval; that is
 *    the one hole, and it is the same hole the cooldown has.
 *  - **Latency** is `reviewedAt - reviewRequestedAt`, which is only measurable because the review
 *    decision stops clearing `reviewRequestedAt` (see `routes/admin-worlds.ts`). Every queue read
 *    filters on `status = "review"`, so a decided world keeping the timestamp of the queue it came
 *    out of is invisible to all of them, and re-entering the queue always rewrites it.
 *
 * **Pulls** are counted from the creator notification (`world_pulled`), because `World.pulledAt` is
 * cleared the moment a human decides — so the row remembers "is pulled", never "was pulled". The
 * notification is durable, timestamped, and written in the same transaction as the takedown.
 * `pullsReapproved` — a pull a human then put straight back on the shelf — is the honest signal
 * that `REPORTS_TO_PULL` is too low, and it is that same log read forward to the next decision.
 *
 * **Percentiles over an empty window are `null`, not `0`**: nobody reviewed anything is not "it
 * took no time". Rates over zero are `0`, never `NaN` — `safeRate` is the only division here.
 */
import { WORLD_MODERATION } from "@rpgllm/shared";
import type { PrismaClient } from "@prisma/client";
import { envNum } from "../env";
import { worldModerationConfig } from "./world-moderation-config";
import { worldModerationOps } from "./world-moderation";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The window every "last 7d" number is measured over. */
export const METRICS_WINDOW_DAYS = 7;

/**
 * Minutes of a human's attention one world review costs. **An operator supplies this**; we do not
 * invent it, because it is the number their own moderation contract prices and the only input here
 * that is not observable from the database.
 *
 * The default is `WORLD_MODERATION.CLAIM_MINUTES` — the length this service already leases a world
 * to a reviewer for, chosen because reading a bible in two locales with eight characters and the
 * complaints takes that long. An earlier draft defaulted to two minutes, which was a planning guess
 * from gtm.md and quietly under-reported the cost of this queue by an order of magnitude; the
 * system's own assertion about how long a review takes is the honest floor.
 */
export const REVIEW_MINUTES_ENV = "WORLD_REVIEW_MINUTES_PER_WORLD";
export const REVIEW_MINUTES_DEFAULT = WORLD_MODERATION.CLAIM_MINUTES;
/** Past this, the value is a typo (seconds pasted into a minutes field), not a policy. */
const REVIEW_MINUTES_MAX = 600;

export function reviewMinutesPerWorld(): number {
  const raw = envNum(REVIEW_MINUTES_ENV, REVIEW_MINUTES_DEFAULT);
  return Number.isFinite(raw) && raw > 0 && raw <= REVIEW_MINUTES_MAX ? raw : REVIEW_MINUTES_DEFAULT;
}

/** A rate over nothing is 0, not NaN and not Infinity. The only division in this file. */
export const safeRate = (numerator: number, denominator: number): number =>
  denominator > 0 ? numerator / denominator : 0;

const round = (n: number, places: number): number => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

/** Nearest-rank percentile over a sorted-ascending sample; `null` for an empty sample. */
export function percentile(sortedAsc: readonly number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const rank = Math.ceil(p * sortedAsc.length);
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, rank - 1))] ?? null;
}

/** Median: the middle, or the mean of the two middles. `null` for an empty sample. */
export function median(sortedAsc: readonly number[]): number | null {
  if (sortedAsc.length === 0) return null;
  const mid = Math.floor(sortedAsc.length / 2);
  return sortedAsc.length % 2 === 1
    ? (sortedAsc[mid] ?? null)
    : ((sortedAsc[mid - 1] ?? 0) + (sortedAsc[mid] ?? 0)) / 2;
}

export interface ModerationMetrics {
  thresholds: { reportsToPull: number; reviewSlaHours: number; resubmitCooldownHours: number; claimMinutes: number };
  queue: { waiting: number; overdue: number; appeals: number; pulled: number; oldestWaitingHours: number };
  decisions: {
    last7d: number; approved: number; rejected: number; approvalRate: number;
    medianLatencyHours: number | null; p90LatencyHours: number | null;
  };
  reports: { open: number; last7d: number; perThousandPlays: number; pullsLast7d: number; pullsReapproved: number };
  economics: { worldsReviewedLast7d: number; estimatedReviewMinutes: number; generationCostUsd: number };
}

const isRejected = (world: { status: string; rejectedReason: string }): boolean =>
  world.status === "rejected" || world.rejectedReason !== "";

/** `Notification.payload.approved === true` — a decision that put the world back on the shelf. */
const wasApproved = (payload: unknown): boolean =>
  Boolean(payload && typeof payload === "object" && (payload as Record<string, unknown>)["approved"] === true);

export async function moderationMetrics(prisma: PrismaClient, now: Date): Promise<ModerationMetrics> {
  const config = worldModerationConfig();
  const since = new Date(now.getTime() - METRICS_WINDOW_DAYS * DAY_MS);

  const [ops, decided, reportsLast7d, reportsAllTime, plays, pulls, reviewedNotes] = await Promise.all([
    // The queue, from the same function the ops surface and the scheduled sweep read.
    worldModerationOps(prisma, now),
    prisma.world.findMany({
      // `reviewedBy` is the human: the pre-publish gate refuses worlds without writing one.
      where: { reviewedAt: { gte: since }, reviewedBy: { not: null } },
      select: { id: true, status: true, rejectedReason: true, reviewedAt: true, reviewRequestedAt: true, generationId: true },
    }),
    prisma.report.count({ where: { target: "world", createdAt: { gte: since } } }),
    prisma.report.count({ where: { target: "world" } }),
    prisma.world.aggregate({ _sum: { playCount: true } }),
    prisma.notification.findMany({
      where: { kind: "world_pulled", createdAt: { gte: since } },
      select: { target: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.notification.findMany({
      where: { kind: "world_reviewed", createdAt: { gte: since } },
      select: { target: true, createdAt: true, payload: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  /* ---- decisions ---- */
  const rejected = decided.filter(isRejected).length;
  const approved = decided.length - rejected;
  const latencies = decided
    .flatMap((w) => (w.reviewedAt && w.reviewRequestedAt
      ? [(w.reviewedAt.getTime() - w.reviewRequestedAt.getTime()) / HOUR_MS]
      : []))
    .filter((h) => h >= 0)
    .sort((a, b) => a - b);
  const med = median(latencies);
  const p90 = percentile(latencies, 0.9);

  /* ---- pulls, and the pulls a human disagreed with ---- */
  const approvalsAfter = new Map<string, number[]>();
  for (const note of reviewedNotes) {
    if (!note.target || !wasApproved(note.payload)) continue;
    const list = approvalsAfter.get(note.target) ?? [];
    list.push(note.createdAt.getTime());
    approvalsAfter.set(note.target, list);
  }
  const pullsReapproved = pulls.filter((pull) =>
    (approvalsAfter.get(pull.target ?? "") ?? []).some((at) => at >= pull.createdAt.getTime())).length;

  /**
   * Reports per thousand plays is **lifetime over lifetime**, and has to be: a play leaves no row
   * with a timestamp on it (`World.playCount` is a counter), so a 7-day numerator over an all-time
   * denominator would quietly understate the rate by however long the product has been running.
   * Both sides being cumulative is the comparison that means something: how many complaints a
   * thousand plays produce, which is exactly what `REPORTS_TO_PULL` should be derived from.
   */
  const perThousandPlays = safeRate(reportsAllTime, plays._sum.playCount ?? 0) * 1000;

  /* ---- economics ---- */
  const generationIds = decided.flatMap((w) => (w.generationId ? [w.generationId] : []));
  const cost = generationIds.length > 0
    ? await prisma.generationLog.aggregate({ _sum: { costUsd: true }, where: { id: { in: generationIds } } })
    : null;

  return {
    thresholds: {
      reportsToPull: config.reportsToPull,
      reviewSlaHours: config.reviewSlaHours,
      resubmitCooldownHours: config.resubmitCooldownHours,
      claimMinutes: config.claimMinutes,
    },
    queue: {
      waiting: ops.inReview,
      overdue: ops.overdueReviews,
      appeals: ops.appealedWorlds,
      pulled: ops.pulledWorlds,
      oldestWaitingHours: round(ops.oldestWaitHours, 2),
    },
    decisions: {
      last7d: decided.length,
      approved,
      rejected,
      approvalRate: round(safeRate(approved, decided.length), 4),
      medianLatencyHours: med === null ? null : round(med, 2),
      p90LatencyHours: p90 === null ? null : round(p90, 2),
    },
    reports: {
      open: ops.openWorldReports,
      last7d: reportsLast7d,
      perThousandPlays: round(perThousandPlays, 3),
      pullsLast7d: pulls.length,
      pullsReapproved,
    },
    economics: {
      worldsReviewedLast7d: decided.length,
      estimatedReviewMinutes: round(decided.length * reviewMinutesPerWorld(), 2),
      generationCostUsd: round(Number(cost?._sum.costUsd ?? 0), 6),
    },
  };
}
