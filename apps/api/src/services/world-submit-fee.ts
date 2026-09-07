/**
 * **Exit 1 — charge for the shelf** (gtm.md §2).
 *
 * A world costs $0.32 to generate and **$5.00 to review**: twenty minutes of a person at $15/hour,
 * twenty minutes because that is the lease this service already takes on a world for exactly this
 * reason (`WORLD_MODERATION.CLAIM_MINUTES`). A gem pack that buys one world is $2.99. Selling
 * worlds cannot pay for reading them, and at 200 public submissions a day it is $30,000 a month.
 *
 * So the charge moves to where the cost is. **Anyone may build and play for free** — the gem cost
 * of a world is unchanged, private and unlisted are unchanged, nothing about the game costs more.
 * `PUBLIC_SUBMIT_GEMS` is charged to the one person who is asking for a stranger's twenty minutes:
 * whoever wants a place on the shelf.
 *
 * Four decisions this file makes, each of which could reasonably have gone the other way:
 *
 *  1. **Affordability is checked before the safety gate; the charge is taken after it.** Before,
 *     because the gate is a model call in live mode and a creator who cannot pay must not cost us
 *     tokens — the same reason `world-create.ts` screens the premise before charging anything.
 *     After, because **nobody pays to be told no**: a blocked world is refused with no charge, so
 *     the gate can never read as something you buy your way past. The order is an economy, not a
 *     safety property; a 402 leaves a world exactly where a block leaves it, private and playable.
 *  2. **A pulled world that is re-approved does not pay twice.** The creator did not ask for that
 *     review — players did, and we did. There is no path in `refuseVisibility` by which a creator
 *     can resubmit a pulled world at all, and the admin re-approval charges nothing.
 *  3. **An appeal is free; a resubmit is not.** A resubmit is a second twenty minutes the creator
 *     asked for, so it costs what the first one did. An appeal exists because *we* may have got it
 *     wrong (`docs/moderation.md` §4 tells reviewers to reject when unsure, on purpose), and
 *     charging someone for our own error is the wrong incentive on both sides of it. One per
 *     rejection is what bounds the hole.
 *  4. **A submission nobody read is refunded.** If the creator withdraws the world to `private`
 *     while it is still in the queue and **no reviewer has ever opened it**, the fee bought
 *     nothing and comes back. A claim — even a lapsed one — means somebody spent the time, and a
 *     decision means they spent all of it; neither refunds. That is also what stops
 *     submit-withdraw-submit being a free way to churn the queue.
 *
 * Every charge and every refund is a `LedgerEntry`, so `GET /v1/admin/moderation/metrics` can say
 * what the shelf actually collected without a second bookkeeping system.
 */
import type { PrismaClient, World } from "@prisma/client";
import { worldModerationConfig } from "./world-moderation-config";
import { spendGems } from "./world-studio";
import type { Tx } from "../types";

/** What a place on the shelf costs right now (`WORLD_PUBLIC_SUBMIT_GEMS` over the shipped default). */
export const publicSubmitGems = (): number => worldModerationConfig().publicSubmitGems;

/** Ledger prefixes. The metrics surface reads these; nothing else may write them. */
export const SUBMIT_REF = "world_publish";
export const REFUND_REF = "world_publish_refund";

export type ChargeTarget = Pick<World, "id" | "publishChargeGems" | "claimedBy" | "status">;

/**
 * Is there a charge standing on this world that nobody has been paid for yet?
 *
 * Three conditions, all of them "no human time was spent": money was taken, the world is still in
 * the queue, and no reviewer has ever claimed it. `claimedBy` survives its lease expiring and is
 * only cleared by a decision, so "was ever opened" is exactly the right reading of it.
 */
export const refundable = (world: ChargeTarget): boolean =>
  world.publishChargeGems > 0 && world.status === "review" && world.claimedBy === null;

/**
 * The patch that ends a standing charge without paying it back: the reviewer read the world, which
 * is what was bought. Applied by **both** decisions, so a creator cannot withdraw a decided world
 * and be refunded for a read that happened.
 *
 * `publishSubmittedAt` is deliberately **left standing** — for the same reason the review decision
 * stopped clearing `reviewRequestedAt`. It is not part of the charge; it is the record that this
 * world was submitted at all, and it is the denominator every number in the `sampling` block of
 * `GET /v1/admin/moderation/metrics` divides by. Clearing it on the decision would make the load
 * this pass removes unmeasurable the moment anybody worked the queue.
 */
export const consumedCharge = { publishChargeGems: 0 } as const;

/**
 * Take the fee inside the caller's transaction — the same transaction that puts the world in the
 * queue, so there is no instant in which a world is queued unpaid or paid and not queued.
 *
 * Throws `GemsRequiredError` (from `spendGems`, whose guard is in the WHERE clause) if the wallet
 * emptied between the pre-check and here; the caller turns that into the same 402 as the pre-check.
 */
export async function chargeForShelf(tx: Tx, walletId: string, worldId: string, fee: number): Promise<number | null> {
  if (fee <= 0) return null;
  return await spendGems(tx, walletId, fee, `${SUBMIT_REF}:${worldId}`);
}

/**
 * Give back a fee for a review that never happened — **at most once**, whatever races.
 *
 * The conditional `updateMany` claims `publishChargeGems` the way `refundWorldOnce` claims
 * `refundedAt`: whoever sets it to 0 writes the wallet, everybody else gets `count === 0` and does
 * nothing. Returns the gems returned (0 when there was nothing to return).
 */
export async function refundShelfCharge(tx: Tx, world: ChargeTarget): Promise<number> {
  if (!refundable(world)) return 0;
  const gems = world.publishChargeGems;
  const claimed = await tx.world.updateMany({
    where: { id: world.id, publishChargeGems: gems, claimedBy: null },
    data: consumedCharge,
  });
  if (claimed.count === 0) return 0;
  const row = await tx.world.findUnique({ where: { id: world.id }, select: { createdBy: true } });
  if (!row?.createdBy) return 0;
  const wallet = await tx.wallet.findUnique({ where: { userId: row.createdBy }, select: { id: true } });
  if (!wallet) return 0;
  await tx.wallet.update({ where: { id: wallet.id }, data: { gems: { increment: gems } } });
  await tx.ledgerEntry.create({
    data: { walletId: wallet.id, currency: "gems", delta: gems, source: "admin", ref: `${REFUND_REF}:${world.id}` },
  });
  return gems;
}

/** Gems in the wallet right now, for the pre-check and for what a response reports as `remaining`. */
export async function gemsOf(prisma: PrismaClient, userId: string): Promise<number> {
  const wallet = await prisma.wallet.findUnique({ where: { userId }, select: { gems: true } });
  return wallet?.gems ?? 0;
}
