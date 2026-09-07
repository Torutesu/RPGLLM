import { Hono } from "hono";
import { atHandle } from "../services/handles";
import { ReviewWorldReqZ } from "@rpgllm/shared";
import { testHooksEnabled } from "../env";
import { fail, notFound, ok, parseBody } from "../http";
import { localized, roleFor, type LocaleKey } from "../services/locale";
import { adminTokenMatches } from "../services/moderation";
import { castCounts, creatorHandles, toApiWorldFull } from "../services/world-studio";
import { REVIEW_QUEUE_DEFAULT_LIMIT, resolveWorldReports, reviewQueue } from "../services/world-moderation";
import { tellCreator } from "../services/creator-notify";
import { clearedAppeal } from "../services/world-appeal";
import { claimWorldForReview, releasedClaim } from "../services/world-review-claim";
import { REVIEW_EXCERPT_CHARS } from "../services/world-publish";
import { creditApproval, resetTrust } from "../services/creator-trust";
import { consumedCharge } from "../services/world-submit-fee";
import type { AppEnv } from "../types";

/** Who is reviewing, as their own client says it. Not authentication — see the note below. */
const REVIEWER_HEADER = "x-reviewer";
const REVIEWER_ID_MAX = 64;
const DEFAULT_REVIEWER = "admin";

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
 *
 * **Who is reviewing.** The gate is one shared token, so the API cannot tell two reviewers apart on
 * its own; the client says who it is in `x-reviewer` and that string is what a claim is held by and
 * what `reviewedBy` records. It is a name for coordination, not an authorisation: anyone past the
 * admin gate can send any name, and a claim is a lease that expires anyway. When the header is
 * absent everyone is `admin`, which is honest — a deployment that cannot name its reviewers gets a
 * queue that cannot tell them apart, rather than a false sense that it can.
 */
