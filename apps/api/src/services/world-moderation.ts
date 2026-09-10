/**
 * What happens to a world **after** a human approved it (WORLD_MODERATION).
 *
 * A person approving a world once is not the same as it staying fine. Reports are the only signal
 * that scales with the audience, so enough of them takes a world off the shelf and puts it back in
 * front of a person — automatically, at the moment the threshold is crossed, without waiting for
 * anyone to notice.
 *
 * Three rules the rest of the file exists to keep:
 *
 *  1. **Distinct reporters, not reports.** One person can never pull a world down, and the same
 *     person reporting twice must not count twice. The duplicate guard in `POST /v1/moderation/report`
 *     409s, but nothing here depends on that being the only path to a second row.
 *  2. **Pulling is not deleting.** A pulled world goes back to `review` with its play history, its
 *     cast and its personas intact; its creator and anyone already mid-game keep playing it. Only
 *     Explore loses it.
 *  3. **Presets are ours.** A report on a preset is a report about content we shipped; it belongs in
 *     the report queue, never on a takedown trigger.
 */
import type { Prisma, PrismaClient, World } from "@prisma/client";
import { t, type Locale } from "@rpgllm/shared";
import type { LocaleKey } from "./locale";
import { tellCreator } from "./creator-notify";
import { clearedAppeal, liveAppeal, type AppealCase } from "./world-appeal";
import { activeClaim, releasedClaim, type ReviewClaim } from "./world-review-claim";
import { worldModerationConfig } from "./world-moderation-config";
import { pauseTrust, trustFor, type CreatorTrust } from "./creator-trust";
import { storedDigest, type ReviewDigest } from "./review-digest";
import { logLine } from "../middleware/request-log";
import type { Tx } from "../types";

const HOUR_MS = 60 * 60 * 1000;

/** When this world entered the review queue. Rows that predate `reviewRequestedAt` fall back. */
export const waitingSince = (world: Pick<World, "reviewRequestedAt" | "createdAt">): Date =>
  world.reviewRequestedAt ?? world.createdAt;

/** How long a world has been waiting for a reviewer, in hours (one decimal — this is a queue, not a stopwatch). */
export const waitingHours = (world: Pick<World, "reviewRequestedAt" | "createdAt">, now: Date): number =>
  Math.round((Math.max(0, now.getTime() - waitingSince(world).getTime()) / HOUR_MS) * 10) / 10;

export const isOverdue = (world: Pick<World, "reviewRequestedAt" | "createdAt">, now: Date): boolean =>
  waitingHours(world, now) > worldModerationConfig().reviewSlaHours;

/** True once a world was live and reports took it back off the shelf. `WorldSummaryFullZ.pulled`. */
export const isPulled = (world: Pick<World, "pulledAt">): boolean => world.pulledAt !== null;

/* ------------------------------------------------------------------- the pull ---- */

export interface PullOutcome {
  /** distinct users with an open report against this world, counted inside the transaction */
  reporters: number;
  /** true only for the report that actually crossed the threshold */
  pulled: boolean;
}

/**
 * Count this world's distinct open reporters and, if the threshold is crossed, take it off the
 * shelf — **in the caller's transaction**, so the report and the takedown commit together or not
 * at all.
 *
 * **Why this is safe under concurrency.** Brigading means concurrent reports, and two hazards come
 * with them: under-counting (three simultaneous reporters each see only their own row and nobody
 * pulls) and double-pulling (two of them both decide to pull). Both are closed by taking the
 * `World` row's own lock with `SELECT … FOR UPDATE` *before* counting:
 *
 *   - the lock serialises the count-then-update of every concurrent reporter on this world, and
 *     under READ COMMITTED each waiter re-reads after the holder commits, so the last one in sees
 *     every report that came before it — nobody under-counts;
 *   - the takedown is a conditional `updateMany` on `status = 'published'`, so whoever loses the
 *     race writes nothing. A world already back in `review` is never pulled twice, `pulledAt` keeps
 *     the timestamp of the pull that actually happened, and re-running this is a no-op.
 *
 * The lock is on one row, held for two statements, and only ever taken by the report path — it
 * cannot deadlock against the build job or the review decision, which never lock a `World` row.
 */
