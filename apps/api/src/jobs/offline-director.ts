import type { Persona, Prisma, PrismaClient, WorldCharacter } from "@prisma/client";
import type { Gateway } from "@rpgllm/llm";
import { DIGEST, t, type G1Input, type G5Input } from "@rpgllm/shared";
import type { Clock } from "../clock";
import { isAway, newestUnseenDigest } from "../services/digest";
import { logGeneration } from "../services/generation";
import { normHandle } from "../services/handles";
import { localized } from "../services/locale";
import { notifyUser } from "../services/push";
import { computeMetrics, seedFrom } from "../services/rng";
import {
  baseCtx, castCards, characterByHandle, involvedFor, loadStoryContext, personaState, pressAccount,
  type StoryContext,
} from "../services/story";
import type { Deps } from "../types";

/**
 * S2-1 / AIF-001 — the Offline World Director.
 *
 * While the player is away the world keeps moving: a director beat (G5), a handful of character
 * posts and a press line (G1), and one DM from the follower who likes them most (G4). The result
 * is persisted as a `Digest` row that SCR-038 pins above the feed.
 *
 * cost-architecture §3 specifies **G10** on the Batch tier for this; `packages/llm` ships no `g10`
 * (nor `g2`), so the beat is composed from **G5 + G1** — the same context, one extra call, and
 * every call still goes through the gateway and lands in `GenerationLog` (build-notes "Agent H").
 *
 * Costs **no energy**: the user did not act.
 */
export interface OfflineDirectorOptions {
  /** run for one persona instead of scanning */
  personaId?: string;
  /** ignore the `DIGEST.MIN_AWAY_HOURS` window (test hook / manual run) */
  force?: boolean;
  /** max personas per scan */
  limit?: number;
}

export interface DigestSummary {
  personaId: string;
  digestId: string;
  headline: string;
  postIds: string[];
  dmMessageId: string | null;
  pushed: number;
}

export interface OfflineDirectorResult {
  considered: number;
  generated: DigestSummary[];
  skipped: number;
}

const DEFAULT_LIMIT = 25;
/** G1 caps k at 4, so POSTS_PER_DIGEST is filled with as few calls as possible. */
const MAX_K = 4;

async function createPost(
  prisma: PrismaClient,
  data: Prisma.PostUncheckedCreateInput,
  followers: number,
): Promise<string> {
  const created = await prisma.post.create({ data });
  await prisma.post.update({
    where: { id: created.id },
    data: { metrics: computeMetrics(created.id, followers) as unknown as Prisma.InputJsonValue },
  });
  return created.id;
}

async function directorBeat(
  deps: Deps,
  ctx: StoryContext,
): Promise<{ headline: string; body: string }> {
  const [snapshots, past] = await Promise.all([
    deps.prisma.statSnapshot.findMany({ where: { personaId: ctx.persona.id }, orderBy: { createdAt: "desc" }, take: 5 }),
    deps.prisma.event.findMany({ where: { personaId: ctx.persona.id }, select: { title: true } }),
  ]);
  const byId = new Map(ctx.characters.map((c) => [c.id, c]));
  const input: G5Input = {
    ...baseCtx(ctx),
    persona: personaState(ctx),
    relationships: ctx.relationships.flatMap((r) => {
      const ch = byId.get(r.characterId);
      return ch ? [{ handle: normHandle(ch.handle), affinity: r.affinity, summary: r.summary, isFollower: r.isFollower }] : [];
    }),
    recentSnapshots: snapshots.map((s) => ({
      narrative: s.narrative, followersDelta: s.followersDelta, auraDelta: s.auraDelta, humorDelta: s.humorDelta,
    })),
    pastEventTitles: past.map((p) => p.title),
    seed: seedFrom(`digest:${ctx.persona.id}:${deps.clock.now().toISOString().slice(0, 13)}`),
  };
  const result = await deps.gateway.g5(input);
  await logGeneration(deps.prisma, result.meta, ctx.user.id);
  const body = result.output.choices[0]?.outcomeText ?? result.output.prompt;
  return { headline: result.output.title, body };
}

/** Character chatter about the beat. Returns the created post ids, newest last. */
async function worldPosts(
  deps: Deps,
  ctx: StoryContext,
  beat: { headline: string; body: string },
): Promise<string[]> {
  const wanted = DIGEST.POSTS_PER_DIGEST;
  const ids: string[] = [];
  const now = deps.clock.now();
  const press = pressAccount(ctx.characters);
  let round = 0;

  while (ids.length < wanted && round < Math.ceil(wanted / MAX_K)) {
    const k = Math.min(MAX_K, wanted - ids.length);
    const input: G1Input = {
      ...baseCtx(ctx),
      persona: personaState(ctx),
      cast: castCards(ctx),
      involved: involvedFor(ctx, null),
      recentFeed: [{ authorHandle: normHandle(press?.handle ?? ctx.persona.handle), kind: "news", text: beat.body }],
      post: { text: `${beat.headline} — ${beat.body}`, parentAuthorHandle: null, parentText: null },
      k,
      softened: false,
      seed: seedFrom(`digest:${ctx.persona.id}:${round}:${beat.headline}`),
      includeNews: round === 0,
    };
    const result = await deps.gateway.g1(input);
    const generationId = await logGeneration(deps.prisma, result.meta, ctx.user.id);

    for (const [i, reply] of result.output.replies.entries()) {
      if (ids.length >= wanted) break;
      const character: WorldCharacter | undefined =
        characterByHandle(ctx.characters, reply.characterHandle) ?? ctx.characters[i % Math.max(1, ctx.characters.length)];
      if (!character) continue;
      // Stamped a minute apart so the digest reads chronologically at the top of the feed.
      const createdAt = new Date(now.getTime() - (wanted - ids.length) * 60_000);
      ids.push(await createPost(deps.prisma, {
        worldId: ctx.world.id,
        personaId: ctx.persona.id,
        authorCharacterId: character.id,
        kind: "character",
        text: reply.text,
        generationId,
        createdAt,
        metrics: {},
      }, ctx.persona.followers));
    }

    if (result.output.news && press) {
      ids.push(await createPost(deps.prisma, {
        worldId: ctx.world.id,
        personaId: ctx.persona.id,
        authorCharacterId: press.id,
        kind: "news",
        text: result.output.news.text,
        generationId,
        createdAt: now,
        metrics: { causedBy: `digest:${ctx.persona.id}` } as unknown as Prisma.InputJsonValue,
      }, ctx.persona.followers));
    }
    round += 1;
    if (result.output.replies.length === 0) break;
  }
  return ids;
}

