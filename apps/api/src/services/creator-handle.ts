/**
 * The name a world is credited to — **on the account, not on a persona.**
 *
 * A world is somebody's work (gtm.md, 勝ち筋 A ②: クレジットは表示ではなくリンク). It was credited
 * to `creatorHandles()` = the creator's most recent persona handle, and a persona is per
 * (user, world). Two things followed, and both make authorship meaningless:
 *
 *  1. **the credit moved.** Playing a second world under a second name silently relabelled the
 *     first world. An author whose name changes is not an author, and nothing — a link, a page,
 *     a follow — can be built on a name that moves.
 *  2. **the credit could be absent.** The studio is reachable from the world picker, which a new
 *     player sees *before* any persona exists, so a first-time creator's first world was credited
 *     to nobody (e2e world-lifecycle QA-002).
 *
 * So the handle lives on `User`, is `NOT NULL @unique`, and is written by exactly two events:
 *
 *  - **signup** mints a readable placeholder (`quietheron42`), so the invariant "every account has
 *    a name" is the database's, not a convention some future call site can forget.
 *  - **the first persona** may replace it, once. That is the only moment the player has typed a
 *    name they like while nothing has yet been published under the placeholder. Afterwards
 *    `creatorHandleClaimedAt` is stamped and the name is frozen for good — renaming is a later,
 *    deliberate feature that will have to deal with redirects.
 *
 * Rejected alternatives, briefly: crediting a persona of the creator's *in that world* (they need
 * not play their own world at all); the *oldest* persona instead of the newest (still absent, still
 * not unique, still dies with the persona); denormalising the name onto `World` at publish time
 * (stable, but there is then no identity to hang ② off — two worlds by one person could carry two
 * names); and a "pick your handle" step at signup (a blocking screen before anyone has a reason
 * to care).
 */
import { Prisma, type PrismaClient, type User } from "@prisma/client";
import { hashString } from "./rng";
import { normHandle } from "./handles";

/** The persona-handle shape (`CreatePersonaReqZ`), so both namespaces read alike. */
export const CREATOR_HANDLE_RE = /^[a-z0-9_]{3,15}$/;

/** Names the product needs for itself, or that would read as the product speaking. */
const RESERVED = new Set([
  "admin", "administrator", "support", "staff", "team", "help", "root", "system",
  "official", "moderator", "mod", "status", "rpgllm", "me", "you", "null", "undefined",
]);

/* ------------------------------------------------------------- the placeholder ---- */

/**
 * A readable stand-in. `user_7x3k9q` is technically correct and product-hostile — this string is
 * the aspirational half of "made by @someone", and most accounts that create a world before ever
 * making a persona will be shown under it. Deterministic in `seed` so a retry is not a new name.
 *
 * NOTE: `prisma/migrations/20260907140000_creator_handle/migration.sql` holds a frozen copy of
 * these two lists — a migration must keep working when this file changes, so it does not import.
 */
const ADJECTIVES = [
  "amber", "brave", "calm", "clever", "cosmic", "dusty", "eager", "early",
  "fair", "fleet", "gentle", "giddy", "glad", "golden", "happy", "keen",
  "lucky", "mellow", "merry", "mild", "noble", "plain", "quiet", "rapid",
  "sharp", "silver", "snowy", "soft", "solar", "sunny", "swift", "vivid",
] as const;
const NOUNS = [
  "anchor", "atlas", "beacon", "cedar", "cinder", "comet", "coral", "delta",
  "ember", "falcon", "fern", "forge", "harbor", "heron", "ivy", "kite",
  "lark", "lotus", "maple", "meadow", "otter", "pebble", "quill", "raven",
  "reef", "river", "sable", "stone", "thorn", "tide", "vale", "wren",
] as const;

/** `<adjective><noun><2 digits>` — always inside `CREATOR_HANDLE_RE`. */
export function placeholderHandle(seed: string): string {
  const adj = ADJECTIVES[hashString(`${seed}:a`) % ADJECTIVES.length] ?? "quiet";
  const noun = NOUNS[hashString(`${seed}:n`) % NOUNS.length] ?? "heron";
  const num = hashString(`${seed}:d`) % 100;
  return `${adj}${noun}${String(num).padStart(2, "0")}`;
}

