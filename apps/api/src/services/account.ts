/**
 * S1-1 — account deletion, restore, purge and the GDPR/APPI export (Agent G).
 *
 * Deletion is a two-phase affair: `POST /v1/account/delete` stamps `User.deletedAt` and every
 * route this agent owns then answers 410 ACCOUNT_DELETED, while `purgeDeletedAccounts()` hard
 * deletes everything once the grace window (`DELETION_GRACE_DAYS`) has passed.
 */
import type { MiddlewareHandler } from "hono";
import type { PrismaClient, User } from "@prisma/client";
import { DELETION_GRACE_DAYS } from "@rpgllm/shared";
import { fail } from "../http";
import type { AppEnv } from "../types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** When the row stops being recoverable and becomes purgeable. */
export const purgeAtFor = (deletedAt: Date): Date => new Date(deletedAt.getTime() + DELETION_GRACE_DAYS * DAY_MS);

/** True while the user can still cancel the deletion. */
export const withinGraceWindow = (deletedAt: Date, now: Date): boolean => purgeAtFor(deletedAt).getTime() > now.getTime();

export const isDeleted = (user: Pick<User, "deletedAt">): boolean => user.deletedAt !== null;

/**
 * Applied by the routers this agent owns, right after `requireAuth`.
 *
 * `requireAuth` itself belongs to Agent F; until it learns about `deletedAt` (see the request in
 * build-notes.md) this middleware is the only thing that revokes access, so it is deliberately
 * separate and dependency-free.
 */
export const requireActiveAccount: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get("user");
  if (user && isDeleted(user)) return fail("ACCOUNT_DELETED", "This account is scheduled for deletion", 410);
  await next();
};

export interface PurgeResult {
  users: number;
  personas: number;
  posts: number;
  messages: number;
  generations: number;
}

/**
 * Hard-deletes every user whose grace window has elapsed, plus everything of theirs.
 * Written as explicit deleteMany calls (rather than relying on cascades) so the order is
 * auditable and the result can be asserted on in tests.
 */
export async function purgeDeletedAccounts(prisma: PrismaClient, now: Date): Promise<PurgeResult> {
  const cutoff = new Date(now.getTime() - DELETION_GRACE_DAYS * DAY_MS);
  const doomed = await prisma.user.findMany({
    where: { deletedAt: { not: null, lte: cutoff } },
    select: { id: true },
  });
  const userIds = doomed.map((u) => u.id);
  const result: PurgeResult = { users: 0, personas: 0, posts: 0, messages: 0, generations: 0 };
  if (userIds.length === 0) return result;

  const personas = await prisma.persona.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  const personaIds = personas.map((p) => p.id);
  const threads = personaIds.length
    ? await prisma.dMThread.findMany({ where: { personaId: { in: personaIds } }, select: { id: true } })
    : [];
  const threadIds = threads.map((t) => t.id);
  const relationships = personaIds.length
    ? await prisma.relationshipState.findMany({ where: { personaId: { in: personaIds } }, select: { id: true } })
    : [];
  const relationshipIds = relationships.map((r) => r.id);
  const wallets = await prisma.wallet.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  const walletIds = wallets.map((w) => w.id);

  await prisma.$transaction(async (tx) => {
    if (threadIds.length) result.messages = (await tx.dMMessage.deleteMany({ where: { threadId: { in: threadIds } } })).count;
    if (threadIds.length) await tx.dMThread.deleteMany({ where: { id: { in: threadIds } } });
    if (relationshipIds.length) await tx.memoryEntry.deleteMany({ where: { relationshipId: { in: relationshipIds } } });
    if (relationshipIds.length) await tx.relationshipState.deleteMany({ where: { id: { in: relationshipIds } } });
    if (personaIds.length) {
      result.posts = (await tx.post.deleteMany({ where: { personaId: { in: personaIds } } })).count;
      await tx.post.deleteMany({ where: { authorPersonaId: { in: personaIds } } });
      await tx.statSnapshot.deleteMany({ where: { personaId: { in: personaIds } } });
      await tx.event.deleteMany({ where: { personaId: { in: personaIds } } });
      await tx.blockedCharacter.deleteMany({ where: { personaId: { in: personaIds } } });
      await tx.digest.deleteMany({ where: { personaId: { in: personaIds } } });
      await tx.moment.deleteMany({ where: { personaId: { in: personaIds } } });
      result.personas = (await tx.persona.deleteMany({ where: { id: { in: personaIds } } })).count;
    }
    if (walletIds.length) {
      await tx.ledgerEntry.deleteMany({ where: { walletId: { in: walletIds } } });
      await tx.wallet.deleteMany({ where: { id: { in: walletIds } } });
    }
    await tx.subscription.deleteMany({ where: { userId: { in: userIds } } });
    await tx.purchase.deleteMany({ where: { userId: { in: userIds } } });
    // Rating -> GenerationLog is RESTRICT, so ratings must go before the logs they point at.
    await tx.rating.deleteMany({ where: { userId: { in: userIds } } });
    await tx.experimentAssignment.deleteMany({ where: { userId: { in: userIds } } });
    await tx.report.deleteMany({ where: { userId: { in: userIds } } });
    await tx.pushToken.deleteMany({ where: { userId: { in: userIds } } });
    await tx.referral.deleteMany({ where: { OR: [{ inviterId: { in: userIds } }, { inviteeId: { in: userIds } }] } });
    result.generations = (await tx.generationLog.deleteMany({ where: { userId: { in: userIds } } })).count;
    result.users = (await tx.user.deleteMany({ where: { id: { in: userIds } } })).count;
  });

  return result;
}