export async function pullWorldIfBrigaded(tx: Tx, worldId: string, now: Date): Promise<PullOutcome> {
  const locked = await tx.$queryRaw<
    { id: string; status: string; visibility: string; isPreset: boolean; createdBy: string | null }[]
  >`
    SELECT "id", "status"::text AS "status", "visibility"::text AS "visibility", "isPreset", "createdBy"
      FROM "World" WHERE "id" = ${worldId} FOR UPDATE`;
  const world = locked[0];
  if (!world) return { reporters: 0, pulled: false };

  // Distinct *users*: two reports from one account are one reporter, whatever put them there.
  const reporterRows = await tx.report.findMany({
    where: { target: "world", targetId: worldId, status: "open" },
    distinct: ["userId"],
    select: { userId: true },
  });
  const reporters = reporterRows.length;

  // Presets are ours — a report on one is for a human to read, never a takedown trigger. And only
  // a world actually *in Explore* can be taken out of it: unlisted is a link, not a shelf.
  const eligible = !world.isPreset && world.status === "published" && world.visibility === "public";
  if (!eligible || reporters < worldModerationConfig().reportsToPull) return { reporters, pulled: false };

  const claimed = await tx.world.updateMany({
    // `status` in the WHERE is what makes this idempotent under a lost race.
    where: { id: worldId, status: "published", visibility: "public", isPreset: false },
    // Visibility stays `public`: this world's answer to "may it be listed" has not changed, only
    // "has a person looked at it lately". Approving puts it straight back on the shelf.
    // A pull is a new review cycle nobody asked for, so it arrives unclaimed and with no appeal
    // attached: whatever rejection an old appeal argued with is not what this world is here for.
    data: { status: "review", pulledAt: now, reviewRequestedAt: now, ...clearedAppeal, ...releasedClaim },
  });
  /**
   * A pull **suspends** its creator's sampling trust (gtm.md §2 exit 2). The suspension itself is
   * derived — "has any world in `review` with `pulledAt`" — so it needs no write and lifts by
   * itself when a person decides; what is written here is the guarantee that the first submission
   * after it lifts is read in full, exactly like the first one after graduating. Somebody with a
   * live world off the shelf under objection is precisely who should not be publishing unread, and
   * a brigade still cannot destroy standing it did not earn.
   */
  if (claimed.count > 0 && world.createdBy) await pauseTrust(tx, world.createdBy);
  return { reporters, pulled: claimed.count > 0 };
}

/**
 * Tell the creator their world was taken down for another look — the difference between "not looked
 * at yet" and "pulled" is the whole point of `WorldSummaryFullZ.pulled`, and they should not have to
 * poll for it.
 *
 * Addressed to the **account** (`services/creator-notify.ts`), which is what makes it reliable: it
 * used to go to the creator's most recent persona, so a creator who had never made one — the
 * ordinary case, since the studio is reachable before any persona exists — was told nothing at all
 * when their live world came off the shelf.
 */
export async function tellCreatorPulled(tx: Tx, world: World): Promise<boolean> {
  return await tellCreator(tx, world, { kind: "pulled" });
}

/* -------------------------------------------------------------- the decision ---- */

/**
 * Close the reports a review decision answers. Without this the queue never empties: the world
 * leaves `review` and its open reports sit there forever, re-pulling it the moment one more
 * arrives.
 *
 * `approve` **dismisses** them (a person read the complaint and disagreed); `reject` **actions**
 * them (the complaint was upheld). Either way they stop being open, so the count starts again from
 * zero and the same three reporters cannot pull the world twice for the same reason.
 */
export function resolveWorldReports(
  tx: Tx,
  worldId: string,
  now: Date,
  approved: boolean,
): Promise<Prisma.BatchPayload> {
  return tx.report.updateMany({
    where: { target: "world", targetId: worldId, status: "open" },
    data: { status: approved ? "dismissed" : "actioned", reviewedAt: now },
  });
}

