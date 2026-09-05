import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { CreateThreadReqZ, SendDMReqZ, type DMStreamEvent } from "@rpgllm/shared";
import { requireAuth } from "../auth";
import { fail, notFound, ok, parseBody } from "../http";
import { evaluateQuietly } from "../services/achievements";
import { runDMStream } from "../services/dm-stream";
import { sameHandle } from "../services/handles";
import { localized } from "../services/locale";
import { withoutBlocked } from "../services/moderation";   // Agent G (S1-2)
import { safetyGate } from "../services/safety";
import { toApiCharacter, toApiMessage, toApiThread } from "../services/serialize";
import { loadStoryContext } from "../services/story";
import { EnergyRequiredError, ensureWallet, spendEnergy } from "../services/wallet";
import { getWorldSeed } from "../services/world-seeds";
import type { AppEnv } from "../types";

const PAGE = 50;

export function dmRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /** SCR-020. `followers` powers the "New message" picker. */
  app.get("/", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const personaId = c.req.query("personaId");
    const persona = personaId
      ? await deps.prisma.persona.findUnique({ where: { id: personaId } })
      : await deps.prisma.persona.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
    if (!persona || persona.userId !== user.id) return notFound("Persona");

    const ctx = await loadStoryContext(deps.prisma, user, persona.id);
    if (!ctx) return notFound("Persona");
    const seed = await getWorldSeed(ctx.world.slug, deps.prisma);
    const intro = (handle: string) => {
      const s = seed?.cast.find((x) => sameHandle(x.handle, handle));
      return s ? localized(s.intro, ctx.locale) : undefined;
    };

    const threads = withoutBlocked(await deps.prisma.dMThread.findMany({
      where: { personaId: persona.id },
      orderBy: { lastMessageAt: "desc" },
      include: { character: true, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
    }), ctx.blockedCharacterIds);   // Agent G (S1-2)
    const followerIds = new Set(ctx.relationships.filter((r) => r.isFollower).map((r) => r.characterId));
    return ok({
      threads: threads.map((t) => toApiThread(t, ctx.locale, t.messages[0] ?? null, intro(t.character.handle))),
      followers: ctx.characters.filter((ch) => followerIds.has(ch.id)).map((ch) => toApiCharacter(ch, ctx.locale, intro(ch.handle))),
    });
  });

  app.post("/", requireAuth, async (c) => {
    const body = await parseBody(c.req, CreateThreadReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const user = c.get("user");
    const ctx = await loadStoryContext(deps.prisma, user, body.value.personaId);
    if (!ctx) return notFound("Persona");
    const character = ctx.characters.find((ch) => ch.id === body.value.characterId);
    if (!character) return notFound("Character");

    const thread = await deps.prisma.dMThread.upsert({
      where: { personaId_characterId: { personaId: ctx.persona.id, characterId: character.id } },
      create: { personaId: ctx.persona.id, characterId: character.id, lastMessageAt: deps.clock.now() },
      update: {},
      include: { character: true },
    });
    return ok({ thread: toApiThread(thread, ctx.locale, null) }, 201);
  });

  app.post("/:threadId/messages", requireAuth, async (c) => {
    const body = await parseBody(c.req, SendDMReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const state = c.get("state");
    const user = c.get("user");
    const thread = await deps.prisma.dMThread.findUnique({ where: { id: c.req.param("threadId") }, include: { character: true } });
    if (!thread) return notFound("Thread");
    const ctx = await loadStoryContext(deps.prisma, user, thread.personaId);
    if (!ctx) return notFound("Thread");

    const gate = await safetyGate(deps, { locale: ctx.locale, isMinor: user.isMinor, text: body.value.text, surface: "dm" }, user.id);
    if (gate.verdict === "block") return fail("SAFETY_BLOCKED", "This doesn't fit the world's guidelines.", 422);

    const { wallet } = await ensureWallet(deps.prisma, deps.clock, user.id);
    let message;
    try {
      message = await deps.prisma.$transaction(async (tx) => {
        const row = await tx.dMMessage.create({ data: { threadId: thread.id, fromCharacter: false, text: body.value.text } });
        await spendEnergy(tx, wallet.id, `dm:${row.id}`);
        await tx.persona.update({ where: { id: ctx.persona.id }, data: { actionCount: { increment: 1 } } });
        await tx.dMThread.update({ where: { id: thread.id }, data: { lastMessageAt: deps.clock.now() } });
        return row;
      });
    } catch (err) {
      if (err instanceof EnergyRequiredError) return fail("ENERGY_REQUIRED", "Out of energy", 402);
      throw err;
    }

    if (gate.verdict === "soften") state.softenedThreads.set(thread.id, true);
    await evaluateQuietly(deps.prisma, ctx.persona.id, ctx.locale);
    return ok({ message: toApiMessage(message), streamUrl: `/v1/dms/${thread.id}/stream` }, 201);
  });

  app.get("/:threadId/stream", requireAuth, async (c) => {
    const deps = c.get("deps");
    const state = c.get("state");
    const user = c.get("user");
    const thread = await deps.prisma.dMThread.findUnique({ where: { id: c.req.param("threadId") }, include: { character: true } });
    if (!thread) return notFound("Thread");
    const ctx = await loadStoryContext(deps.prisma, user, thread.personaId);
    if (!ctx) return notFound("Thread");
    const relationship = ctx.relationships.find((r) => r.characterId === thread.characterId);
    if (!relationship) return notFound("Relationship");
    const { wallet } = await ensureWallet(deps.prisma, deps.clock, user.id);

    return streamSSE(c, async (stream) => {
      const emit = async (ev: DMStreamEvent) => {
        await stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) });
      };
      try {
        await runDMStream(deps, state, ctx, thread, relationship, wallet.id, emit);
      } catch (err) {
        console.error("[api] dm stream failed", err);
        await stream.writeSSE({ event: "fallback", data: JSON.stringify({ type: "fallback", message: "Message not sent." }) });
        await stream.writeSSE({ event: "done", data: JSON.stringify({ type: "done", energy: 0 }) });
      }
    });
  });

  app.get("/:threadId", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const thread = await deps.prisma.dMThread.findUnique({ where: { id: c.req.param("threadId") }, include: { character: true } });
    if (!thread) return notFound("Thread");
    const ctx = await loadStoryContext(deps.prisma, user, thread.personaId);
    if (!ctx) return notFound("Thread");
    const relationship = ctx.relationships.find((r) => r.characterId === thread.characterId);

    const cursor = c.req.query("cursor");
    const messages = await deps.prisma.dMMessage.findMany({
      where: { threadId: thread.id },
      orderBy: { createdAt: "asc" },
      take: PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    await deps.prisma.dMThread.update({ where: { id: thread.id }, data: { unreadCount: 0 } });

    return ok({
      thread: toApiThread(thread, ctx.locale, messages[messages.length - 1] ?? null),
      messages: messages.map(toApiMessage),
      relationship: {
        characterHandle: thread.character.handle.replace(/^@+/, ""),
        affinity: relationship?.affinity ?? 0,
        summary: relationship?.summary ?? "",
        isFollower: relationship?.isFollower ?? false,
      },
      nextCursor: messages.length === PAGE ? (messages[messages.length - 1]?.id ?? null) : null,
    });
  });

  return app;
}
