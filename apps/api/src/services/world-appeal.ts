/**
 * Appealing a rejection (`WORLD_MODERATION.APPEALS_PER_REJECTION`).
 *
 * The runbook tells reviewers to **reject when they are unsure** (`docs/moderation.md` §4), which
 * is the right instruction and which deliberately produces some wrong rejections. Until now the
 * only answer to one was "wait out the cooldown and resubmit the same world, hoping for a different
 * reviewer" — a creator arguing with a decision by pretending they were not arguing with it.
 *
 * An appeal puts the world back in the queue carrying two things a fresh submission does not: the
 * creator's message, and **the reason it was rejected for**. The reviewer is then looking at a
 * decision being argued with rather than at a new world, which is the whole point — a second pair
 * of eyes on the same call is only useful if it can see the call.
 *
 * Once per rejection, and the budget is per *decision*, not per world:
 *
 *  - `appealsUsed` counts appeals against the rejection currently standing;
 *  - a second rejection after an appeal **ends it** — `appealsUsed` is untouched by the decision,
 *    so `canAppeal` stays false and the next step is the ordinary cooldown;
 *  - anything that starts a new review cycle (a genuine resubmit, an automatic pull, an approval)
 *    clears it with `clearedAppeal`, so a *new* rejection is appealable again.
 */
import type { PrismaClient, World } from "@prisma/client";
import { worldModerationConfig } from "./world-moderation-config";

/** The creator's case, as a queue card shows it. `WorldReviewQueueResZ.worlds[].appeal`. */
export interface AppealCase {
  message: string;
  createdAt: string;
  /** the rejection reason being argued with, copied at appeal time so editing cannot rewrite it */
  previousReason: string;
}

/** The appeal a world is in the queue *for*, or null when it is there as a plain submission. */
export const liveAppeal = (world: Pick<World, "appealedAt" | "appealMessage" | "appealReason">): AppealCase | null =>
  world.appealedAt === null
    ? null
    : { message: world.appealMessage, createdAt: world.appealedAt.toISOString(), previousReason: world.appealReason };

/** `WorldSummaryFullZ.appealed` — the standing decision has already been argued with, either way. */
export const hasAppealed = (world: Pick<World, "appealsUsed">): boolean => world.appealsUsed > 0;

/**
 * `WorldSummaryFullZ.canAppeal` — is "ask for another look" still on offer?
 *
 * The creator's own rejected world, with the budget unspent. Nobody else can appeal a world (the
 * admin queue serialises with an empty viewer, so a queue card never offers one), and a world that
 * is not rejected has no decision to argue with.
 */
export const canAppeal = (world: World, viewerId: string): boolean =>
  world.createdBy !== null &&
  world.createdBy === viewerId &&
  world.status === "rejected" &&
  world.appealsUsed < worldModerationConfig().appealsPerRejection;

/**
 * The patch that ends whatever appeal state a world carries. Applied wherever a **new** review
 * cycle begins — publish (the creator resubmitted), the automatic pull (players objected to a
 * live world), and approval (there is no longer a rejection to appeal). Without it, one spent
 * appeal would silently deny the creator an appeal against every future rejection.
 */
export const clearedAppeal = {
  appealsUsed: 0,
  appealedAt: null,
  appealMessage: "",
  appealReason: "",
} as const;

/**
 * Put a rejected world back in the queue as an appeal, spending the budget in the same statement.
 *
 * The guard is in the WHERE clause (`status = 'rejected'`, `appealsUsed < limit`), so two appeals
 * posted at once cannot both pass a read-then-write check: the loser updates nothing and gets
 * `null`, which the route answers with the same 409 as an appeal that was already spent.
 *
 * `visibility` goes back to `public` because that is what is being asked for again — the rejection
 * set it to `private`, and a world in `review` is not listed anywhere regardless. The cooldown is
 * deliberately not consulted: an appeal is not a resubmit, it is the answer to one bad decision,
 * and making it wait a day for a decision that should not have happened would be the same insult
 * more slowly.
 */
export async function appealRejection(
  prisma: PrismaClient,
  world: World,
  message: string,
  now: Date,
): Promise<World | null> {
  const spent = await prisma.world.updateMany({
    where: { id: world.id, status: "rejected", appealsUsed: { lt: worldModerationConfig().appealsPerRejection } },
    data: {
      status: "review",
      visibility: "public",
      appealsUsed: { increment: 1 },
      appealedAt: now,
      appealMessage: message,
      // Copied, not joined: the reviewer must see the reason as it was written when the creator
      // read it, and `rejectedReason` is overwritten by the next decision.
      appealReason: world.rejectedReason,
      // It joins the queue now, so the SLA is measured from now — an appeal waiting three days is
      // exactly the failure `overdueCount` exists to make visible.
      reviewRequestedAt: now,
      // An appeal is not a takedown, and it arrives unclaimed.
      pulledAt: null,
      claimedBy: null,
      claimedUntil: null,
    },
  });
  if (spent.count === 0) return null;
  return prisma.world.findUniqueOrThrow({ where: { id: world.id } });
}
