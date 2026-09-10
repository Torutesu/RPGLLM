/**
 * Taking a world out of the queue to review it (`WORLD_MODERATION.CLAIM_MINUTES`).
 *
 * Reading a world properly is twenty minutes of a person's day — the bible, the cast in both
 * locales, the complaints. Two reviewers spending the same twenty minutes is the waste; a world
 * stuck behind someone who closed their laptop is worse, because nobody is coming to release it.
 *
 * So this is a **lease, not a lock**:
 *
 *  - it expires by itself. `claimedUntil` in the past *is* an unclaimed world — no sweep, no
 *    unlock endpoint, no state that needs a job to run for the queue to keep working;
 *  - the same reviewer re-claiming extends it, so a long read does not lose the world halfway;
 *  - a claimed world is still **in** the queue, ranked last rather than hidden. Hiding it would
 *    mean a queue whose length depends on who is looking, and would make a stale claim invisible
 *    exactly when someone needs to override it;
 *  - deciding releases it — the world leaves `review`, and the lease has nothing left to protect.
 *
 * Simultaneous claims are settled by the database, not by a read: the claim is a conditional
 * `updateMany`, so under READ COMMITTED the second writer re-evaluates its WHERE after the first
 * commits, sees a live claim by someone else and updates nothing. Exactly one winner, and the
 * loser is told who has it and for how long rather than being handed a claim that is not theirs.
 */
import type { PrismaClient, World } from "@prisma/client";
import { worldModerationConfig } from "./world-moderation-config";

const MINUTE_MS = 60 * 1000;

export interface ReviewClaim {
  by: string;
  until: Date;
}

/** The live lease on a world, or null when nobody holds one — never claimed, or it lapsed. */
export const activeClaim = (world: Pick<World, "claimedBy" | "claimedUntil">, now: Date): ReviewClaim | null =>
  world.claimedBy !== null &&
  world.claimedBy !== "" &&
  world.claimedUntil !== null &&
  world.claimedUntil.getTime() > now.getTime()
    ? { by: world.claimedBy, until: world.claimedUntil }
    : null;

/** The lease somebody *else* holds, which is the only kind that stops a reviewer doing anything. */
export function claimHeldByOther(
  world: Pick<World, "claimedBy" | "claimedUntil">,
  now: Date,
  reviewer: string,
): ReviewClaim | null {
  const claim = activeClaim(world, now);
  return claim !== null && claim.by !== reviewer ? claim : null;
}

/** The patch a decision applies: whoever held this world, the review is over. */
export const releasedClaim = { claimedBy: null, claimedUntil: null } as const;

export type ClaimOutcome =
  | { ok: true; until: Date }
  /** somebody else has it, and it has not run out yet */
  | { ok: false; conflict: ReviewClaim }
  /** nothing to claim: the world left the queue (or never entered it) while the tab was open */
  | { ok: false; conflict: null };

/**
 * Claim `worldId` for `reviewer` until now + `CLAIM_MINUTES`, or find out who beat you to it.
 *
 * The WHERE is the whole concurrency story: claimable means *in review* and either unclaimed,
 * lapsed, or already mine. Everything else writes nothing and reads back the reason.
 */
export async function claimWorldForReview(
  prisma: PrismaClient,
  worldId: string,
  reviewer: string,
  now: Date,
): Promise<ClaimOutcome> {
  const until = new Date(now.getTime() + worldModerationConfig().claimMinutes * MINUTE_MS);
  const taken = await prisma.world.updateMany({
    where: {
      id: worldId,
      status: "review",
      OR: [{ claimedUntil: null }, { claimedUntil: { lte: now } }, { claimedBy: reviewer }],
    },
    data: { claimedBy: reviewer, claimedUntil: until },
  });
  // Re-claiming your own world is the same statement and lands here too: the lease is pushed out
  // to a fresh `CLAIM_MINUTES` rather than counting down while the world is still being read.
  if (taken.count > 0) return { ok: true, until };

  const after = await prisma.world.findUnique({
    where: { id: worldId },
    select: { claimedBy: true, claimedUntil: true },
  });
  return { ok: false, conflict: after === null ? null : claimHeldByOther(after, now, reviewer) };
}