export function adminWorldRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /** Max 64 chars of whatever the reviewer's client calls them. Empty header → one shared name. */
  const reviewerId = (c: { req: { header(name: string): string | undefined } }): string =>
    (c.req.header(REVIEWER_HEADER) ?? "").trim().slice(0, REVIEWER_ID_MAX) || DEFAULT_REVIEWER;

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
   * live content somebody is objecting to *now*, and an appealed world is a creator who was told
   * "no" once and is waiting on a person to look again — both sort above a first submission; more
   * reporters above fewer; then the longest wait. A world another reviewer has claimed sorts
   * *last* rather than disappearing, so a stale claim is visible instead of silently shrinking
   * everyone else's queue.
   *
   * Each card carries the complaints themselves (newest first), because "why is this here" is not
   * answerable from the world alone; an appealed card also carries the creator's message and the
   * reason they are arguing with. `overdueCount` and `appealCount` are over the whole queue, not
   * this page — both are "how many people are waiting on us", which is not a page-sized question. Paged with `?limit=` and `?cursor=` (an offset — the order is a ranking,
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
      // Whose claims count as "somebody else's" — the only per-reviewer thing about the queue.
      reviewer: reviewerId(c),
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
            // Bare, like every other handle this API emits — the reviewer's client owns the "@".
            // In the locale the world is reviewed in — an English reviewer reading a JA world reads
            // the JA cast, which is the point of the queue being language-agnostic at all.
            .map((ch) => ({ handle: atHandle(ch.handle), displayName: ch.displayName, role: roleFor(ch, locale) })),
          safety: w.safety,
          safetyNote: w.safetyNote,
          reportCount: entry.reporters,
          waitingHours: entry.waitingHours,
          overdue: entry.overdue,
          reports: entry.reports,
          // A queue card for an appeal shows the decision being argued with, not just the world.
          appeal: entry.appeal,
          // A lapsed lease is reported as no lease at all — nobody is holding this world.
          claimedBy: entry.claim?.by ?? null,
          claimedUntil: entry.claim?.until.toISOString() ?? null,
          // gtm.md §2 exit 3 — what to look at first, computed once when the world was submitted
          // and read straight off the row here. **Advice, never a verdict**: null is an ordinary
          // card (a world submitted before digests existed, or one whose extraction found nothing
          // worth storing), and the reviewer works it exactly as they did last week.
          digest: entry.digest,
          // exit 2 — the creator's standing, so a reviewer knows whether this card is a first
          // submission or one drawn out of a trusted creator's stream. Admin-only: the same number
          // is never on another player's view of a creator.
          creatorTrust: entry.creatorTrust,
        };
      }),
      overdueCount: queue.overdueCount,
      appealCount: queue.appealCount,
      // Additive extras (`WorldReviewQueueResZ.parse()` strips them): what a reviewer needs to page.
      total: queue.total,
      nextCursor: queue.nextOffset === null ? null : String(queue.nextOffset),
    });
  });

  /**
   * **A lease on a world, not a lock** (`WORLD_MODERATION.CLAIM_MINUTES`).
   *
   * Reading a world properly is twenty minutes — bible, cast, both locales, the complaints — and
   * two reviewers spending the same twenty minutes is the waste this closes. What it must never do
   * is strand a world behind somebody who closed their laptop, so the claim expires on its own,
   * re-claiming extends it, deciding releases it, and a claimed world stays in the queue (ranked
   * last) where anyone can still see it.
   *
   * Two reviewers claiming at the same instant is settled by the database, not by a read: the
   * winner is whoever's conditional UPDATE lands first, and the loser is told who has it and for
   * how long. A 409, not a 200 with a flag — a client that only checks the status must not walk
   * away believing it holds a world it does not.
   */
  app.post("/:id/claim", async (c) => {
    const deps = c.get("deps");
    const now = deps.clock.now();
    const reviewer = reviewerId(c);
    const id = c.req.param("id");
    const world = await deps.prisma.world.findFirst({ where: { OR: [{ id }, { slug: id }] } });
    if (!world) return notFound("World");
    if (world.status !== "review") return fail("VALIDATION", "That world is not awaiting review", 409);

    const outcome = await claimWorldForReview(deps.prisma, world.id, reviewer, now);
    if (!outcome.ok) {
      if (outcome.conflict === null) return fail("VALIDATION", "That world is not awaiting review", 409);
      const minutes = Math.max(1, Math.ceil((outcome.conflict.until.getTime() - now.getTime()) / 60_000));
      return fail(
        "ALREADY_DONE",
        `${outcome.conflict.by} is reviewing that world — it frees up in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`,
        409,
      );
    }
    return ok({ worldId: world.id, claimedUntil: outcome.until.toISOString(), claimedByYou: true });
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
    const reviewer = reviewerId(c);
    const approved = body.value.decision === "approve";
    /**
     * **`reviewRequestedAt` survives the decision** (it used to be cleared by both branches).
     * Without it a decided world remembers *that* it was reviewed and never *how long it waited*,
     * and review latency — the number that says whether the SLA in `WORLD_MODERATION` is real —
     * is unmeasurable after the fact (`services/moderation-metrics.ts`). Keeping it is invisible to
     * every queue read: `waitingSince`, `isOverdue`, `worldModerationOps` and `reviewQueue` all
     * filter on `status = "review"` first, and re-entering the queue (publish, appeal, pull) always
     * rewrites the timestamp.
     */
    /**
     * **What the decision does to the creator's standing** (gtm.md §2 exit 2,
     * `services/creator-trust.ts`). An approval is `+1` — unless the world was *pulled*, in which
     * case the decision restores a world rather than earning anything, and counting it would let a
     * creator farm standing by having one world brigaded repeatedly. A rejection, including one
     * that upholds reports on a pulled world, resets them to being read every time.
     *
     * Either way the shelf fee stops being refundable (`consumedCharge`): the twenty minutes it
     * bought have now been spent, so withdrawing the world afterwards must not hand it back.
     */
    const wasPulled = world.pulledAt !== null;
    const updated = await deps.prisma.$transaction(async (tx) => {
      const row = await tx.world.update({
        where: { id: world.id },
        data: approved
          ? {
            // Back on the shelf, and no longer pulled: a person has now looked at it.
            status: "published", reviewedAt: now, reviewedBy: reviewer, rejectedReason: "",
            pulledAt: null,
            ...consumedCharge,
            // An approval answers the appeal it was carrying, and there is no longer a rejection
            // to argue with — so the next one, if this world is ever rejected again, starts fresh.
            ...clearedAppeal,
            ...releasedClaim,
          }
          : {
            status: "rejected",
            // It stops being listed, but its creator keeps it: `pickerWhere` still returns a
            // rejected world to the account that made it.
            visibility: "private",
            reviewedAt: now,
            reviewedBy: reviewer,
            rejectedReason: body.value.reason,
            pulledAt: null,
            ...consumedCharge,
            // **The appeal state is deliberately left standing.** A world rejected *again* after an
            // appeal has spent its appeal for that argument: `appealsUsed` stays at the limit, so
            // `canAppeal` is false and the creator's next step is the ordinary cooldown. A new
            // appeal only becomes available if a genuine resubmit is rejected again.
            ...releasedClaim,
          },
      });
      await resolveWorldReports(tx, world.id, now, approved);
      if (world.createdBy) {
        const move = approved ? creditApproval(tx, world.createdBy, wasPulled) : resetTrust(tx, world.createdBy, now);
        if (move) await move;
      }
      /**
       * **The decision reaches the creator.** It used to reach nobody: approve/reject wrote the row
       * and the creator found out by opening SCR-049 again. A world in review is a person waiting
       * on an answer, so the answer is delivered — to the account, in the same transaction as the
       * decision, whether or not they have ever made a persona (`services/creator-notify.ts`).
       */
      await tellCreator(tx, row, { kind: "reviewed", approved });
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
