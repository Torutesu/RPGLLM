/**
 * **Exit 2 — trust** (gtm.md §2「信頼度の階段」). The only one of the three that bends the curve.
 *
 * Exit 1 makes each review paid for; it does not make reviews rarer. This does: after
 * `TRUST_APPROVALS` approvals with no rejection and no upheld report, a creator's public
 * submissions are **sampled** — one in `TRUST_SAMPLE_EVERY` is still read end to end, the rest go
 * live without a human. Review load then grows with the number of *new* creators rather than with
 * the number of worlds, which is the only shape of this cost that survives 200 submissions a day.
 *
 * A world going live unread is a real risk, so the limits on it are written here rather than
 * implied:
 *
 *  1. **The draw is unpredictable.** Not "every fifth submission" — a creator can count their own
 *     submissions, and a schedule they can count is a schedule they can aim at. It is an HMAC over
 *     the world and the creator under a server-side secret, evaluated **once** at submission and
 *     stored on the row, so it is stable for a given world, independent across worlds, and cannot
 *     be predicted or replayed from outside.
 *  2. **The first submission after trust is granted is always read** (`trustSubmissions === 0`).
 *     The moment trust is granted is the moment it is worth the most to somebody who spent three
 *     clean worlds earning it, and one guaranteed read removes "graduate, then push the bad one
 *     through" as a *deterministic* play. It costs exactly one review per creator per graduation.
 *  3. **Trust is suspended, not spent, while a world of theirs is pulled.** A creator with a live
 *     world off the shelf under objection is precisely who should not be publishing unread — but a
 *     brigade must not be able to *destroy* standing either. So a pull suspends (derived, not
 *     stored: "has any world in `review` with `pulledAt`"), a rejection resets, and an approval of
 *     the pulled world lifts the suspension with the counter intact. Immediate protection, no
 *     permanent loss to three strangers.
 *  4. **Some worlds are never sampled at all** — see `samplingDecision`.
 *
 * What is deliberately **not** here: a genre exemption. No genre is more dangerous than another
 * (`fantasy` is not safer than `office`), and exempting one would be theatre that a creator routes
 * around by picking a different dropdown. The exemptions that exist are all about *this world* or
 * *this creator's standing*, which are the things an attacker cannot pick from a menu.
 */
import { createHmac, randomBytes } from "node:crypto";
import type { PrismaClient, User, World } from "@prisma/client";
import { envStr } from "../env";
import { worldModerationConfig } from "./world-moderation-config";
import type { Tx } from "../types";

/** `CreatorTrustZ`. Sent to the creator themselves and to the review queue — never to a stranger. */
export interface CreatorTrust {
  approvals: number;
  trusted: boolean;
  /** approvals still needed; null once trusted. `0` with `trusted: false` is a suspension. */
  toTrusted: number | null;
}

export type TrustCounters = Pick<User, "trustApprovals" | "trustSubmissions">;

/**
 * The trust a creator actually has right now.
 *
 * `suspended` is the derived half (a world of theirs is pulled). It is passed in rather than read
 * here so a page of queue cards costs one query for the whole page instead of one per creator.
 */
export function trustOf(counters: TrustCounters, suspended: boolean): CreatorTrust {
  const need = worldModerationConfig().trustApprovals;
  const earned = counters.trustApprovals >= need;
  return {
    approvals: counters.trustApprovals,
    trusted: earned && !suspended,
    // Suspended at the bar reads as `0` more to earn and not trusted, which is the truth: there is
    // nothing left to do except wait for a person to look at the world that was pulled.
    toTrusted: earned ? (suspended ? 0 : null) : need - counters.trustApprovals,
  };
}

/** Creators with a world currently off the shelf under objection — trust is suspended for these. */
export async function suspendedCreators(
  prisma: PrismaClient,
  userIds: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Set();
  const rows = await prisma.world.findMany({
    where: { createdBy: { in: ids }, status: "review", pulledAt: { not: null } },
    select: { createdBy: true },
    distinct: ["createdBy"],
  });
  return new Set(rows.flatMap((r) => (r.createdBy ? [r.createdBy] : [])));
}

/** `CreatorTrust` for a batch of creators, in two queries however many there are. */
export async function trustFor(
  prisma: PrismaClient,
  userIds: readonly string[],
): Promise<Map<string, CreatorTrust>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const [users, suspended] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, trustApprovals: true, trustSubmissions: true },
    }),
    suspendedCreators(prisma, ids),
  ]);
  return new Map(users.map((u) => [u.id, trustOf(u, suspended.has(u.id))]));
}

/** One creator's trust, for the surfaces that ask about exactly one. */
export async function trustForOne(prisma: PrismaClient, userId: string): Promise<CreatorTrust | null> {
  return (await trustFor(prisma, [userId])).get(userId) ?? null;
}

/**
 * Trust **and** the raw counters, which is what the submission path needs: `trustSubmissions === 0`
 * is the "first one after graduating" rule and is not derivable from `CreatorTrust` alone.
 */
