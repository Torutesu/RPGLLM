import { Hono } from "hono";
import type { G4Input } from "@rpgllm/shared";
import { RateReqZ } from "@rpgllm/shared";
import { requireAuth } from "../auth";
import { notFound, ok, parseBody } from "../http";
import { escalateTier, logGeneration, tierFromModel } from "../services/generation";
import { sameHandle } from "../services/handles";
import { localized } from "../services/locale";
import { buildG1InputFor } from "../services/post-stream";
import { seedFrom } from "../services/rng";
import { toApiMessage, toApiPost } from "../services/serialize";
import { baseCtx, loadStoryContext, personaState } from "../services/story";
import type { AppEnv } from "../types";

/** Extra 👎 re-rolls allowed when the regenerated line comes back identical. */
const REGEN_ATTEMPTS = 2;

/**
 * SCR-012 / E2E-014. 👎 with regenerate=true re-runs the same generator one tier up
 * (light→mid→high, high stays high) and swaps the text in place.
 *
 * One G1 call produces K replies that share a generationId, so the client may pass
 * `?postId=` (or `?messageId=`) to say which row it rated. Without it the first row wins.
 */
export function generationRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/:id/rate", requireAuth, async (c) => {
    const body = await parseBody(c.req, RateReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const user = c.get("user");
    const id = c.req.param("id");
    const log = await deps.prisma.generationLog.findUnique({ where: { id } });
    if (!log) return notFound("Generation");

    await deps.prisma.rating.create({
      data: { userId: user.id, generationId: id, value: body.value.value, regenerate: body.value.regenerate },
    });
    if (!body.value.regenerate) return ok({ replacement: null, newGenerationId: null });

    const wantedPostId = c.req.query("postId");
    const posts = await deps.prisma.post.findMany({
      where: { generationId: id, kind: { in: ["character", "news"] } },
      orderBy: { createdAt: "asc" },
      include: { authorCharacter: true },
    });
    const target = posts.find((p) => p.id === wantedPostId) ?? posts[0];

    if (target && target.parentId && target.personaId) {
      const parent = await deps.prisma.post.findUnique({ where: { id: target.parentId } });
      const ctx = parent ? await loadStoryContext(deps.prisma, user, target.personaId) : null;
      if (!parent || !ctx) return notFound("Post");
      const tier = escalateTier(tierFromModel(log.model, "mid"));
      const input = await buildG1InputFor(deps, ctx, parent, {
        k: 1, softened: false, includeNews: false, seedSuffix: `:regen:${target.id}`,
      });
      const handle = target.authorCharacter?.handle ?? "";
      const pickReply = (out: { replies: { characterHandle: string; text: string }[] }) =>
        out.replies.find((r) => sameHandle(r.characterHandle, handle)) ?? out.replies[0];

      let result = await deps.gateway.g1(input, { tier, escalatedFrom: id });
      let newGenerationId = await logGeneration(deps.prisma, result.meta, user.id);
      let reply = pickReply(result.output);
      // SCR-012 promises a *different* line: a finite reply pool (and a repetitive model) can
      // redraw the one that was just rejected, so re-roll the seed a couple of times.
      for (let attempt = 1; attempt <= REGEN_ATTEMPTS && reply?.text === target.text; attempt += 1) {
        const retry = { ...input, seed: seedFrom(`${parent.id}:regen:${target.id}:${attempt}`) };
        result = await deps.gateway.g1(retry, { tier, escalatedFrom: id });
        newGenerationId = await logGeneration(deps.prisma, result.meta, user.id);
        reply = pickReply(result.output);
      }

      const updated = await deps.prisma.post.update({
        where: { id: target.id },
        data: { text: reply?.text ?? target.text, generationId: newGenerationId },
        include: { authorCharacter: true },
      });
      return ok({ replacement: toApiPost(updated, ctx.persona), newGenerationId });
    }

    const wantedMessageId = c.req.query("messageId");
    const messages = await deps.prisma.dMMessage.findMany({
      where: { generationId: id, fromCharacter: true },
      orderBy: { createdAt: "asc" },
    });
    const message = messages.find((m) => m.id === wantedMessageId) ?? messages[0];
    if (!message) return notFound("Generation target");

    const thread = await deps.prisma.dMThread.findUnique({ where: { id: message.threadId }, include: { character: true } });
    if (!thread) return notFound("Thread");
    const ctx = await loadStoryContext(deps.prisma, user, thread.personaId);
    if (!ctx) return notFound("Thread");
    const relationship = ctx.relationships.find((r) => r.characterId === thread.characterId);
    const history = await deps.prisma.dMMessage.findMany({ where: { threadId: thread.id }, orderBy: { createdAt: "asc" } });
    const idx = history.findIndex((m) => m.id === message.id);
    const prior = history.slice(0, Math.max(0, idx));
    const lastUser = [...prior].reverse().find((m) => !m.fromCharacter);

    const input: G4Input = {
      ...baseCtx(ctx),
      persona: personaState(ctx),
      character: {
        handle: thread.character.handle, displayName: thread.character.displayName, role: thread.character.role,
        card: localized(thread.character.card, ctx.locale), isPressAccount: thread.character.isPressAccount,
      },
      relationship: {
        handle: thread.character.handle,
        affinity: relationship?.affinity ?? 0,
        summary: relationship?.summary ?? "",
        isFollower: relationship?.isFollower ?? false,
      },
      history: prior.slice(-10).map((m) => ({ fromCharacter: m.fromCharacter, text: m.text })),
      message: lastUser?.text ?? message.text,
      softened: false,
      seed: seedFrom(`regen:${message.id}`),
    };
    const tier = escalateTier(tierFromModel(log.model, "mid"));
    const result = await deps.gateway.g4(input, { tier, escalatedFrom: id });
    const newGenerationId = await logGeneration(deps.prisma, result.meta, user.id);
    const updated = await deps.prisma.dMMessage.update({
      where: { id: message.id },
      data: { text: result.output.bubbles[0] ?? message.text, generationId: newGenerationId },
    });
    return ok({ replacement: toApiMessage(updated), newGenerationId });
  });

  return app;
}