/* --------------------------------------------------------------- the cooldown ---- */

/**
 * When a rejected world may be offered to Explore again, or null if no rejection is standing.
 *
 * Keyed on the **decision**, not on the world's current status (QA-004). Publishing a rejected
 * world `private` rewrites `status` to `ready`, so reading `status === "rejected"` meant three
 * requests with no waiting — public (refused), private (200), public (202) — and a reviewer's "no"
 * cost the creator nothing. `rejectedReason` is written by a rejection and cleared by an approval,
 * so it survives everything the creator can do on their own.
 */
export const resubmitAllowedAt = (world: Pick<World, "rejectedReason" | "reviewedAt">): Date | null =>
  world.rejectedReason !== "" && world.reviewedAt !== null
    ? new Date(world.reviewedAt.getTime() + worldModerationConfig().resubmitCooldownHours * HOUR_MS)
    : null;

/**
 * Hours a rejected world must still wait, or `null` when it may be resubmitted now. Rejection is
 * not forever — but without a cooldown a creator bounces the same world off the queue continuously
 * and a reviewer's decision costs them nothing.
 */
export function resubmitCooldownHours(world: Pick<World, "rejectedReason" | "reviewedAt">, now: Date): number | null {
  const at = resubmitAllowedAt(world);
  if (at === null || now.getTime() >= at.getTime()) return null;
  return Math.max(1, Math.ceil((at.getTime() - now.getTime()) / HOUR_MS));
}

/* -------------------------------------------------------------- the ops signal ---- */

/**
 * What an operator needs to see without being told to look: worlds waiting past the SLA, and
 * worlds the players themselves took off the shelf. Surfaced on `GET /v1/cost` (summary + live,
 * the existing ops surface) and logged by the scheduled sweep.
 */
export interface WorldModerationOps {
  /** worlds in the queue right now */
  inReview: number;
  /** …of which have waited longer than the SLA in force */
  overdueReviews: number;
  /** …of which are there because players reported them, not because a creator asked */
  pulledWorlds: number;
  /** …of which are there because a creator is arguing with a rejection */
  appealedWorlds: number;
  /** …of which a reviewer currently holds. A number that never falls is a stuck reviewer. */
  claimedWorlds: number;
  /** open reports against worlds, whatever their state */
  openWorldReports: number;
  /** the oldest wait in the queue, in hours (0 when the queue is empty) */
  oldestWaitHours: number;
  /**
   * The thresholds **actually in force**, resolved from `WORLD_MODERATION_ENV` over the shipped
   * defaults. An operator who overrode one on this deploy can see here whether the override took,
   * without reading the process environment of a box they may not be able to log into.
   */
  slaHours: number;
  reportsToPull: number;
  resubmitCooldownHours: number;
  claimMinutes: number;
  appealsPerRejection: number;
}

export async function worldModerationOps(prisma: PrismaClient, now: Date): Promise<WorldModerationOps> {
  const config = worldModerationConfig();
  const overdueBefore = new Date(now.getTime() - config.reviewSlaHours * HOUR_MS);
  const [inReview, overdueReviews, pulledWorlds, appealedWorlds, claimedWorlds, openWorldReports, oldest] =
    await Promise.all([
      prisma.world.count({ where: { status: "review" } }),
      prisma.world.count({
        where: {
          status: "review",
          OR: [
            { reviewRequestedAt: { lt: overdueBefore } },
            { reviewRequestedAt: null, createdAt: { lt: overdueBefore } },
          ],
        },
      }),
      prisma.world.count({ where: { status: "review", pulledAt: { not: null } } }),
      prisma.world.count({ where: { status: "review", appealedAt: { not: null } } }),
      // A lapsed lease is not a claim: `claimedUntil` in the past is an unclaimed world.
      prisma.world.count({ where: { status: "review", claimedUntil: { gt: now } } }),
      prisma.report.count({ where: { target: "world", status: "open" } }),
      prisma.world.findFirst({
        where: { status: "review" },
        orderBy: [{ reviewRequestedAt: "asc" }, { createdAt: "asc" }],
        select: { reviewRequestedAt: true, createdAt: true },
      }),
    ]);
  return {
    inReview,
    overdueReviews,
    pulledWorlds,
    appealedWorlds,
    claimedWorlds,
    openWorldReports,
    oldestWaitHours: oldest ? waitingHours(oldest, now) : 0,
    slaHours: config.reviewSlaHours,
    reportsToPull: config.reportsToPull,
    resubmitCooldownHours: config.resubmitCooldownHours,
    claimMinutes: config.claimMinutes,
    appealsPerRejection: config.appealsPerRejection,
  };
}

