/**
 * The guaranteed slot (gtm.md 勝ち筋 A ③ 初速) — worlds on the shelf **because they are new, and
 * for no other reason.**
 *
 * A shelf ranked by plays is winner-take-all by construction: the first world to be found is the
 * one that keeps being found, and a new author's first world never reaches its first ten players.
 * The decaying newcomer bonus in `GET /v1/worlds/public` softens that; it does not fix it, because
 * a bonus is still a rank and a rank is still a competition a new world can lose.
 *
 * Three rules, and each one is there to stop this list becoming the very thing it replaces:
 *
 *  1. **Recency only.** Ordered by `createdAt DESC`. No play count enters the query at any point,
 *     so nothing here can compound.
 *  2. **One world per creator.** Otherwise an author who can make eight worlds a day owns the whole
 *     strip and it becomes a second winner-take-all list with a different winner.
 *  3. **A hard window and a hard cap.** `WORLD_FRESH_WINDOW_HOURS` and `WORLD_FRESH_SLOTS`: a world
 *     leaves this list by getting old, never by losing to another world.
 *
 * **A world is never in both lists.** The ranked query excludes exactly this set, on every page —
 * which it can do because this set is a pure function of the database and the clock, not of the
 * page being asked for. A fresh world graduates into the ranking when it ages out of the window,
 * where the newcomer bonus still carries it for a fortnight.
 *
 * **The floor.** Below `WORLD_FRESH_MIN_SHELF` public worlds there is nothing to be buried under:
 * the whole shelf fits on one screen, every new world is already visible, and moving six of them
 * into a separate strip would be theatre. So the list is empty until the shelf is big enough for
 * the problem it solves to exist.
 */
import { Prisma, type PrismaClient, type World } from "@prisma/client";
import { envNum } from "../env";

/** How new is new. Two days: long enough to survive a quiet night, short enough to still mean it. */
export const freshWindowHours = (): number => envNum("WORLD_FRESH_WINDOW_HOURS", 48);
/** How many slots the strip has. Small on purpose — a guarantee that costs nothing is not one. */
export const freshSlots = (): number => envNum("WORLD_FRESH_SLOTS", 6);
/** Below this many public worlds the ranking cannot bury anything, so the strip stays empty. */
export const freshMinShelf = (): number => envNum("WORLD_FRESH_MIN_SHELF", 12);

const SHELF = Prisma.sql`"status" = 'published' AND "visibility" = 'public'`;

/**
 * The fresh slots, newest first. Deterministic: same database, same clock, same answer — which is
 * what lets `/v1/worlds/public` exclude these ids from every page of the ranking without carrying
 * anything in the cursor.
 */
export async function freshWorlds(prisma: PrismaClient, now: Date): Promise<World[]> {
  const [{ count }] = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*)::bigint AS count FROM "World" WHERE ${SHELF}`;
  if (Number(count) < freshMinShelf()) return [];

  const cutoff = new Date(now.getTime() - freshWindowHours() * 3_600_000);
  // `DISTINCT ON` is the one-per-creator rule. `createdBy` is never null on the public shelf (a
  // preset is not public), but coalescing to the id keeps the rule from collapsing every preset
  // into one row if that ever changes.
  return await prisma.$queryRaw<World[]>`
    WITH newest AS (
      SELECT DISTINCT ON (COALESCE("createdBy", "id")) *
        FROM "World"
       WHERE ${SHELF} AND "createdAt" >= ${cutoff}
       ORDER BY COALESCE("createdBy", "id"), "createdAt" DESC, "id" DESC
    )
    SELECT * FROM newest ORDER BY "createdAt" DESC, "id" DESC LIMIT ${freshSlots()}`;
}
