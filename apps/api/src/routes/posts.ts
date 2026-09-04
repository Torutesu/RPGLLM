import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Prisma } from "@prisma/client";
import { CreatePostReqZ, PACING, type PostStreamEvent } from "@rpgllm/shared";
import { requireAuth } from "../auth";
import { fail, notFound, ok, parseBody } from "../http";
import { logGeneration } from "../services/generation";
import { buildG1InputFor, materializeReplies, runPostStream } from "../services/post-stream";
import { computeMetrics } from "../services/rng";
import { safetyGate } from "../services/safety";
import { toApiPost, type PostRow } from "../services/serialize";
import { loadStoryContext } from "../services/story";
import { EnergyRequiredError, ensureWallet, spendEnergy } from "../services/wallet";
import type { AppEnv } from "../types";

export function postRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/", requireAuth, async (c) => {
    const body = await parseBody(c.req, CreatePostReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const state = c.get("state");
    const user = c.get("user");

    const ctx = await loadStoryContext(deps.prisma, user, body.value.personaId);
    if (!ctx) return notFound("Persona");

    // AIF-013: the gate runs before anything is created and before any energy is spent.
    const gate = await safetyGate(deps, { locale: ctx.locale, isMinor: user.isMinor, text: body.value.text, surface: "post" }, user.id);
    if (gate.verdict === "block") return fail("SAFETY_BLOCKED", "This doesn't fit the world's guidelines.", 422);

    const { wallet } = await ensureWallet(deps.prisma, deps.clock, user.id);

    let created: PostRow;
    try {
      created = await deps.prisma.$transaction(async (tx) => {
        const post = await tx.post.create({
          data: {
            worldId: ctx.world.id,
            personaId: ctx.persona.id,
            authorPersonaId: ctx.persona.id,
            kind: "user",
            text: body.value.text,
            parentId: body.value.parentId,
            // Every Post row is stamped from the injectable clock, so `/__test/time-travel`
            // can never order onboarding posts (which already did) above later ones.
            createdAt: deps.clock.now(),
            metrics: {},
          },
        });
        await spendEnergy(tx, wallet.id, `post:${post.id}`);
        await tx.persona.update({ where: { id: ctx.persona.id }, data: { actionCount: { increment: 1 } } });
        return await tx.post.update({
          where: { id: post.id },
          data: { metrics: computeMetrics(post.id, ctx.persona.followers) as unknown as Prisma.InputJsonValue },
          include: { authorCharacter: true },
        });
      });
    } catch (err) {
      if (err instanceof EnergyRequiredError) return fail("ENERGY_REQUIRED", "Out of energy", 402);
      throw err;
    }

    if (gate.verdict === "soften") state.softenedPosts.set(created.id, true);
    return ok({ post: toApiPost(created, ctx.persona), streamUrl: `/v1/posts/${created.id}/stream` }, 201);
  });

  app.get("/:id/stream", requireAuth, async (c) => {
    const deps = c.get("deps");
    const state = c.get("state");
    const user = c.get("user");
    const post = await deps.prisma.post.findUnique({ where: { id: c.req.param("id") } });
    if (!post || !post.personaId) return notFound("Post");
    const ctx = await loadStoryContext(deps.prisma, user, post.personaId);
    if (!ctx) return notFound("Post");
    const { wallet } = await ensureWallet(deps.prisma, deps.clock, user.id);

    return streamSSE(c, async (stream) => {
      const emit = async (ev: PostStreamEvent) => {
        await stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) });
      };
      try {
        await runPostStream(deps, state, ctx, post, wallet.id, emit);
      } catch (err) {
        console.error("[api] post stream failed", err);
        await stream.writeSSE({ event: "fallback", data: JSON.stringify({ type: "fallback", message: "Something went wrong." }) });
        await stream.writeSSE({ event: "done", data: JSON.stringify({ type: "done", energy: 0 }) });
      } finally {
        state.softenedPosts.delete(post.id);
      }
    });
  });

  app.get("/:id", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const post = await deps.prisma.post.findUnique({ where: { id: c.req.param("id") }, include: { authorCharacter: true } });
    if (!post || !post.personaId) return notFound("Post");
    const persona = await deps.prisma.persona.findUnique({ where: { id: post.personaId } });
    if (!persona || persona.userId !== user.id) return notFound("Post");
    const replies = await deps.prisma.post.findMany({
      where: { parentId: post.id },
      orderBy: { createdAt: "asc" },
      include: { authorCharacter: true },
    });
    const moreDone = (post.metrics as Record<string, unknown> | null)?.["moreDone"] === true;
    return ok({
      post: toApiPost(post, persona),
      replies: replies.map((r) => toApiPost(r, persona)),
      moreAvailable: !moreDone && replies.length > 0,
    });
  });

  /** SCR-012 "Load more reactions": G1 at K_MORE, once per post, no energy cost. */
  app.post("/:id/more-replies", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const post = await deps.prisma.post.findUnique({ where: { id: c.req.param("id") } });
    if (!post || !post.personaId) return notFound("Post");
    const ctx = await loadStoryContext(deps.prisma, user, post.personaId);
    if (!ctx) return notFound("Post");

    const metrics = (post.metrics ?? {}) as Record<string, unknown>;
    if (metrics["moreDone"] === true) return fail("ALREADY_DONE", "More reactions were already generated for this post", 409);

    const input = await buildG1InputFor(deps, ctx, post, { k: PACING.K_MORE, softened: false, includeNews: false, seedSuffix: ":more" });
    const result = await deps.gateway.g1(input);
    const generationId = await logGeneration(deps.prisma, result.meta, user.id);
    const rows = await materializeReplies(deps, ctx, post, result.output, generationId);
    await deps.prisma.post.update({
      where: { id: post.id },
      data: { metrics: { ...metrics, moreDone: true } as unknown as Prisma.InputJsonValue },
    });
    return ok({ replies: rows.map((r) => toApiPost(r, ctx.persona)) });
  });

  return app;
}