/**
 * The scheduled half of the ops signal: read the backlog and say so in the log, so "nobody looked
 * at the queue for two days" is answerable from the run history instead of from someone noticing.
 *
 * It rides the **`world-build` job's** advisory lock and `JobRun` row rather than adding a second
 * mechanism: `world-build` is already the world-lifecycle job (build, then sweep what got stuck),
 * runs every minute, and the scheduler's job table lives in `@rpgllm/shared`, which this pass does
 * not own (see `pipeline/status/build-notes.md`). Nothing here writes: the takedown happens in the
 * report's own transaction, exactly once, at the moment the threshold is crossed. A sweep that
 * *also* pulled worlds would be a second path to the same state machine and a slower one.
 */
export async function sweepWorldModeration(prisma: PrismaClient, now: Date): Promise<WorldModerationOps> {
  const ops = await worldModerationOps(prisma, now);
  // Quiet while there is nothing to do — this runs every minute.
  if (ops.overdueReviews > 0 || ops.pulledWorlds > 0 || ops.appealedWorlds > 0) {
    logLine({
      level: "warn",
      msg: "world.review.backlog",
      inReview: ops.inReview,
      overdue: ops.overdueReviews,
      pulled: ops.pulledWorlds,
      appealed: ops.appealedWorlds,
      claimed: ops.claimedWorlds,
      openReports: ops.openWorldReports,
      oldestWaitHours: ops.oldestWaitHours,
      slaHours: ops.slaHours,
    });
  }
  return ops;
}

/* ------------------------------------------------------------------- the queue ---- */

export const REVIEW_QUEUE_DEFAULT_LIMIT = 25;
export const REVIEW_QUEUE_MAX_LIMIT = 100;
/** How many complaints one queue card carries. A reviewer reads the first few, not the hundredth. */
export const REPORTS_PER_WORLD = 20;

export interface QueueComplaint {
  reason: string;
  note: string;
  createdAt: string;
}

export interface QueueEntry {
  world: World;
  reporters: number;
  waitingHours: number;
  overdue: boolean;
  pulled: boolean;
  reports: QueueComplaint[];
  /** the creator's case, when this world is here because they appealed a rejection */
  appeal: AppealCase | null;
  /** the reviewer holding it right now, or null — a lapsed lease is not a claim */
  claim: ReviewClaim | null;
  /**
   * What to look at first (gtm.md §2 exit 3), computed once at submission and **read** here — never
   * recomputed, because a queue that got slower as it got longer is a queue nobody works. `null` is
   * an ordinary card: nothing in this file, or downstream of it, reads a digest to decide anything.
   */
  digest: ReviewDigest | null;
  /** the creator's standing (exit 2). Admin-only — never on another player's view of them. */
  creatorTrust: CreatorTrust | null;
}

export interface ReviewQueue {
  entries: QueueEntry[];
  /** overdue across the **whole** queue, not just this page — an ops number, not a page number */
  overdueCount: number;
  /** appeals across the whole queue: people waiting on a decision that has already been made once */
  appealCount: number;
  total: number;
  nextOffset: number | null;
}

interface QueueRow extends World {
  reporters: number;
}

