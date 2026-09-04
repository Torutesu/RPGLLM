import type { Moment, Persona, Prisma, PrismaClient, StatSnapshot } from "@prisma/client";
import { atHandle } from "./handles";
import { hashString } from "./rng";
import { readRelDeltas } from "./serialize";

/**
 * S2-4 (AIF-005) — Shareable Moment.
 *
 * A `StatSnapshot` becomes a Moment when the swing is worth screenshotting:
 *   • |followersDelta| >= 25% of the follower count before the action, or
 *   • |auraDelta| >= 5, or
 *   • the snapshot resolved a drama event (`cause = "event:<id>"`).
 * The Moment holds everything the card needs, so `/v1/moments/:slug` can render for a stranger
 * with no auth and no further queries.
 */
export const MOMENT_FOLLOWER_RATIO = 0.25;
export const MOMENT_AURA_DELTA = 5;
/** how many recent snapshots a read scans for un-momented swings */
export const MOMENT_SCAN = 20;
const REACTIONS = 3;

/** Unambiguous alphabet (no 0/O/1/I/L) so a slug survives being read out loud. */
const SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const SLUG_LENGTH = 10;

export function momentSlug(seed: string): string {
  let h = hashString(seed);
  let out = "";
  for (let i = 0; i < SLUG_LENGTH; i += 1) {
    h = hashString(`${seed}:${h}:${i}`);
    out += SLUG_ALPHABET[h % SLUG_ALPHABET.length] ?? "a";
  }
  return out;
}

export const momentCause = (snapshotId: string): string => `snapshot:${snapshotId}`;

export function followersBefore(snapshot: StatSnapshot, persona: Persona): number {
  const { after } = readRelDeltas(snapshot.relDeltas);
  const now = after?.followers ?? persona.followers;
  return Math.max(0, now - snapshot.followersDelta);
}

export function qualifies(snapshot: StatSnapshot, persona: Persona): boolean {
  if (snapshot.cause.startsWith("event:")) return true;
  if (Math.abs(snapshot.auraDelta) >= MOMENT_AURA_DELTA) return true;
  const before = followersBefore(snapshot, persona);
  return before > 0 && Math.abs(snapshot.followersDelta) >= before * MOMENT_FOLLOWER_RATIO;
}

export interface MomentPayload extends Record<string, unknown> {
  cause: string;
  persona: { handle: string; displayName: string; followers: number; aura: number; humor: number; level: number };
  deltas: { followers: number; aura: number; humor: number };
  after: { followers: number; aura: number; humor: number };
  reactions: { handle: string; displayName: string; text: string }[];
  createdAt: string;
}

export interface ApiMoment {
  id: string;
  shareSlug: string;
  headline: string;
  body: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export function toApiMoment(row: Moment): ApiMoment {
  return {
    id: row.id,
    shareSlug: row.shareSlug,
    headline: row.headline,
    body: row.body,
    payload: (row.payload && typeof row.payload === "object" ? row.payload : {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The 3 loudest character voices around the action the snapshot came from. */
async function reactionsFor(
  prisma: PrismaClient,
  personaId: string,
  cause: string,
): Promise<MomentPayload["reactions"]> {
  const postId = cause.startsWith("post:") ? cause.slice("post:".length) : null;
  const rows = await prisma.post.findMany({
    where: postId
      ? { parentId: postId, kind: "character" }
      : { personaId, kind: { in: ["character", "news"] } },
    orderBy: { createdAt: "desc" },
    take: REACTIONS,
    include: { authorCharacter: true },
  });
  return rows.flatMap((r) =>
    r.authorCharacter
      ? [{ handle: atHandle(r.authorCharacter.handle), displayName: r.authorCharacter.displayName, text: r.text }]
      : [],
  );
}

/** The headline is the first sentence of the generated narrative — never hardcoded copy. */
export function headlineOf(narrative: string): string {
  const trimmed = narrative.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) return "…";
  const first = trimmed.split(/(?<=[.!?。！？])\s/)[0] ?? trimmed;
  return first.length > 80 ? `${first.slice(0, 79)}…` : first;
}

export async function createMomentFor(
  prisma: PrismaClient,
  persona: Persona,
  snapshot: StatSnapshot,
): Promise<Moment | null> {
  const cause = momentCause(snapshot.id);
  const existing = await prisma.moment.findFirst({ where: { personaId: persona.id, cause } });
  if (existing) return existing;

  const { after } = readRelDeltas(snapshot.relDeltas);
  const resolved = after ?? { followers: persona.followers, aura: persona.aura, humor: persona.humor };
  const payload: MomentPayload = {
    cause: snapshot.cause,
    persona: {
      handle: atHandle(persona.handle),
      displayName: persona.displayName,
      followers: resolved.followers,
      aura: resolved.aura,
      humor: resolved.humor,
      level: persona.level,
    },
    deltas: { followers: snapshot.followersDelta, aura: snapshot.auraDelta, humor: snapshot.humorDelta },
    after: resolved,
    reactions: await reactionsFor(prisma, persona.id, snapshot.cause),
    createdAt: snapshot.createdAt.toISOString(),
  };

  return await prisma.moment.create({
    data: {
      personaId: persona.id,
      cause,
      headline: headlineOf(snapshot.narrative),
      body: snapshot.narrative,
      payload: payload as unknown as Prisma.InputJsonValue,
      shareSlug: momentSlug(`${persona.id}:${snapshot.id}`),
    },
  });
}

/**
 * Scans the persona's recent snapshots and materialises a Moment for every qualifying one that
 * does not have a card yet. Called from the moments read (there is no scheduler in this build)
 * and at the end of the offline-director job.
 */
export async function ensureMomentsFor(prisma: PrismaClient, persona: Persona): Promise<Moment[]> {
  const snapshots = await prisma.statSnapshot.findMany({
    where: { personaId: persona.id },
    orderBy: { createdAt: "desc" },
    take: MOMENT_SCAN,
  });
  const created: Moment[] = [];
  for (const snapshot of snapshots) {
    if (!qualifies(snapshot, persona)) continue;
    const moment = await createMomentFor(prisma, persona, snapshot);
    if (moment) created.push(moment);
  }
  return created;
}
