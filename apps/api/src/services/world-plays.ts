/**
 * "Your world was played" — the threshold, and why it is a ladder (gtm.md 勝ち筋 A ①).
 *
 * A play is a persona created in somebody else's world, so "notify on every play" is literally one
 * notification per persona creation: a world that works buzzes its author to death, and the signal
 * that actually matters — *somebody who is not me opened my world* — is buried in the noise on the
 * day it arrives.
 *
 * The two alternatives, and why this one:
 *
 *  - **a daily roll-up** ("your worlds were played 12 times today") needs a job, and delays the
 *    only notification that ever changes behaviour — the *first* play — by up to 24 hours. A
 *    creator who is going to write a second world decides that in the hour after the first one is
 *    read, not tomorrow morning.
 *  - **every Nth play** is a fixed rate: fine at 10 plays, spam at 10,000.
 *
 * So: **the first play, then a milestone ladder.** O(log n) notifications for the whole life of a
 * world, the first one arrives the moment it is earned, and the ladder is the idiom the product
 * already uses for followers (`FOLLOWER_MILESTONES`).
 *
 * The creator's own plays never count — being told you played your own world is not a signal — and
 * `World.playsNotified` is a watermark claimed with a conditional UPDATE, so re-running this, or
 * two players arriving at once, can never ring the same milestone twice.
 */
import { compactNumber } from "@rpgllm/shared";
import { tellCreator } from "./creator-notify";
import type { Tx } from "../types";

/** 1 is "the first person who is not you". After that it is a ladder, not a rate. */
export const PLAY_MILESTONES = [1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 50_000, 100_000] as const;

/** The highest milestone this play count has reached, or null below the first one. */
export function milestoneAt(plays: number): number | null {
  let reached: number | null = null;
  for (const m of PLAY_MILESTONES) {
    if (plays >= m) reached = m;
  }
  return reached;
}

/**
 * Count one play and, if it crossed a threshold, tell the author — in the caller's transaction, so
 * the play and the notification commit together exactly like every other `notify()` in the app.
 *
 * `playerId` is who is playing: the creator playing their own world still counts as a play (the
 * shelf ranks on plays), it just never notifies.
 */
export async function countPlay(tx: Tx, worldId: string, playerId: string): Promise<number | null> {
  const world = await tx.world.update({ where: { id: worldId }, data: { playCount: { increment: 1 } } });
  if (!world.createdBy || world.createdBy === playerId) return null;

  const milestone = milestoneAt(world.playCount);
  if (milestone === null || milestone <= world.playsNotified) return null;

  // Claim the rung. The row is already locked by the increment above, so this only ever loses to a
  // notification that has already been written for the same milestone — which is the point.
  const claimed = await tx.world.updateMany({
    where: { id: worldId, playsNotified: { lt: milestone } },
    data: { playsNotified: milestone },
  });
  if (claimed.count === 0) return null;

  await tellCreator(tx, world, { kind: "played", plays: milestone });
  return milestone;
}

/** For logs and tests: the ladder rendered the way the notification says it. */
export const playsLabel = (plays: number): string => compactNumber(plays);
