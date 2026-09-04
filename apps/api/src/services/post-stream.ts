import type { Post, Prisma, PrismaClient, WorldCharacter } from "@prisma/client";
import type { G1Input, G1Output, PostStreamEvent } from "@rpgllm/shared";
import { PACING } from "@rpgllm/shared";
import { postStreamDelayMs } from "../env";
import type { AppState, Deps, Tx } from "../types";
import { logGeneration } from "./generation";
import { heatFor } from "./heat";
import { mediaFor } from "./media";
import { computeMetrics, seedFrom } from "./rng";
import { metricsCausedBy, toApiPost, toApiSnapshot, toApiEvent, type PostRow } from "./serialize";
import { generateEvent, ensureEvent, pendingEvent } from "./events";
import { LIKES_PER_POST, likeText, notify, notifyFollowerMilestones, replyText } from "./notify";
import { currentEnergy, refundEnergy } from "./wallet";
import {
  applyRelationshipDeltas, applyStatDeltas, baseCtx, castCards, characterByHandle, involvedFor,
  parentAuthorHandleOf, personaState, pressAccount, recentFeed, writeMemoryNotes, type StoryContext,
} from "./story";

export type Emit = (ev: PostStreamEvent) => Promise<void>;
const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

async function createPostWithMetrics(
  prisma: PrismaClient | Tx,
  data: Prisma.PostUncheckedCreateInput,
  followers: number,
  extraMetrics: Record<string, unknown> = {},
): Promise<PostRow> {
  const created = await prisma.post.create({ data });
  const metrics = { ...computeMetrics(created.id, followers), ...extraMetrics };
  // Agent K: procedural media (one row in MEDIA_EVERY, deterministic from the id) and the heat
  // score trending ranks on are stamped in the same update as the metrics.
  return await prisma.post.update({
    where: { id: created.id },
    data: {
      metrics: metrics as unknown as Prisma.InputJsonValue,
      ...mediaFor(created.id, created.kind, created.parentId),
      heat: heatFor({ metrics, kind: created.kind, createdAt: created.createdAt, now: created.createdAt }),
    },
    include: { authorCharacter: true },
  });
}

/** The stream already ran for this post when its StatSnapshot exists. */
export const statCause = (postId: string): string => `post:${postId}`;

async function replayStream(deps: Deps, ctx: StoryContext, post: Post, emit: Emit, walletId: string): Promise<void> {
  const replies = await deps.prisma.post.findMany({
    where: { parentId: post.id, kind: "character" },
    orderBy: { createdAt: "asc" },
    include: { authorCharacter: true },
  });
  for (const r of replies) await emit({ type: "reply", post: toApiPost(r, ctx.persona) });

  const newsRows = await deps.prisma.post.findMany({
    where: { personaId: ctx.persona.id, kind: "news" },
    orderBy: { createdAt: "asc" },
    include: { authorCharacter: true },
  });
  const news = newsRows.find((n) => metricsCausedBy(n.metrics) === statCause(post.id));
  if (news) await emit({ type: "news", post: toApiPost(news, ctx.persona) });

  const snapshot = await deps.prisma.statSnapshot.findFirst({ where: { cause: statCause(post.id) } });
  if (snapshot) await emit({ type: "stat", snapshot: toApiSnapshot(snapshot, ctx.persona) });

  const ev = await pendingEvent(deps, ctx.persona.id);
  if (ev) await emit({ type: "event", event: toApiEvent(ev) });

  await emit({ type: "done", energy: await currentEnergy(deps.prisma, walletId) });
}

export async function buildG1InputFor(
  deps: Deps,
  ctx: StoryContext,
  post: Post,
  opts: { k: number; softened: boolean; includeNews: boolean; seedSuffix?: string },
): Promise<G1Input> {
  const parent = post.parentId
    ? await deps.prisma.post.findUnique({ where: { id: post.parentId }, include: { authorCharacter: true } })
    : null;
  const parentAuthorHandle = parentAuthorHandleOf(parent, ctx);
  return {
    ...baseCtx(ctx),
    persona: personaState(ctx),
    cast: castCards(ctx),
    involved: involvedFor(ctx, parentAuthorHandle),
    recentFeed: await recentFeed(deps.prisma, ctx),
    post: { text: post.text, parentAuthorHandle, parentText: parent?.text ?? null },
    k: opts.k,
    softened: opts.softened,
    seed: seedFrom(`${post.id}${opts.seedSuffix ?? ""}`),
    includeNews: opts.includeNews,
  };
}