/** One DM from the follower with the highest affinity — the "someone missed you" beat. */
async function dmFromFavourite(
  deps: Deps,
  ctx: StoryContext,
  beat: { headline: string; body: string },
): Promise<string | null> {
  const byId = new Map(ctx.characters.map((c) => [c.id, c]));
  const best = [...ctx.relationships]
    .filter((r) => byId.has(r.characterId))
    .sort((a, b) => (b.isFollower ? 1 : 0) - (a.isFollower ? 1 : 0) || b.affinity - a.affinity)[0];
  const character = best ? byId.get(best.characterId) : undefined;
  if (!best || !character) return null;

  const result = await deps.gateway.g4({
    ...baseCtx(ctx),
    persona: personaState(ctx),
    character: {
      handle: normHandle(character.handle),
      displayName: character.displayName,
      role: character.role,
      card: localized(character.card, ctx.locale),
      isPressAccount: character.isPressAccount,
    },
    relationship: {
      handle: normHandle(character.handle),
      affinity: best.affinity,
      summary: best.summary,
      isFollower: best.isFollower,
    },
    history: [],
    message: `${beat.headline} — ${beat.body}`,
    softened: false,
    seed: seedFrom(`digest-dm:${ctx.persona.id}:${beat.headline}`),
  });
  const generationId = await logGeneration(deps.prisma, result.meta, ctx.user.id);
  const text = result.output.bubbles[0];
  if (!text) return null;

  const now = deps.clock.now();
  const thread = await deps.prisma.dMThread.upsert({
    where: { personaId_characterId: { personaId: ctx.persona.id, characterId: character.id } },
    create: { personaId: ctx.persona.id, characterId: character.id, lastMessageAt: now },
    update: { lastMessageAt: now, unreadCount: { increment: 1 } },
  });
  const message = await deps.prisma.dMMessage.create({
    data: { threadId: thread.id, fromCharacter: true, text, generationId, createdAt: now },
  });
  // upsert's `create` branch cannot also bump the counter
  await deps.prisma.dMThread.update({ where: { id: thread.id }, data: { unreadCount: Math.max(1, thread.unreadCount) } });
  return message.id;
}

/** Generates the digest for one persona, or returns null when it does not need one. */
export async function generateDigestFor(
  deps: Deps,
  persona: Persona,
  opts: { force?: boolean } = {},
): Promise<DigestSummary | null> {
  const unseen = await newestUnseenDigest(deps.prisma, persona.id);
  if (unseen) return null;
  if (!opts.force && !(await isAway(deps.prisma, deps.clock, persona))) return null;

  const user = await deps.prisma.user.findUnique({ where: { id: persona.userId } });
  if (!user || user.deletedAt) return null;
  const ctx = await loadStoryContext(deps.prisma, user, persona.id);
  if (!ctx) return null;

  const beat = await directorBeat(deps, ctx);
  const postIds = await worldPosts(deps, ctx, beat);
  const dmMessageId = await dmFromFavourite(deps, ctx, beat);

  const digest = await deps.prisma.digest.create({
    data: {
      personaId: persona.id,
      headline: beat.headline,
      body: beat.body,
      postIds: postIds as unknown as Prisma.InputJsonValue,
      createdAt: deps.clock.now(),
    },
  });

  const push = await notifyUser(deps.prisma, user.id, {
    title: t(ctx.locale, "whileYouWereAway"),
    body: beat.headline,
    data: { digestId: digest.id, personaId: persona.id },
  });

  return { personaId: persona.id, digestId: digest.id, headline: beat.headline, postIds, dmMessageId, pushed: push.sent };
}

/**
 * Runnable three ways (there is no scheduler in this build — see build-notes):
 *   1. directly, as this function (a cron/worker would call it),
 *   2. `POST /v1/__test/run-job {"job":"digest"}` when TEST_HOOKS=1,
 *   3. opportunistically from `GET /v1/digest`, which generates on demand.
 */
export async function runOfflineDirector(
  prisma: PrismaClient,
  gateway: Gateway,
  clock: Clock,
  opts: OfflineDirectorOptions = {},
): Promise<OfflineDirectorResult> {
  const deps: Deps = { prisma, gateway, clock };
  const personas = opts.personaId
    ? await prisma.persona.findMany({ where: { id: opts.personaId } })
    : await prisma.persona.findMany({ orderBy: { createdAt: "desc" }, take: opts.limit ?? DEFAULT_LIMIT });

  const generated: DigestSummary[] = [];
  let skipped = 0;
  for (const persona of personas) {
    const summary = await generateDigestFor(deps, persona, { force: opts.force ?? false });
    if (summary) generated.push(summary);
    else skipped += 1;
  }
  return { considered: personas.length, generated, skipped };
}
