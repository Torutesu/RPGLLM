import type { Digest, Persona, PrismaClient } from "@prisma/client";
import { DIGEST } from "@rpgllm/shared";
import type { Clock } from "../clock";

export interface ApiDigest {
  id: string;
  headline: string;
  body: string;
  postIds: string[];
  createdAt: string;
  seenAt: string | null;
}

export function readPostIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

export function toApiDigest(row: Digest): ApiDigest {
  return {
    id: row.id,
    headline: row.headline,
    body: row.body,
    postIds: readPostIds(row.postIds),
    createdAt: row.createdAt.toISOString(),
    seenAt: row.seenAt ? row.seenAt.toISOString() : null,
  };
}

export const newestUnseenDigest = (prisma: PrismaClient, personaId: string): Promise<Digest | null> =>
  prisma.digest.findFirst({ where: { personaId, seenAt: null }, orderBy: { createdAt: "desc" } });

/**
 * When the player last *acted* — their own posts and DMs, the persona's birth, and the last
 * digest we generated (so two digests can never stack up back to back).
 * Character/ambient rows are excluded on purpose: the world moving is not the user being present.
 */
export async function lastActivityAt(prisma: PrismaClient, persona: Persona): Promise<Date> {
  const [post, dm, digest] = await Promise.all([
    prisma.post.findFirst({
      where: { personaId: persona.id, authorPersonaId: persona.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.dMMessage.findFirst({
      where: { fromCharacter: false, thread: { personaId: persona.id } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.digest.findFirst({ where: { personaId: persona.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  const times = [persona.createdAt, post?.createdAt, dm?.createdAt, digest?.createdAt]
    .filter((d): d is Date => d instanceof Date)
    .map((d) => d.getTime());
  return new Date(Math.max(...times));
}

export const awayHours = (from: Date, now: Date): number => (now.getTime() - from.getTime()) / 3_600_000;

/** AIF-001 fires only after `DIGEST.MIN_AWAY_HOURS` of silence. */
export async function isAway(prisma: PrismaClient, clock: Clock, persona: Persona): Promise<boolean> {
  return awayHours(await lastActivityAt(prisma, persona), clock.now()) >= DIGEST.MIN_AWAY_HOURS;
}

/**
 * Persona lookup shared by the S2 reads: an explicit `?personaId=` must belong to the caller,
 * otherwise the newest persona of the account is used (same rule as `GET /v1/feed`).
 */
export async function personaFor(
  prisma: PrismaClient,
  userId: string,
  personaId?: string,
): Promise<Persona | null> {
  const persona = personaId
    ? await prisma.persona.findUnique({ where: { id: personaId } })
    : await prisma.persona.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
  return persona && persona.userId === userId ? persona : null;
}
