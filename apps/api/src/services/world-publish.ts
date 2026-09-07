/**
 * **One decision, two doors.**
 *
 * "Who can play it?" is asked twice: once on SCR-048 before the world exists, and again on SCR-049
 * as the share button. They are the same decision — and until QA-003 only the second one was
 * wired to anything. `POST /v1/worlds` wrote `visibility` onto the row and nothing downstream read
 * it, so a world created as "Everyone" finished `ready` + `public`: in no review queue, in no
 * Explore, and with the client's publish button withdrawn because the world already *claimed* to
 * be public. 120 gems for a world that was nowhere.
 *
 * The fix is not to teach the build job the publish rules a second time. It is to put the whole
 * transition here, once, and have both doors walk through it:
 *
 *  - `private` → `ready`, private. Playable immediately, listed nowhere, withdrawn from whatever
 *    queue it was in. The creator's own business, applied without asking anyone. **A submission
 *    withdrawn before anybody read it gets its shelf fee back** (`world-submit-fee.ts`).
 *  - `unlisted` → G8 over the **generated** bible and cast, then `published`. Live but
 *    undiscoverable: a link that reaches one friend is not a discovery surface. Free — nobody has
 *    to read a world that is not on a shelf.
 *  - `public`  → the shelf fee, the same gate, then either a person or, for a creator who has
 *    earned it, the sampling draw (`creator-trust.ts`). Public is still not a setting: it is a
 *    human, or a coin the creator cannot see and cannot call, under limits written down where the
 *    draw is made.
 *
 * `refuseVisibility` holds the rules about *when* a world may change hands at all (QA-001, QA-004),
 * so the guards cannot drift apart from the transition they guard either.
 *
 * **The order of the three costs is the whole economics story** (gtm.md §2): affordability is
 * checked before the gate so a creator who cannot pay costs no tokens; the gate runs before the
 * charge so nobody pays to be told no; and the charge, the row and the trust counter all move in
 * one transaction so there is no instant in which a world is on a queue nobody paid for.
 */
import type { Prisma, SafetyVerdict, World, WorldCharacter, WorldVisibility } from "@prisma/client";
import { localized, roleFor, type LocaleKey } from "./locale";
import { safetyGate } from "./safety";
import { resubmitCooldownHours } from "./world-moderation";
import { clearedAppeal } from "./world-appeal";
import { releasedClaim } from "./world-review-claim";
import { buildDigest, digestPatch } from "./review-digest";
import {
  countTrustedSubmission, samplingDecision, trustSnapshot, type FullReadReason,
} from "./creator-trust";
import { chargeForShelf, gemsOf, publicSubmitGems, refundShelfCharge } from "./world-submit-fee";
import { GemsRequiredError } from "./world-studio";
import { logLine } from "../middleware/request-log";
import type { Deps } from "../types";

/** How much of a generated world a reviewer — G8 or a human — is shown. */
export const REVIEW_EXCERPT_CHARS = 4000;

export function reviewText(
  world: World,
  characters: { handle: string; role: string; card: unknown }[],
  locale: LocaleKey,
): string {
  return [
    localized(world.title, locale),
    localized(world.scenario, locale),
    localized(world.bible, locale).slice(0, REVIEW_EXCERPT_CHARS),
    ...characters.map((ch) => `${ch.handle} (${roleFor(ch, locale)}): ${localized(ch.card, locale)}`),
  ].join("\n");
}

/** The wallet movement one publish caused: positive for the shelf fee, negative for a refund. */
export interface Charged { gems: number; remaining: number }

export type VisibilityOutcome =
  /**
   * applied. `needsReview` is true only for a `public` world a person still has to read — a
   * submission the sampling draw sent straight to the shelf is `ok` with `needsReview: false`.
   */
  | { ok: true; world: World; needsReview: boolean; charged: Charged; sampledAway: boolean }
  /** the world may not change hands right now; `message` is written for its creator */
  | { ok: false; kind: "refused"; message: string }
  /** the shelf costs gems this wallet does not have. Same shape as running out of energy. */
  | { ok: false; kind: "gems"; message: string; needed: number; have: number }
  /** G8 read the generated world and said no. The world survives, private. */
  | { ok: false; kind: "blocked"; world: World };

const NO_CHARGE: Charged = { gems: 0, remaining: 0 };

/**
 * May this world become `visibility` at all, right now?
 *
 * Both refusals exist because `status` alone is a lossy record of what has happened to a world —
 * two of this file's own writes overwrite it — so they read the timestamps instead:
 *
 *  - **a takedown is not the creator's to undo** (QA-001). A world reports pulled off the shelf is
 *    `review` + `pulledAt`, not `rejected`; without this it walked past the cooldown and `unlisted`
 *    put it back to `published` with its complaints unread. While a person still owes it a
 *    decision the only move available is `private` — away from everyone, complaints intact. It is
 *    also why a re-approval after a pull can never charge the creator twice: there is no path by
 *    which they can submit that world again at all.
 *  - **a rejection costs the creator the cooldown** (QA-004), however they get back to the button:
 *    `resubmitCooldownHours` reads `reviewedAt`, which a round trip through `private` cannot erase.
 *
 * Checked before the price and before the gate, so a refused resubmit costs no gems and no tokens.
 */