/** Entropy for a placeholder. Never derived from the email: the credit is public, the address is not. */
const freshSeed = (): string => `${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;

/* ------------------------------------------------------------------ the rules ---- */

/**
 * A creator handle must not be a cast handle. `@rina` crediting a world whose cast contains
 * `@rina` puts two of them on one card, and the whole point of ② is that the credit is a pointer
 * to a person. `WorldCharacter` is a different table with a different namespace, so this cannot be
 * an index — it is asked here, on both paths that can write a creator handle.
 *
 * Cast handles are stored with a leading `@` (`seed.ts`), creator handles without one, so the
 * comparison is made on both spellings, case-insensitively — same as `persona-handle.ts`.
 */
export async function collidesWithCast(prisma: PrismaClient, handle: string): Promise<boolean> {
  const cast = await prisma.worldCharacter.findFirst({
    where: { handle: { in: [handle, `@${handle}`], mode: "insensitive" } },
    select: { id: true },
  });
  return cast !== null;
}

/** May this string be somebody's public credit at all? Shape and reservations only — no I/O. */
export const isUsableCreatorHandle = (handle: string): boolean =>
  CREATOR_HANDLE_RE.test(handle) && !RESERVED.has(handle);

const isTakenHandle = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError
  && err.code === "P2002"
  && String((err.meta as { target?: unknown } | undefined)?.target ?? "").includes("creatorHandle");

/* --------------------------------------------------------------------- signup ---- */

/**
 * Create an account **with** its credit line. The name is retried, the row is not: a lost race on
 * the unique index costs one more candidate, never a failed signup, and two signups that would
 * have picked the same placeholder end up with two different names rather than one 500.
 *
 * Any other unique violation (a concurrent signup on the same address) is the caller's to handle
 * and is rethrown untouched.
 */
export async function createUserWithCreatorHandle(
  prisma: PrismaClient,
  data: Omit<Prisma.UserUncheckedCreateInput, "creatorHandle">,
  seed: string = freshSeed(),
): Promise<User> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    // After a few losses the seed itself is the problem (two rows deriving one name), so stop
    // deriving from it and start drawing fresh entropy instead of walking a crowded neighbourhood.
    const candidate = placeholderHandle(attempt < 4 ? `${seed}:${attempt}` : `${freshSeed()}:${attempt}`);
    if (!isUsableCreatorHandle(candidate)) continue;
    if (await collidesWithCast(prisma, candidate)) continue;
    try {
      return await prisma.user.create({ data: { ...data, creatorHandle: candidate } });
    } catch (err: unknown) {
      if (isTakenHandle(err)) continue;
      throw err;
    }
  }
  throw new Error("could not mint a creator handle");
}

/* ------------------------------------------------------------- the one upgrade ---- */

/**
 * The first persona names the account, once.
 *
 * Called after the persona exists, and deliberately **best-effort**: the credit line is never a
 * reason a player fails to enter a world. Every outcome is final, because the window is "the first
 * persona", not "the first persona that happened to work" — leaving it open would restore exactly
 * the bug being fixed, a later persona in a later world moving an earlier world's credit.
 *
 * Four ways it declines, all of them leaving the placeholder in place:
 *  - the window is already closed (this is a second persona, or a concurrent first one won),
 *  - something of theirs has already been seen by somebody else under the placeholder,
 *  - the name is a cast handle, reserved, or malformed,
 *  - another account already goes by it. (`rina` is free per world, so two players can both be
 *    `@rina` in their own worlds; only one of them can be `@rina` to the whole product. The loser
 *    keeps a name that is at least theirs and stable — inventing `rina2` for someone who never
 *    typed it is worse than a placeholder they can rename later.)
 */
export async function adoptFirstPersonaHandle(
  prisma: PrismaClient,
  userId: string,
  rawHandle: string,
  now: Date,
): Promise<string | null> {
  // Claim the window first, conditionally: whoever wins this UPDATE owns the one attempt.
  const claimed = await prisma.user.updateMany({
    where: { id: userId, creatorHandleClaimedAt: null },
    data: { creatorHandleClaimedAt: now },
  });
  if (claimed.count === 0) return null;

  if (await hasBeenSeenByAnyone(prisma, userId)) return null;

  const handle = normHandle(rawHandle);
  if (!isUsableCreatorHandle(handle)) return null;
  if (await collidesWithCast(prisma, handle)) return null;

  try {
    const updated = await prisma.user.update({ where: { id: userId }, data: { creatorHandle: handle } });
    return updated.creatorHandle;
  } catch (err: unknown) {
    if (isTakenHandle(err)) return null;
    throw err;
  }
}

/**
 * Has any world of theirs carried this credit in front of somebody else yet?
 *
 * `published` is live (a link, or Explore), `review` is on a moderator's card — which shows the
 * creator handle — and `reviewedAt`/`pulledAt` survive a world being pulled back to private, so a
 * round trip cannot reopen a window that a reviewer already saw. A `generating` or `ready` world
 * has been seen by nobody but its creator, which is why creating a world before a persona does not
 * cost the player their name.
 */
export function hasBeenSeenByAnyone(prisma: PrismaClient, userId: string): Promise<boolean> {
  return prisma.world
    .findFirst({
      where: {
        createdBy: userId,
        OR: [{ status: { in: ["published", "review"] } }, { reviewedAt: { not: null } }, { pulledAt: { not: null } }],
      },
      select: { id: true },
    })
    .then((w) => w !== null);
}