/** Create the character reply rows for a G1 output. Emits each one when `emit` is supplied. */
export async function materializeReplies(
  deps: Deps,
  ctx: StoryContext,
  post: Post,
  output: G1Output,
  generationId: string,
  emit?: Emit,
): Promise<PostRow[]> {
  const rows: PostRow[] = [];
  const delay = postStreamDelayMs();
  // Only the persona's own post earns reply/like notifications (a character replying to another
  // character is not about you), and only the first pass: `more-replies` re-enters here.
  const notifiesPersona = post.authorPersonaId === ctx.persona.id;
  let likes = await deps.prisma.notification.count({
    where: { personaId: ctx.persona.id, kind: "like", target: `post:${post.id}` },
  });
  for (const [i, reply] of output.replies.entries()) {
    const character: WorldCharacter | undefined =
      characterByHandle(ctx.characters, reply.characterHandle) ?? ctx.characters[i % Math.max(1, ctx.characters.length)];
    if (!character) continue;
    // The reply row and the notifications it causes are written together: a rolled-back reply must
    // never leave a "@x replied to you" row behind (Agent L).
    const row = await deps.prisma.$transaction(async (tx) => {
      const created = await createPostWithMetrics(tx, {
        worldId: ctx.world.id,
        personaId: ctx.persona.id,
        authorCharacterId: character.id,
        kind: "character",
        text: reply.text,
        parentId: post.id,
        generationId,
        createdAt: deps.clock.now(),
        metrics: {},
      }, ctx.persona.followers);
      if (notifiesPersona) {
        await notify(tx, {
          personaId: ctx.persona.id,
          kind: "reply",
          actorId: character.id,
          target: `post:${post.id}`,
          text: replyText(ctx.locale, character.displayName),
          payload: { postId: post.id, replyId: created.id },
          createdAt: deps.clock.now(),
        });
        // The reaction fan-out also "likes" the post — one row per reacting character, capped so a
        // single post can never flood the tab.
        if (likes < LIKES_PER_POST) {
          likes += 1;
          await notify(tx, {
            personaId: ctx.persona.id,
            kind: "like",
            actorId: character.id,
            target: `post:${post.id}`,
            text: likeText(ctx.locale, character.displayName),
            payload: { postId: post.id },
            createdAt: deps.clock.now(),
          });
        }
      }
      return created;
    });
    rows.push(row);
    if (emit) {
      await emit({ type: "reply", post: toApiPost(row, ctx.persona) });
      if (i < output.replies.length - 1) await sleep(delay);
    }
  }
  return rows;
}

/**
 * The `/v1/posts/:id/stream` body (SCR-010 / AIF-009).
 * Order: [fallback?] → reply × k → news? → stat → event? → done.
 * Idempotent: a second GET replays what exists instead of regenerating.
 */
export async function runPostStream(
  deps: Deps,
  state: AppState,
  ctx: StoryContext,
  post: Post,
  walletId: string,
  emit: Emit,
): Promise<void> {
  const already = await deps.prisma.statSnapshot.findFirst({ where: { cause: statCause(post.id) } });
  if (already) return await replayStream(deps, ctx, post, emit, walletId);

  const softened = state.softenedPosts.get(post.id) ?? false;
  const includeNews = ctx.persona.actionCount % 3 === 0;
  const input = await buildG1InputFor(deps, ctx, post, { k: PACING.K_INITIAL, softened, includeNews });
  const result = await deps.gateway.g1(input);
  const generationId = await logGeneration(deps.prisma, result.meta, ctx.user.id);

  if (result.meta.fallback) {
    await refundEnergy(deps.prisma, walletId, post.id);
    await emit({ type: "fallback", message: "The world is quiet right now — that one was on us." });
  }

  await materializeReplies(deps, ctx, post, result.output, generationId, emit);

  if (result.output.news) {
    const press = pressAccount(ctx.characters);
    if (press) {
      const newsRow = await createPostWithMetrics(deps.prisma, {
        worldId: ctx.world.id,
        personaId: ctx.persona.id,
        authorCharacterId: press.id,
        kind: "news",
        text: result.output.news.text,
        generationId,
        createdAt: deps.clock.now(),
        metrics: {},
      }, ctx.persona.followers, { causedBy: statCause(post.id) });
      await emit({ type: "news", post: toApiPost(newsRow, ctx.persona) });
    }
  }

  const applied = applyStatDeltas(ctx.persona, result.output.stat_deltas);
  const snapshot = await deps.prisma.$transaction(async (tx) => {
    await tx.persona.update({
      where: { id: ctx.persona.id },
      data: { followers: applied.followers, aura: applied.aura, humor: applied.humor, xp: applied.xp, level: applied.level },
    });
    const relDeltas = await applyRelationshipDeltas(tx, ctx, result.output.relationship_deltas);
    await writeMemoryNotes(tx, ctx, result.output.memory_notes, statCause(post.id));
    await notifyFollowerMilestones(tx, {
      personaId: ctx.persona.id,
      locale: ctx.locale,
      before: ctx.persona.followers,
      after: applied.followers,
    });
    return await tx.statSnapshot.create({
      data: {
        personaId: ctx.persona.id,
        cause: statCause(post.id),
        narrative: result.output.narrative,
        followersDelta: applied.followersDelta,
        auraDelta: applied.auraDelta,
        humorDelta: applied.humorDelta,
        relDeltas: {
          deltas: relDeltas,
          after: { followers: applied.followers, aura: applied.aura, humor: applied.humor },
        } as unknown as Prisma.InputJsonValue,
      },
    });
  });

  ctx.persona.followers = applied.followers;
  ctx.persona.aura = applied.aura;
  ctx.persona.humor = applied.humor;
  ctx.persona.xp = applied.xp;
  ctx.persona.level = applied.level;

  await emit({ type: "stat", snapshot: toApiSnapshot(snapshot, ctx.persona) });

  // Drama pacing (build-plan §3): prefetch at actionCount % 8 == 7, surface at % 8 == 0.
  const actionCount = ctx.persona.actionCount;
  if (actionCount % PACING.EVENT_EVERY === PACING.EVENT_PREFETCH_AT) {
    const existing = await pendingEvent(deps, ctx.persona.id);
    if (!existing) await generateEvent(deps, ctx, `prefetch:${actionCount}`);
  }
  if (actionCount > 0 && actionCount % PACING.EVENT_EVERY === 0) {
    const ev = await ensureEvent(deps, ctx);
    if (ev) await emit({ type: "event", event: toApiEvent(ev) });
  }

  await emit({ type: "done", energy: await currentEnergy(deps.prisma, walletId) });
}