export function refuseVisibility(world: World, visibility: WorldVisibility, now: Date): string | null {
  if (world.status === "draft" || world.status === "generating") {
    return "That world hasn't finished building yet";
  }
  if (visibility === "private") return null;
  if (world.pulledAt !== null) {
    return "This world was taken down after reports. A person is reading it — you can make it private, but not share it again.";
  }
  const wait = resubmitCooldownHours(world, now);
  if (wait !== null) {
    return `That world was turned down. You can submit it again in ${wait} ${wait === 1 ? "hour" : "hours"}.`;
  }
  return null;
}

export interface VisibilityContext {
  locale: LocaleKey;
  /** whose GenerationLog row the gate call belongs to — null for a world with no creator left */
  actorId: string | null;
  /**
   * What a blocked world's creator is told, written into `failureReason` (surfaced as
   * `WorldSummaryFullZ.reason`). The publish route answers a blocked request with a 422 and needs
   * nothing here; the build job has no request to answer, so the row is the only surface left.
   */
  blockedReason?: string;
}

/**
 * Apply `visibility` to `world`, gate, price and all. The only writer of the published/review states.
 *
 * A block is not a loss: the world has been generated and paid for, so it lands `ready` + private —
 * playable by its creator, off every listing, carrying the verdict and (for the build job) a
 * sentence saying so. The creator can rewrite it, or hit Share again once they have. Neither a
 * block nor a 402 takes a gem: the fee buys a reviewer's twenty minutes, and neither of those two
 * outcomes spends any.
 */
export async function setWorldVisibility(
  deps: Deps,
  world: World,
  visibility: WorldVisibility,
  ctx: VisibilityContext,
): Promise<VisibilityOutcome> {
  const now = deps.clock.now();
  const refusal = refuseVisibility(world, visibility, now);
  if (refusal !== null) return { ok: false, kind: "refused", message: refusal };

  if (visibility === "private") return await goPrivate(deps, world);

  // The price, before the gate — a model call in live mode is not something an unaffordable
  // request should cost us. It buys nothing here: a 402 leaves the world exactly where a block
  // leaves it, private and playable, and the gate still runs for everyone who does pay.
  const fee = visibility === "public" ? publicSubmitGems() : 0;
  if (fee > 0 && world.createdBy !== null) {
    const have = await gemsOf(deps.prisma, world.createdBy);
    if (have < fee) return notEnoughGems(fee, have);
  }

  const characters: WorldCharacter[] = await deps.prisma.worldCharacter.findMany({
    where: { worldId: world.id },
    orderBy: { handle: "asc" },
  });
  // A shared world's audience includes minors, so it is judged at the strictest setting no matter
  // who is asking. The gate reads the *generated* bible and cast — the premise was screened before
  // any of this existed, and is not what a stranger will be reading.
  const gate = await safetyGate(deps, {
    locale: ctx.locale,
    isMinor: true,
    text: reviewText(world, characters, ctx.locale),
    surface: "post",
  }, ctx.actorId);

  if (gate.verdict === "block") {
    const updated = await deps.prisma.world.update({
      where: { id: world.id },
      data: {
        safety: "block",
        safetyNote: "blocked by the pre-publication safety gate",
        status: "ready",
        visibility: "private",
        ...(ctx.blockedReason === undefined ? {} : { failureReason: ctx.blockedReason }),
      },
    });
    return { ok: false, kind: "blocked", world: updated };
  }

  const shared = {
    safety: gate.verdict,
    safetyNote: gate.verdict === "soften" ? "flagged for a closer read" : "",
    pulledAt: null,
    // A genuine submission is a new review cycle, so the appeal budget starts again: whatever
    // rejection an earlier appeal argued with is not the decision this world now carries. It also
    // arrives unclaimed — nobody is holding a world that was not in the queue.
    ...clearedAppeal,
    ...releasedClaim,
    // A world that failed a build and was retried carries the old message; it is not true of the
    // world being shared now.
    failureReason: "",
  } satisfies Prisma.WorldUpdateInput;

  if (visibility === "unlisted") {
    // Live but undiscoverable, and free: nobody has to read a world that is not on a shelf.
    const updated = await deps.prisma.world.update({
      where: { id: world.id },
      data: { ...shared, visibility, status: "published", reviewRequestedAt: null },
    });
    return { ok: true, world: updated, needsReview: false, charged: NO_CHARGE, sampledAway: false };
  }

  return await goPublic(deps, world, characters, shared, gate.verdict, fee, ctx, now);
}

/* -------------------------------------------------------------------- private ---- */

/**
 * Withdrawing a world. Also the refund door: a submission taken back before any reviewer opened it
 * bought nothing, so the fee comes back in the same transaction that leaves the queue.
 */
