/**
 * S1-2 — report & block (Agent G).
 *
 * The snapshot of reported content is always read from the database, never from the request:
 * a client-supplied "this is what they said" is worthless to a reviewer and trivially forged.
 */
import type { Prisma, PrismaClient, Report, ReportTarget } from "@prisma/client";
import { envStr } from "../env";

/** Ids of the characters this persona has blocked. */
export async function blockedCharacterIds(prisma: PrismaClient, personaId: string): Promise<string[]> {
  const rows = await prisma.blockedCharacter.findMany({ where: { personaId }, select: { characterId: true } });
  return rows.map((r) => r.characterId);
}

type CharacterRef = { authorCharacterId?: string | null; characterId?: string | null };

const defaultIdOf = (item: unknown): string | null => {
  const ref = item as CharacterRef;
  return ref.authorCharacterId ?? ref.characterId ?? null;
};

/**
 * Pure filter: drops everything authored by / addressed to a blocked character.
 * `idOf` defaults to `authorCharacterId` then `characterId`; pass one for other shapes
 * (e.g. the world cast, keyed on `id`).
 */
export function withoutBlocked<T>(list: readonly T[], blockedIds: readonly string[], idOf: (item: T) => string | null = defaultIdOf): T[] {
  if (blockedIds.length === 0) return [...list];
  const blocked = new Set(blockedIds);
  return list.filter((item) => {
    const id = idOf(item);
    return id === null || !blocked.has(id);
  });
}

export interface ReportedContent {
  snapshot: string;
  generationId: string | null;
}

/**
 * Server-side lookup of the reported text. `null` means "no such target" → 404, so a report can
 * never be filed against something that does not exist.
 */
export async function loadReportedContent(
  prisma: PrismaClient,
  target: ReportTarget,
  targetId: string,
): Promise<ReportedContent | null> {
  switch (target) {
    case "post": {
      const post = await prisma.post.findUnique({
        where: { id: targetId },
        include: { authorCharacter: { select: { handle: true } } },
      });
      if (!post) return null;
      const who = post.authorCharacter ? `@${post.authorCharacter.handle}` : "@you";
      return { snapshot: `${who}: ${post.text}`, generationId: post.generationId };
    }
    case "dm_message": {
      const message = await prisma.dMMessage.findUnique({
        where: { id: targetId },
        include: { thread: { select: { character: { select: { handle: true } } } } },
      });
      if (!message) return null;
      const who = message.fromCharacter ? `@${message.thread.character.handle}` : "@you";
      return { snapshot: `${who}: ${message.text}`, generationId: message.generationId };
    }
    case "character": {
      const character = await prisma.worldCharacter.findUnique({ where: { id: targetId } });
      if (!character) return null;
      return { snapshot: `@${character.handle} (${character.displayName}) — ${character.role}`, generationId: null };
    }
    case "world": {
      const world = await prisma.world.findUnique({ where: { id: targetId } });
      if (!world) return null;
      return { snapshot: `world:${world.slug}`, generationId: null };
    }
    default:
      return null;
  }
}

/** An unresolved report by the same user against the same thing — the duplicate we refuse. */
export function findOpenReport(
  prisma: PrismaClient,
  userId: string,
  target: ReportTarget,
  targetId: string,
): Promise<Report | null> {
  return prisma.report.findFirst({ where: { userId, target, targetId, status: "open" } });
}

export function createReport(prisma: PrismaClient, data: Prisma.ReportUncheckedCreateInput): Promise<Report> {
  return prisma.report.create({ data });
}

/**
 * The admin queue read is gated: `TEST_HOOKS=1` (local + E2E) or a matching `ADMIN_TOKEN`
 * bearer/`x-admin-token` header. `env.ts` belongs to Agent F, so the variable is read here.
 */
export const adminToken = (): string => envStr("ADMIN_TOKEN", "");

export function adminTokenMatches(presented: string | undefined): boolean {
  const expected = adminToken();
  return expected.length > 0 && presented === expected;
}
