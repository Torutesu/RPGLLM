/**
 * World Studio (AIF-003) — the rules a player-authored world lives by.
 *
 * Routes and the build job both come here, so "what does a world cost", "how many may I make
 * today", "who is allowed to see this one" and "has this world already been refunded" each have
 * exactly one answer.
 */
import type { Prisma, PrismaClient, Subscription, World } from "@prisma/client";
import { WORLD_STUDIO, type WorldSummaryFullZ } from "@rpgllm/shared";
import type { z } from "zod";
import { entitlementsFor } from "./entitlements";
import { localized, type LocaleKey } from "./locale";
import type { Tx } from "../types";
import { envNum } from "../env";

export type ApiWorldFull = z.infer<typeof WorldSummaryFullZ>;

/** How long a world may sit in `generating` before the sweep calls it a failure. */
export const worldBuildTimeoutMs = (): number => envNum("WORLD_BUILD_TIMEOUT_MS", 10 * 60 * 1000);
/** How many worlds one job run will build. One G9 call each, so this is a spend limit. */
export const worldBuildBatchSize = (): number => envNum("WORLD_BUILD_BATCH", 5);

/** Plus buys headroom, not free worlds (WORLD_STUDIO.DAILY_LIMIT_PLUS). */
export const dailyWorldLimit = (sub: Subscription | null, now: Date): number =>
  entitlementsFor(sub, now).entitled ? WORLD_STUDIO.DAILY_LIMIT_PLUS : WORLD_STUDIO.DAILY_LIMIT;

export const startOfUtcDay = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/**
 * Every world the account started today, whatever became of it. A failed build refunds its gems
 * but still spent a G9 call, so it still counts — the daily limit is a spend limit, not a quota of
 * successes.
 */
export const worldsCreatedToday = (prisma: PrismaClient, userId: string, now: Date): Promise<number> =>
  prisma.world.count({ where: { createdBy: userId, createdAt: { gte: startOfUtcDay(now) } } });

/* ------------------------------------------------------------------- slugs ---- */

const RESERVED = new Set(["mine", "public", "new", "admin", "review"]);

/** kebab-case, ASCII, ≤ 48 chars. Non-Latin premises (ja) legitimately reduce to nothing. */
export function slugifyPremise(premise: string, fallback: string): string {
  const base = premise
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter(Boolean)
    .slice(0, 6)
    .join("-")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return base.length >= 3 && !RESERVED.has(base) ? base : fallback;
}

/**
 * A free slug for `base`. Racy by construction (two requests can read the same answer), which is
 * why the caller creates the row inside a transaction and retries on the unique-index violation.
 */
