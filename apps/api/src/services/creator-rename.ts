/**
 * Changing the name your worlds are credited to (gtm.md 勝ち筋 A ②).
 *
 * `services/creator-handle.ts` mints a readable placeholder at signup and lets the first persona
 * replace it once. That is enough to guarantee every world has an author and not enough to be an
 * identity: most creators reach the studio before any persona exists, so most creators are
 * `quietheron42` — a name they never chose and, until now, could never leave. A creator page you
 * can link to is worth nothing if the name on it is a random one.
 *
 * Three decisions, all of them about the fact that **a handle is a link, not a label**:
 *
 * **1. Nothing is denormalised, so a rename is complete the instant it commits.** The credit on a
 * world is `User.creatorHandle`, resolved at read time (`creatorHandles()`), and worlds are
 * addressed by slug and id — never by their author's name. So a rename cannot leave a world
 * crediting the old name, and cannot break a world's own link. Only `/creators/:handle` moves.
 *
 * **2. The way out of a placeholder is free; every rename after it is rationed.** A creator who has
 * never chosen a name has nothing to lose by choosing one, so the graduation (`creatorHandleClaimedAt
 * === null`) costs no cooldown. Afterwards it is `RENAME_COOLDOWN_DAYS`, because the name is what
 * a follow, a link and a credit point at, and a name that can move every day is not something
 * anyone can be pointed at. A mistyped rename is a real cost of that; a month is the price of the
 * name meaning something.
 *
 * **3. A released name is NOT immediately free.** This is the whole reason `CreatorHandleRelease`
 * exists. Links to `/creator/@rina` are out in the world — in a share card, a screenshot, someone's
 * bio — and if `@rina` becomes claimable the moment its owner leaves it, the cheapest possible
 * impersonation is to watch for renames and step into the vacancy: every one of those links now
 * points at a stranger's worlds. So a released handle is reserved for `RECLAIM_DAYS`, during which
 * only its previous owner may take it back. After that it is ordinary and anyone may have it —
 * indefinite reservation would be a squatting mechanism of its own.
 */
import { Prisma, type PrismaClient, type User } from "@prisma/client";
import { envNum } from "../env";
import { normHandle } from "./handles";
import { collidesWithCast, isUsableCreatorHandle, reservedByAnother } from "./creator-handle";

/** How long between renames, once the account has left its placeholder behind. */
export const renameCooldownDays = (): number => envNum("CREATOR_RENAME_COOLDOWN_DAYS", 30);

const DAY_MS = 24 * 60 * 60 * 1000;

export type RenameOutcome =
  | { ok: true; handle: string; changed: boolean }
  | { ok: false; reason: "invalid" | "cast" | "taken" | "reserved" }
  | { ok: false; reason: "too_soon"; availableAt: Date };

/** When this account may next rename, or null if it may right now. */
export function renameAvailableAt(user: Pick<User, "creatorHandleClaimedAt" | "creatorHandleRenamedAt">): Date | null {
  // Still on the minted placeholder: the way out is always open.
  if (user.creatorHandleClaimedAt === null) return null;
  const last = user.creatorHandleRenamedAt ?? user.creatorHandleClaimedAt;
  const next = new Date(last.getTime() + renameCooldownDays() * DAY_MS);
  return next;
}

const isTakenHandle = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError
  && err.code === "P2002"
  && String((err.meta as { target?: unknown } | undefined)?.target ?? "").includes("creatorHandle");

/**
 * Take a new creator handle. Case-insensitive throughout: handles are stored normalised, so the
 * `@unique` index on `User.creatorHandle` *is* the case-insensitive uniqueness rule.
 *
 * Asking for the name you already have is a no-op that succeeds and spends no cooldown — a client
 * that resubmits a form must not cost the player a month.
 */
export async function renameCreatorHandle(
  prisma: PrismaClient,
  user: User,
  rawHandle: string,
  now: Date,
): Promise<RenameOutcome> {
  const handle = normHandle(rawHandle);
  if (!isUsableCreatorHandle(handle)) return { ok: false, reason: "invalid" };
  if (handle === user.creatorHandle) return { ok: true, handle, changed: false };

  const availableAt = renameAvailableAt(user);
  if (availableAt !== null && availableAt.getTime() > now.getTime()) {
    return { ok: false, reason: "too_soon", availableAt };
  }

  // A creator handle must not be a cast handle — `@rina` crediting a world whose cast contains
  // `@rina` puts two of them on one card. Asked on every path that writes one.
  if (await collidesWithCast(prisma, handle)) return { ok: false, reason: "cast" };

  if (await reservedByAnother(prisma, handle, user.id, now)) return { ok: false, reason: "reserved" };
  const release = await prisma.creatorHandleRelease.findUnique({ where: { handle } });

  const previous = user.creatorHandle;
  try {
    await prisma.$transaction(async (tx) => {
      // Whoever is taking this name owns it now; the reservation that guarded it is spent.
      if (release) await tx.creatorHandleRelease.delete({ where: { handle } });
      // …and the name being left behind starts its own reservation.
      await tx.creatorHandleRelease.upsert({
        where: { handle: previous },
        create: { handle: previous, userId: user.id, releasedAt: now },
        update: { userId: user.id, releasedAt: now },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { creatorHandle: handle, creatorHandleClaimedAt: user.creatorHandleClaimedAt ?? now, creatorHandleRenamedAt: now },
      });
    });
  } catch (err: unknown) {
    // Someone else took it between the check and the write. The index is the arbiter, not the read.
    if (isTakenHandle(err)) return { ok: false, reason: "taken" };
    throw err;
  }
  return { ok: true, handle, changed: true };
}