export async function trustSnapshot(
  prisma: PrismaClient,
  userId: string,
): Promise<{ trust: CreatorTrust; counters: TrustCounters } | null> {
  const [user, suspended] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { trustApprovals: true, trustSubmissions: true } }),
    suspendedCreators(prisma, [userId]),
  ]);
  if (!user) return null;
  return { trust: trustOf(user, suspended.has(userId)), counters: user };
}

/* --------------------------------------------------------------- the draw ---- */

/**
 * The secret the draw is keyed on.
 *
 * Set `WORLD_TRUST_SAMPLE_SECRET` in a deploy that wants the draw reproducible across restarts (an
 * incident review, say). Unset, it is a fresh random value per process — which is **enough**,
 * because the draw is evaluated once at submission and the answer is stored on the row: a restart
 * changes what future worlds would draw, never what an existing one did.
 */
const processSecret = randomBytes(32).toString("hex");
export const SAMPLE_SECRET_ENV = "WORLD_TRUST_SAMPLE_SECRET";
const sampleSecret = (): string => envStr(SAMPLE_SECRET_ENV, processSecret);

/**
 * Was this world drawn for a full read? Deterministic for a given (creator, world, secret),
 * uniform over `every`, and not computable by the creator.
 *
 * `every <= 1` draws everything, which is what makes it a usable kill switch: set
 * `WORLD_TRUST_SAMPLE_EVERY=1` and every submission is read again, with no deploy.
 */
export function drawnForFullRead(userId: string, worldId: string, every: number): boolean {
  if (every <= 1) return true;
  const digest = createHmac("sha256", sampleSecret()).update(`${userId}:${worldId}`).digest();
  return digest.readUInt32BE(0) % every === 0;
}

/* ------------------------------------------------------- who is never sampled ---- */

/** Why this world is going to a person regardless of its creator's standing. */
export type FullReadReason = "untrusted" | "first_after_trust" | "softened" | "was_rejected" | "drawn";

export interface SamplingDecision {
  /** true when a person must read it: it queues */
  read: boolean;
  reason: FullReadReason | null;
  /** true when it goes live with nobody reading it */
  sampledAway: boolean;
}

/**
 * Two classes of world are **never** sampled, whatever the creator's standing:
 *
 *  - **the gate asked for a closer read** (`safety === "soften"`). Our own machine said "a human
 *    should look at this"; sampling past that is ignoring the only automated opinion we have.
 *  - **a world a human already said no to** (`rejectedReason` still standing — a resubmit after a
 *    rejection). A second look at a decision is the reviewer's, not a coin's.
 *
 * Plus the standing rules: an untrusted creator is read, and a trusted creator's first submission
 * after graduating is read.
 */
export function samplingDecision(
  world: Pick<World, "id" | "safety" | "rejectedReason">,
  creatorId: string,
  trust: CreatorTrust,
  counters: TrustCounters,
): SamplingDecision {
  const read = (reason: FullReadReason): SamplingDecision => ({ read: true, reason, sampledAway: false });
  if (!trust.trusted) return read("untrusted");
  if (counters.trustSubmissions === 0) return read("first_after_trust");
  if (world.safety === "soften") return read("softened");
  if (world.rejectedReason !== "") return read("was_rejected");
  if (drawnForFullRead(creatorId, world.id, worldModerationConfig().trustSampleEvery)) return read("drawn");
  return { read: false, reason: null, sampledAway: true };
}

/* ------------------------------------------------------- moving the counters ---- */

/**
 * A public submission by a trusted creator. Counting it is what makes "the first one after trust"
 * a one-off rather than a permanent exemption, so it moves for the sampled-away submission and the
 * drawn one alike.
 */
export const countTrustedSubmission = (tx: Tx, userId: string): Promise<unknown> =>
  tx.user.update({ where: { id: userId }, data: { trustSubmissions: { increment: 1 } } });

/**
 * A human approved a submission. `+1` — except for a world that was **pulled**: that approval
 * restores a world rather than earning anything, and counting it would let a creator farm standing
 * by having one world brigaded repeatedly. It does not reset anything either; the suspension lifts
 * on its own when `pulledAt` is cleared by the decision.
 */
export const creditApproval = (tx: Tx, userId: string, wasPulled: boolean): Promise<unknown> | null =>
  wasPulled ? null : tx.user.update({ where: { id: userId }, data: { trustApprovals: { increment: 1 } } });

/**
 * A rejection — including a rejection that upholds reports on a pulled world — drops the creator
 * back to being read every time (`TRUST_RESET_ON_REJECT`). `trustSubmissions` goes with it, so the
 * first submission after they earn it back is read in full again.
 */
export const resetTrust = (tx: Tx, userId: string, now: Date): Promise<unknown> | null =>
  worldModerationConfig().trustResetOnReject
    ? tx.user.update({ where: { id: userId }, data: { trustApprovals: 0, trustSubmissions: 0, trustResetAt: now } })
    : null;

/**
 * A world of theirs was pulled off the shelf. The suspension itself is derived, so the only thing
 * to write is the guarantee that **the first submission after the suspension lifts is read in
 * full** — the same protection graduation gets, for the same reason.
 */
export const pauseTrust = (tx: Tx, userId: string): Promise<unknown> =>
  tx.user.update({ where: { id: userId }, data: { trustSubmissions: 0 } });