/**
 * The queue, worst thing first — for the reviewer who is asking.
 *
 * Three tiers, in this order:
 *
 *  1. **Not held by somebody else.** A world another reviewer is reading in this moment ranks
 *     *last*, not hidden: hiding it would make the queue's length depend on who is looking, and
 *     would hide a stale claim exactly when someone needs to notice it. The lease expires by
 *     itself, so a world only stays down here for `CLAIM_MINUTES`.
 *  2. **Somebody is waiting on you**: a world players pulled off the shelf, and a world whose
 *     creator appealed. Both are a person already on the other end of a decision — a pulled world
 *     is live content being objected to now, an appeal is a creator told "no" once and asking a
 *     human to look again. A first submission is nobody's emergency, so it sorts below both.
 *  3. Then more reporters before fewer, oldest wait first, and id so a page boundary is stable.
 */
export async function reviewQueue(
  prisma: PrismaClient,
  now: Date,
  opts: { limit?: number; offset?: number; reviewer?: string } = {},
): Promise<ReviewQueue> {
  const limit = Math.min(REVIEW_QUEUE_MAX_LIMIT, Math.max(1, Math.trunc(opts.limit ?? REVIEW_QUEUE_DEFAULT_LIMIT)));
  const offset = Math.max(0, Math.trunc(opts.offset ?? 0));
  // No reviewer identity means every live claim is somebody else's — which is the honest answer.
  const reviewer = opts.reviewer ?? "";

  const rows = await prisma.$queryRaw<QueueRow[]>`
    SELECT w.*, COALESCE(r."reporters", 0) AS "reporters"
      FROM "World" w
      LEFT JOIN (
        SELECT "targetId", count(DISTINCT "userId")::int AS "reporters"
          FROM "Report" WHERE "target" = 'world' AND "status" = 'open' GROUP BY "targetId"
      ) r ON r."targetId" = w."id"
     WHERE w."status" = 'review'
     ORDER BY COALESCE(w."claimedUntil" > ${now}::timestamp
                       AND w."claimedBy" IS DISTINCT FROM ${reviewer}, false) ASC,
              (w."pulledAt" IS NOT NULL OR w."appealedAt" IS NOT NULL) DESC,
              COALESCE(r."reporters", 0) DESC,
              COALESCE(w."reviewRequestedAt", w."createdAt") ASC,
              w."id" ASC
     LIMIT ${limit + 1} OFFSET ${offset}`;

  const page = rows.slice(0, limit);
  const ids = page.map((w) => w.id);
  const complaints =
    ids.length === 0
      ? []
      : await prisma.report.findMany({
          where: { target: "world", targetId: { in: ids }, status: "open" },
          orderBy: { createdAt: "desc" },
          select: { targetId: true, reason: true, note: true, createdAt: true },
          take: REPORTS_PER_WORLD * ids.length,
        });

  const byWorld = new Map<string, QueueComplaint[]>();
  for (const c of complaints) {
    const list = byWorld.get(c.targetId) ?? [];
    if (list.length < REPORTS_PER_WORLD)
      list.push({ reason: c.reason, note: c.note, createdAt: c.createdAt.toISOString() });
    byWorld.set(c.targetId, list);
  }

  const [total, ops, trust] = await Promise.all([
    prisma.world.count({ where: { status: "review" } }),
    worldModerationOps(prisma, now),
    trustFor(
      prisma,
      page.flatMap((w) => (w.createdBy ? [w.createdBy] : [])),
    ),
  ]);

  return {
    entries: page.map((row) => ({
      world: row,
      reporters: Number(row.reporters),
      waitingHours: waitingHours(row, now),
      overdue: isOverdue(row, now),
      pulled: isPulled(row),
      reports: byWorld.get(row.id) ?? [],
      appeal: liveAppeal(row),
      claim: activeClaim(row, now),
      digest: storedDigest(row),
      creatorTrust: row.createdBy ? (trust.get(row.createdBy) ?? null) : null,
    })),
    overdueCount: ops.overdueReviews,
    appealCount: ops.appealedWorlds,
    total,
    nextOffset: rows.length > limit ? offset + limit : null,
  };
}
