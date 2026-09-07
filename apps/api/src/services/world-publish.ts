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
 *    queue it was in. The creator's own business, applied without asking anyone.
 *  - `unlisted` → G8 over the **generated** bible and cast, then `published`. Live but
 *    undiscoverable: a link that reaches one friend is not a discovery surface.
 *  - `public`  → the same gate, then `review`. Public is not a setting; a human decides. There is
 *    no path through this file that puts a world in Explore.
 *
 * `refuseVisibility` holds the rules about *when* a world may change hands at all (QA-001, QA-004),
 * so the guards cannot drift apart from the transition they guard either.
 */
import type { World, WorldCharacter, WorldVisibility } from "@prisma/client";
import { localized, type LocaleKey } from "./locale";
import { safetyGate } from "./safety";
import { resubmitCooldownHours } from "./world-moderation";
import { clearedAppeal } from "./world-appeal";
import { releasedClaim } from "./world-review-claim";
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
    ...characters.map((ch) => `${ch.handle} (${ch.role}): ${localized(ch.card, locale)}`),
  ].join("\n");
}

export type VisibilityOutcome =
  /** applied. `needsReview` is true only for `public`, which is now waiting on a person. */
  | { ok: true; world: World; needsReview: boolean }
  /** the world may not change hands right now; `message` is written for its creator */
  | { ok: false; kind: "refused"; message: string }
  /** G8 read the generated world and said no. The world survives, private. */
  | { ok: false; kind: "blocked"; world: World };

/**
 * May this world become `visibility` at all, right now?
 *
 * Both refusals exist because `status` alone is a lossy record of what has happened to a world —
 * two of this file's own writes overwrite it — so they read the timestamps instead:
 *
 *  - **a takedown is not the creator's to undo** (QA-001). A world reports pulled off the shelf is
 *    `review` + `pulledAt`, not `rejected`; without this it walked past the cooldown and `unlisted`
 *    put it back to `published` with its complaints unread. While a person still owes it a
 *    decision the only move available is `private` — away from everyone, complaints intact.
 *  - **a rejection costs the creator the cooldown** (QA-004), however they get back to the button:
 *    `resubmitCooldownHours` reads `reviewedAt`, which a round trip through `private` cannot erase.
 *
 * Checked before the gate, so a refused resubmit costs no tokens.
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
 * Apply `visibility` to `world`, gate and all. The only writer of the published/review states.
 *
 * A block is not a loss: the world has been generated and paid for, so it lands `ready` + private —
 * playable by its creator, off every listing, carrying the verdict and (for the build job) a
 * sentence saying so. The creator can rewrite it, or hit Share again once they have.
 */
export async function setWorldVisibility(
  deps: Deps,
  world: World,
  visibility: WorldVisibility,
  ctx: VisibilityContext,
): Promise<VisibilityOutcome> {
  const refusal = refuseVisibility(world, visibility, deps.clock.now());
  if (refusal !== null) return { ok: false, kind: "refused", message: refusal };

  if (visibility === "private") {
    const updated = await deps.prisma.world.update({
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
    return { ok: true, world: updated, needsReview: false };
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

  const unlisted = visibility === "unlisted";
  const updated = await deps.prisma.world.update({
    where: { id: world.id },
    data: {
      visibility,
      // `unlisted` is live but undiscoverable; `public` waits for a person.
      status: unlisted ? "published" : "review",
      safety: gate.verdict,
      safetyNote: gate.verdict === "soften" ? "flagged for a closer read" : "",
      // The review clock starts when the world joins the queue, not when it was created — and a
      // fresh submission is never a takedown, whatever this world's history is.
      reviewRequestedAt: unlisted ? null : deps.clock.now(),
      pulledAt: null,
      // A genuine submission is a new review cycle, so the appeal budget starts again: whatever
      // rejection an earlier appeal argued with is not the decision this world now carries. It also
      // arrives unclaimed — nobody is holding a world that was not in the queue.
      ...clearedAppeal,
      ...releasedClaim,
      // A world that failed a build and was retried carries the old message; it is not true of the
      // world being shared now.
      failureReason: "",
    },
  });
  return { ok: true, world: updated, needsReview: !unlisted };
}