export async function uniqueSlug(prisma: PrismaClient, base: string, salt: string): Promise<string> {
  const taken = new Set(
    (await prisma.world.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } })).map((w) => w.slug),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; i <= 20; i += 1) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${salt}`;
}

/* -------------------------------------------------------------------- gems ---- */

export class GemsRequiredError extends Error {
  constructor(readonly needed: number, readonly have: number) { super("GEMS_REQUIRED"); }
}

/**
 * Debit gems in the caller's transaction. The `gems >= cost` guard lives in the WHERE clause, so
 * two concurrent creates cannot both pass a read-then-write check and overdraw the wallet.
 */
export async function spendGems(tx: Tx, walletId: string, cost: number, ref: string): Promise<number> {
  const res = await tx.wallet.updateMany({
    where: { id: walletId, gems: { gte: cost } },
    data: { gems: { decrement: cost } },
  });
  if (res.count === 0) {
    const current = await tx.wallet.findUnique({ where: { id: walletId }, select: { gems: true } });
    throw new GemsRequiredError(cost, current?.gems ?? 0);
  }
  await tx.ledgerEntry.create({ data: { walletId, currency: "gems", delta: -cost, source: "spend", ref } });
  const after = await tx.wallet.findUniqueOrThrow({ where: { id: walletId }, select: { gems: true } });
  return after.gems;
}

/**
 * Refund a failed build — **at most once, ever**.
 *
 * `refundedAt` is claimed with a conditional UPDATE in the same transaction as the wallet write, so
 * a retried job, a concurrent sweep and a manual re-run all collapse into one refund: whoever loses
 * the race gets `count === 0` and does nothing.
 */
export async function refundWorldOnce(
  tx: Tx,
  world: Pick<World, "id" | "slug" | "createdBy">,
  now: Date,
  failureReason: string,
): Promise<boolean> {
  const claimed = await tx.world.updateMany({
    where: { id: world.id, refundedAt: null },
    data: { refundedAt: now, status: "draft", failureReason, buildStartedAt: null },
  });
  if (claimed.count === 0) return false;
  if (!world.createdBy) return true;
  const wallet = await tx.wallet.findUnique({ where: { userId: world.createdBy }, select: { id: true } });
  if (!wallet) return true;
  await tx.wallet.update({ where: { id: wallet.id }, data: { gems: { increment: WORLD_STUDIO.GEM_COST } } });
  await tx.ledgerEntry.create({
    data: { walletId: wallet.id, currency: "gems", delta: WORLD_STUDIO.GEM_COST, source: "admin", ref: `world_refund:${world.id}` },
  });
  return true;
}

/* ------------------------------------------------------------ visibility ---- */

/**
 * The world picker (`GET /v1/worlds`): every preset, plus the caller's own finished worlds.
 * A private world is playable the moment it is built and is never listed to anyone else; community
 * worlds are a different endpoint on purpose.
 */
export const pickerWhere = (userId: string): Prisma.WorldWhereInput => ({
  OR: [
    { isPreset: true },
    // `rejected` stays in: a world turned down for Explore is still the creator's to play.
    { createdBy: userId, status: { in: ["ready", "published", "review", "rejected"] } },
  ],
});

/** Who may open one world: its creator always, everyone else only once it is published + public. */
export const canPlay = (world: World, userId: string): boolean =>
  world.isPreset
  || world.createdBy === userId
  || (world.status === "published" && world.visibility !== "private");

/**
 * `canPlay`, plus the one exception post-publication moderation creates: **a world pulled off the
 * shelf by reports is not deleted**. Its creator keeps it (that is already `canPlay`), and so does
 * anyone who was mid-game when it was pulled — they have a persona, a feed and a relationship cast
 * in it, and taking a world out of Explore must not evict them from a story they are playing.
 *
 * Deliberately narrow: only a *pulled* world (`review` + `pulledAt`), and only for someone who
 * already has a persona in it. A world a human then rejects goes private and this stops applying —
 * a person decided that one, and nobody joins a pulled world who was not already there.
 */
export async function canStillPlay(prisma: PrismaClient, world: World, userId: string): Promise<boolean> {
  if (canPlay(world, userId)) return true;
  if (world.status !== "review" || world.pulledAt === null) return false;
  const persona = await prisma.persona.findFirst({ where: { worldId: world.id, userId }, select: { id: true } });
  return persona !== null;
}

/* ------------------------------------------------------------ serialising ---- */

export function toApiWorldFull(
  world: World,
  locale: LocaleKey,
  viewerId: string,
  extra: { castCount: number; creatorHandle: string | null },
): ApiWorldFull {
  return {
    id: world.id,
    slug: world.slug,
    title: localized(world.title, locale),
    scenario: localized(world.scenario, locale),
    difficulty: world.difficulty,
    coverUrl: world.coverUrl,
    status: world.status,
    visibility: world.visibility,
    premise: world.premise,
    isPreset: world.isPreset,
    isMine: world.createdBy === viewerId,
    creatorHandle: extra.creatorHandle,
    playCount: world.playCount,
    castCount: extra.castCount,
    createdAt: world.createdAt.toISOString(),
    reason: world.status === "rejected"
      ? (world.rejectedReason || null)
      : (world.failureReason || null),
    // "Taken down for another look" is a different thing to say than "not looked at yet", and the
    // status is `review` for both — so the difference lives here (WORLD_MODERATION).
    pulled: world.pulledAt !== null,
  };
}

/**
 * 0..1, so the wait can be a progress beat rather than an indeterminate spinner. While generating
 * it is time-based and caps below 1 — the job, not the clock, is what finishes a world.
 */
export function buildProgress(world: World, now: Date): number {
  switch (world.status) {
    case "ready":
    case "review":
    case "published":
      return 1;
    case "draft":
    case "rejected":
      return 0;
    case "generating": {
      const since = (world.buildStartedAt ?? world.createdAt).getTime();
      const elapsed = Math.max(0, now.getTime() - since);
      // Expect a build to take a fraction of the timeout; anything past that is the sweep's problem.
      const expected = Math.max(1, worldBuildTimeoutMs() / 4);
      return Math.min(0.95, 0.05 + 0.9 * Math.min(1, elapsed / expected));
    }
  }
}

/** The creator's most recent persona handle — worlds are credited to a persona, never to an email. */
export async function creatorHandles(prisma: PrismaClient, userIds: readonly string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const rows = await prisma.persona.findMany({
    where: { userId: { in: ids } },
    orderBy: { createdAt: "desc" },
    select: { userId: true, handle: true },
  });
  const out = new Map<string, string>();
  for (const row of rows) if (!out.has(row.userId)) out.set(row.userId, row.handle);
  return out;
}

/** `castCount` for a batch of worlds, in one GROUP BY rather than one query per card. */
export async function castCounts(prisma: PrismaClient, worldIds: readonly string[]): Promise<Map<string, number>> {
  if (worldIds.length === 0) return new Map();
  const rows = await prisma.worldCharacter.groupBy({
    by: ["worldId"],
    where: { worldId: { in: [...worldIds] } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.worldId, r._count._all]));
}

/** Everything the list endpoints need, resolved in three queries regardless of page size. */
export async function decorate(
  prisma: PrismaClient,
  worlds: World[],
  locale: LocaleKey,
  viewerId: string,
): Promise<ApiWorldFull[]> {
  const [counts, handles] = await Promise.all([
    castCounts(prisma, worlds.map((w) => w.id)),
    creatorHandles(prisma, worlds.flatMap((w) => (w.createdBy ? [w.createdBy] : []))),
  ]);
  return worlds.map((w) =>
    toApiWorldFull(w, locale, viewerId, {
      castCount: counts.get(w.id) ?? 0,
      creatorHandle: w.createdBy ? (handles.get(w.createdBy) ?? null) : null,
    }));
}
