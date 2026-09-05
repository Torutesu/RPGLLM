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
import { WORLD_MODERATION, t, type Locale } from "@rpgllm/shared";
import type { LocaleKey } from "./locale";
import { logLine } from "../middleware/request-log";
import { notify } from "./notify";
import type { Tx } from "../types";

const HOUR_MS = 60 * 60 * 1000;

/** When this world entered the review queue. Rows that predate `reviewRequestedAt` fall back. */
export const waitingSince = (world: Pick<World, "reviewRequestedAt" | "createdAt">): Date =>
  world.reviewRequestedAt ?? world.createdAt;

/** How long a world has been waiting for a reviewer, in hours (one decimal — this is a queue, not a stopwatch). */
export const waitingHours = (world: Pick<World, "reviewRequestedAt" | "createdAt">, now: Date): number =>
  Math.round(Math.max(0, now.getTime() - waitingSince(world).getTime()) / HOUR_MS * 10) / 10;

export const isOverdue = (world: Pick<World, "reviewRequestedAt" | "createdAt">, now: Date): boolean =>
  waitingHours(world, now) > WORLD_MODERATION.REVIEW_SLA_HOURS;

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
  const locked = await tx.$queryRaw<{ id: string; status: string; visibility: string; isPreset: boolean }[]>`
    SELECT "id", "status"::text AS "status", "visibility"::text AS "visibility", "isPreset"
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
  if (!eligible || reporters < WORLD_MODERATION.REPORTS_TO_PULL) return { reporters, pulled: false };

  const claimed = await tx.world.updateMany({
    // `status` in the WHERE is what makes this idempotent under a lost race.
    where: { id: worldId, status: "published", visibility: "public", isPreset: false },
    // Visibility stays `public`: this world's answer to "may it be listed" has not changed, only
    // "has a person looked at it lately". Approving puts it straight back on the shelf.
    data: { status: "review", pulledAt: now, reviewRequestedAt: now },
  });
  return { reporters, pulled: claimed.count > 0 };
}

/**
 * Tell the creator their world was taken down for another look — the difference between "not looked
 * at yet" and "pulled" is the whole point of `WorldSummaryFullZ.pulled`, and they should not have to
 * poll for it. Best-effort, exactly like the build job's: notifications hang off a persona, and a
 * creator may not have one.
 */
export async function tellCreatorPulled(tx: Tx, world: World, locale: LocaleKey): Promise<void> {
  if (!world.createdBy) return;
  const persona = await tx.persona.findFirst({
    where: { userId: world.createdBy },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!persona) return;
  await notify(tx, {
    personaId: persona.id,
    kind: "unlock",
    target: `world:${world.id}`,
    text: t(locale as Locale, "studioPulled"),
    payload: { worldId: world.id, slug: world.slug, pulled: true },
  });
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
export function resolveWorldReports(tx: Tx, worldId: string, now: Date, approved: boolean): Promise<Prisma.BatchPayload> {
  return tx.report.updateMany({
    where: { target: "world", targetId: worldId, status: "open" },
    data: { status: approved ? "dismissed" : "actioned", reviewedAt: now },
  });
}

/* --------------------------------------------------------------- the cooldown ---- */

/** When a rejected world may be offered to Explore again, or null if it is not rejected. */
export const resubmitAllowedAt = (world: Pick<World, "status" | "reviewedAt">): Date | null =>
  world.status === "rejected" && world.reviewedAt !== null
    ? new Date(world.reviewedAt.getTime() + WORLD_MODERATION.RESUBMIT_COOLDOWN_HOURS * HOUR_MS)
    : null;

/**
 * Hours a rejected world must still wait, or `null` when it may be resubmitted now. Rejection is
 * not forever — but without a cooldown a creator bounces the same world off the queue continuously
 * and a reviewer's decision costs them nothing.
 */
export function resubmitCooldownHours(world: Pick<World, "status" | "reviewedAt">, now: Date): number | null {
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
  /** …of which have waited longer than WORLD_MODERATION.REVIEW_SLA_HOURS */
  overdueReviews: number;
  /** …of which are there because players reported them, not because a creator asked */
  pulledWorlds: number;
  /** open reports against worlds, whatever their state */
  openWorldReports: number;
  /** the oldest wait in the queue, in hours (0 when the queue is empty) */
  oldestWaitHours: number;
  slaHours: number;
  reportsToPull: number;
}

export async function worldModerationOps(prisma: PrismaClient, now: Date): Promise<WorldModerationOps> {
  const overdueBefore = new Date(now.getTime() - WORLD_MODERATION.REVIEW_SLA_HOURS * HOUR_MS);
  const [inReview, overdueReviews, pulledWorlds, openWorldReports, oldest] = await Promise.all([
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
    openWorldReports,
    oldestWaitHours: oldest ? waitingHours(oldest, now) : 0,
    slaHours: WORLD_MODERATION.REVIEW_SLA_HOURS,
    reportsToPull: WORLD_MODERATION.REPORTS_TO_PULL,
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
  if (ops.overdueReviews > 0 || ops.pulledWorlds > 0) {
    logLine({
      level: "warn",
      msg: "world.review.backlog",
      inReview: ops.inReview,
      overdue: ops.overdueReviews,
      pulled: ops.pulledWorlds,
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

export interface QueueComplaint { reason: string; note: string; createdAt: string }

export interface QueueEntry {
  world: World;
  reporters: number;
  waitingHours: number;
  overdue: boolean;
  pulled: boolean;
  reports: QueueComplaint[];
}

export interface ReviewQueue {
  entries: QueueEntry[];
  /** overdue across the **whole** queue, not just this page — an ops number, not a page number */
  overdueCount: number;
  total: number;
  nextOffset: number | null;
}

interface QueueRow extends World { reporters: number }

/**
 * The queue, worst thing first.
 *
 * Order: pulled-and-reported before never-reviewed, more reporters before fewer, then oldest wait
 * first, then id so the page boundary is stable. A world that players took off the shelf is by
 * definition live content somebody is objecting to right now; a first submission is nobody's
 * emergency.
 */
export async function reviewQueue(
  prisma: PrismaClient,
  now: Date,
  opts: { limit?: number; offset?: number } = {},
): Promise<ReviewQueue> {
  const limit = Math.min(REVIEW_QUEUE_MAX_LIMIT, Math.max(1, Math.trunc(opts.limit ?? REVIEW_QUEUE_DEFAULT_LIMIT)));
  const offset = Math.max(0, Math.trunc(opts.offset ?? 0));

  const rows = await prisma.$queryRaw<QueueRow[]>`
    SELECT w.*, COALESCE(r."reporters", 0) AS "reporters"
      FROM "World" w
      LEFT JOIN (
        SELECT "targetId", count(DISTINCT "userId")::int AS "reporters"
          FROM "Report" WHERE "target" = 'world' AND "status" = 'open' GROUP BY "targetId"
      ) r ON r."targetId" = w."id"
     WHERE w."status" = 'review'
     ORDER BY (w."pulledAt" IS NOT NULL) DESC,
              COALESCE(r."reporters", 0) DESC,
              COALESCE(w."reviewRequestedAt", w."createdAt") ASC,
              w."id" ASC
     LIMIT ${limit + 1} OFFSET ${offset}`;

  const page = rows.slice(0, limit);
  const ids = page.map((w) => w.id);
  const complaints = ids.length === 0
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
    if (list.length < REPORTS_PER_WORLD) list.push({ reason: c.reason, note: c.note, createdAt: c.createdAt.toISOString() });
    byWorld.set(c.targetId, list);
  }

  const [total, ops] = await Promise.all([
    prisma.world.count({ where: { status: "review" } }),
    worldModerationOps(prisma, now),
  ]);

  return {
    entries: page.map((row) => ({
      world: row,
      reporters: Number(row.reporters),
      waitingHours: waitingHours(row, now),
      overdue: isOverdue(row, now),
      pulled: isPulled(row),
      reports: byWorld.get(row.id) ?? [],
    })),
    overdueCount: ops.overdueReviews,
    total,
    nextOffset: rows.length > limit ? offset + limit : null,
  };
}
