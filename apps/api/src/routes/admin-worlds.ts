import { Hono } from "hono";
import { ReviewWorldReqZ } from "@rpgllm/shared";
import { testHooksEnabled } from "../env";
import { fail, notFound, ok, parseBody } from "../http";
import { localized, type LocaleKey } from "../services/locale";
import { adminTokenMatches } from "../services/moderation";
import { castCounts, creatorHandles, toApiWorldFull } from "../services/world-studio";
import { REVIEW_QUEUE_DEFAULT_LIMIT, resolveWorldReports, reviewQueue } from "../services/world-moderation";
import { REVIEW_EXCERPT_CHARS } from "./worlds";
import type { AppEnv } from "../types";

/**
 * Human review of worlds asking to go public, and of worlds the players took back off the shelf
 * (AIF-003, WORLD_MODERATION).
 *
 * **A human approves every public world.** `POST /v1/worlds/:id/publish` can only ever move a world
 * to `review`; this is the only surface that writes `published`, and it is not reachable by a
 * player. The gate is the one the report queue already uses (`GET /v1/moderation/reports`):
 * `TEST_HOOKS=1`, or an `ADMIN_TOKEN` match presented as a bearer token or `x-admin-token`.
 *
 * Rejecting does not delete anything. The world stops being listed and goes back to being what it
 * was before the creator asked to share it: theirs, private, and playable.
 */
export function adminWorldRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const presented = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : c.req.header("x-admin-token");
    if (!testHooksEnabled() && !adminTokenMatches(presented)) return fail("UNAUTHORIZED", "Admin only", 401);
    await next();
  });

  /**
   * The queue — worst thing first, with enough of the world in it that a human can actually judge.
   *
   * Ordering is the difference between a queue and a pile: a world players pulled off the shelf is
   * live content somebody is objecting to *now*, so it sorts above a first submission; more
   * reporters above fewer; then the longest wait. Each card carries the complaints themselves
   * (newest first), because "why is this here" is not answerable from the world alone, and how long
   * it has waited against `WORLD_MODERATION.REVIEW_SLA_HOURS`. `overdueCount` is over the whole
   * queue, not this page. Paged with `?limit=` and `?cursor=` (an offset — the order is a ranking,
   * not a keyset).
   */
  app.get("/review", async (c) => {
    const deps = c.get("deps");
    const now = deps.clock.now();
    const rawLimit = Number(c.req.query("limit") ?? REVIEW_QUEUE_DEFAULT_LIMIT);
    const rawCursor = Number(c.req.query("cursor") ?? 0);
    const queue = await reviewQueue(deps.prisma, now, {
      limit: Number.isFinite(rawLimit) ? rawLimit : REVIEW_QUEUE_DEFAULT_LIMIT,
      offset: Number.isFinite(rawCursor) ? rawCursor : 0,
    });

    const worlds = queue.entries.map((e) => e.world);
    const ids = worlds.map((w) => w.id);
    const [counts, handles, cast] = await Promise.all([
      castCounts(deps.prisma, ids),
      creatorHandles(deps.prisma, worlds.flatMap((w) => (w.createdBy ? [w.createdBy] : []))),
      ids.length > 0
        ? deps.prisma.worldCharacter.findMany({ where: { worldId: { in: ids } }, orderBy: { handle: "asc" } })
        : Promise.resolve([]),
    ]);

    return ok({
      worlds: queue.entries.map((entry) => {
        const w = entry.world;
        // Reviewed in the locale it was written in — that is the text a player will actually read.
        const locale = (w.genLocale ?? "en") as LocaleKey;
        return {
          // No admin user id exists here, so nothing is ever "mine" in the queue.
          ...toApiWorldFull(w, locale, "", {
            castCount: counts.get(w.id) ?? 0,
            creatorHandle: w.createdBy ? (handles.get(w.createdBy) ?? null) : null,
          }),
          bibleExcerpt: localized(w.bible, locale).slice(0, REVIEW_EXCERPT_CHARS),
          cast: cast
            .filter((ch) => ch.worldId === w.id)
            .map((ch) => ({ handle: ch.handle, displayName: ch.displayName, role: ch.role })),
          safety: w.safety,
          safetyNote: w.safetyNote,
          reportCount: entry.reporters,
          waitingHours: entry.waitingHours,
          overdue: entry.overdue,
          reports: entry.reports,
        };
      }),
      overdueCount: queue.overdueCount,
      // Additive extras (`WorldReviewQueueResZ.parse()` strips them): what a reviewer needs to page.
      total: queue.total,
      nextCursor: queue.nextOffset === null ? null : String(queue.nextOffset),
    });
  });

  /**
   * The decision. Both outcomes close the world's open reports in the same transaction that moves
   * it — otherwise the complaints stay open, the queue never empties and the next single report
   * re-pulls a world a person just cleared. `approve` dismisses them (read and disagreed with),
   * `reject` actions them (upheld); either way the distinct-reporter count starts again at zero.
   */
  app.post("/:id/review", async (c) => {
    const body = await parseBody(c.req, ReviewWorldReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const id = c.req.param("id");
    const world = await deps.prisma.world.findFirst({ where: { OR: [{ id }, { slug: id }] } });
    if (!world) return notFound("World");
    if (world.status !== "review") return fail("VALIDATION", "That world is not awaiting review", 409);

    const now = deps.clock.now();
    const approved = body.value.decision === "approve";
    const updated = await deps.prisma.$transaction(async (tx) => {
      const row = await tx.world.update({
        where: { id: world.id },
        data: approved
          ? {
            // Back on the shelf, and no longer pulled: a person has now looked at it.
            status: "published", reviewedAt: now, reviewedBy: "admin", rejectedReason: "",
            pulledAt: null, reviewRequestedAt: null,
          }
          : {
            status: "rejected",
            // It stops being listed, but its creator keeps it: `pickerWhere` still returns a
            // rejected world to the account that made it.
            visibility: "private",
            reviewedAt: now,
            reviewedBy: "admin",
            rejectedReason: body.value.reason,
            pulledAt: null,
            reviewRequestedAt: null,
          },
      });
      await resolveWorldReports(tx, world.id, now, approved);
      return row;
    });

    const locale = (updated.genLocale ?? "en") as LocaleKey;
    return ok({
      world: toApiWorldFull(updated, locale, "", { castCount: 0, creatorHandle: null }),
      needsReview: false,
    });
  });

  return app;
}