export const EXPORT_LIMIT = 1000;

export interface ExportPayload {
  exportedAt: string;
  user: { id: string; email: string | null; locale: "en" | "ja"; birthYear: number | null; createdAt: string };
  personas: Record<string, unknown>[];
  posts: Record<string, unknown>[];
  dms: Record<string, unknown>[];
  purchases: Record<string, unknown>[];
  truncated: boolean;
}

/** GDPR art.20 / APPI portability: everything this user authored, capped so one request stays bounded. */
export async function buildExport(prisma: PrismaClient, user: User, now: Date): Promise<ExportPayload> {
  const personas = await prisma.persona.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    include: { world: { select: { slug: true } } },
  });
  const personaIds = personas.map((p) => p.id);

  const posts = personaIds.length
    ? await prisma.post.findMany({
      where: { personaId: { in: personaIds } },
      orderBy: { createdAt: "asc" },
      take: EXPORT_LIMIT + 1,
      include: { authorCharacter: { select: { handle: true, displayName: true } } },
    })
    : [];
  const messages = personaIds.length
    ? await prisma.dMMessage.findMany({
      where: { thread: { personaId: { in: personaIds } } },
      orderBy: { createdAt: "asc" },
      take: EXPORT_LIMIT + 1,
      include: { thread: { select: { id: true, character: { select: { handle: true } } } } },
    })
    : [];
  const purchases = await prisma.purchase.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });

  const truncated = posts.length > EXPORT_LIMIT || messages.length > EXPORT_LIMIT;

  return {
    exportedAt: now.toISOString(),
    user: {
      id: user.id,
      email: user.email,
      locale: user.locale,
      birthYear: user.birthYear > 0 ? user.birthYear : null,
      createdAt: user.createdAt.toISOString(),
    },
    personas: personas.map((p) => ({
      id: p.id,
      worldSlug: p.world.slug,
      handle: p.handle,
      displayName: p.displayName,
      bio: p.bio,
      followers: p.followers,
      aura: p.aura,
      humor: p.humor,
      level: p.level,
      xp: p.xp,
      createdAt: p.createdAt.toISOString(),
    })),
    posts: posts.slice(0, EXPORT_LIMIT).map((p) => ({
      id: p.id,
      kind: p.kind,
      text: p.text,
      authorHandle: p.authorCharacter ? p.authorCharacter.handle : null,
      isYours: p.authorCharacterId === null,
      parentId: p.parentId,
      createdAt: p.createdAt.toISOString(),
    })),
    dms: messages.slice(0, EXPORT_LIMIT).map((m) => ({
      id: m.id,
      threadId: m.threadId,
      characterHandle: m.thread.character.handle,
      fromCharacter: m.fromCharacter,
      text: m.text,
      createdAt: m.createdAt.toISOString(),
    })),
    purchases: purchases.map((p) => ({
      id: p.id,
      sku: p.sku,
      store: p.store,
      amountUsd: Number(p.amountUsd),
      createdAt: p.createdAt.toISOString(),
    })),
    truncated,
  };
}

/** S1-6: minors can never turn analytics/personalised ads on. */
export function resolveConsent(user: Pick<User, "isMinor">, requested: boolean): { analytics: boolean; locked: boolean } {
  if (user.isMinor) return { analytics: false, locked: true };
  return { analytics: requested, locked: false };
}