async function goPrivate(deps: Deps, world: World): Promise<VisibilityOutcome> {
  const { updated, refunded } = await deps.prisma.$transaction(async (tx) => {
    const gems = await refundShelfCharge(tx, world);
    const row = await tx.world.update({
      where: { id: world.id },
      // Pulling a world back also withdraws it from the queue, or from Explore — including a world
      // reports took off the shelf: it is no longer waiting on anyone. Its reports stay open, so
      // the complaint history survives the creator making it private. Whoever had claimed it is
      // reading a world that left the queue, so the lease goes too.
      data: {
        visibility: "private", status: "ready", pulledAt: null, reviewRequestedAt: null,
        ...clearedAppeal, ...releasedClaim,
      },
    });
    return { updated: row, refunded: gems };
  });
  if (refunded > 0) {
    logLine({ level: "info", msg: "world.publish.refunded", worldId: world.id, gems: refunded });
  }
  const remaining = world.createdBy ? await gemsOf(deps.prisma, world.createdBy) : 0;
  // A refund is reported as the negative of what it gives back: `charged.gems` is the wallet
  // movement this call caused, and "0" would leave a client unable to say the gems came home.
  return { ok: true, world: updated, needsReview: false, charged: { gems: -refunded, remaining }, sampledAway: false };
}

/* --------------------------------------------------------------------- public ---- */

const notEnoughGems = (needed: number, have: number): VisibilityOutcome => ({
  ok: false,
  kind: "gems",
  needed,
  have,
  message: `Publishing to Explore costs ${needed} gems — a person reads every world on the shelf. Private and link-only are free.`,
});

/**
 * The submission itself: the draw, the digest, the charge and the row, in that order.
 *
 * The draw is made **after** the gate, because `soften` is one of the things that takes a world out
 * of the sample — the machine asking for a closer read is not something a coin may overrule.
 */
async function goPublic(
  deps: Deps,
  world: World,
  characters: WorldCharacter[],
  shared: Prisma.WorldUpdateInput,
  safetyVerdict: SafetyVerdict,
  fee: number,
  ctx: VisibilityContext,
  now: Date,
): Promise<VisibilityOutcome> {
  const creatorId = world.createdBy;
  const snapshot = creatorId ? await trustSnapshot(deps.prisma, creatorId) : null;

  // No creator (a purged account) is nobody's standing: it is read, like every first submission.
  const decision = snapshot && creatorId
    ? samplingDecision({ id: world.id, safety: safetyVerdict, rejectedReason: world.rejectedReason }, creatorId, snapshot.trust, snapshot.counters)
    : { read: true, reason: "untrusted" as FullReadReason, sampledAway: false };

  // Advice for the person who is going to read it. The model half — when `packages/llm` ships one
  // — is asked for only when there *is* such a person; a digest nobody reads is the cost this
  // whole feature exists to remove.
  const digest = await buildDigest(deps, world, characters, {
    // `sampled` says "this one is in the queue because it was drawn", which is a different card to
    // read than an ordinary first submission.
    sampled: decision.reason === "drawn",
    enrich: decision.read,
    actorId: ctx.actorId,
  });

  try {
    const updated = await deps.prisma.$transaction(async (tx) => {
      let charged = 0;
      if (fee > 0 && creatorId) {
        const wallet = await tx.wallet.findUnique({ where: { userId: creatorId }, select: { id: true } });
        if (wallet) {
          await chargeForShelf(tx, wallet.id, world.id, fee);
          charged = fee;
        }
      }
      const row = await tx.world.update({
        where: { id: world.id },
        data: {
          ...shared,
          ...digestPatch(digest, now),
          visibility: "public",
          status: decision.read ? "review" : "published",
          // The review clock starts when the world joins the queue, not when it was created — and a
          // fresh submission is never a takedown, whatever this world's history is.
          reviewRequestedAt: decision.read ? now : null,
          sampledAwayAt: decision.read ? null : now,
          // A standing charge is only refundable while a person still owes the world a read. A
          // sampled submission is already on the shelf, so its fee is spent the moment it lands.
          publishChargeGems: decision.read ? charged : 0,
          // Set whatever the fee is, including a deploy that has set it to zero: this timestamp is
          // the count of public submissions, and the metrics divide by it.
          publishSubmittedAt: now,
        },
      });
      // Counted for the drawn submission and the sampled one alike — that is what makes "the first
      // one after graduating is read" a one-off rather than a permanent exemption.
      if (creatorId && snapshot?.trust.trusted) await countTrustedSubmission(tx, creatorId);
      return row;
    });

    if (decision.sampledAway) {
      logLine({
        level: "info", msg: "world.publish.sampled_away", worldId: world.id, userId: creatorId ?? "",
        approvals: snapshot?.counters.trustApprovals ?? 0,
      });
    }
    const remaining = creatorId ? await gemsOf(deps.prisma, creatorId) : 0;
    return {
      ok: true,
      world: updated,
      needsReview: decision.read,
      charged: { gems: fee, remaining },
      sampledAway: decision.sampledAway,
    };
  } catch (err: unknown) {
    // The wallet emptied between the pre-check and the transaction. `spendGems` holds the guard in
    // its WHERE clause, so the world is untouched and the honest answer is the same 402.
    if (err instanceof GemsRequiredError) return notEnoughGems(err.needed, err.have);
    throw err;
  }
}
