import { Hono } from "hono";
import { CreatePersonaReqZ, HandleCheckReqZ } from "@rpgllm/shared";
import { requireAuth } from "../auth";
import { fail, notFound, ok, parseBody, parseQuery } from "../http";
import { resolveHandle } from "../services/persona-handle";
import { createPersonaWithFeed } from "../services/persona";
import { toApiPersona } from "../services/serialize";
import type { AppEnv } from "../types";

export function personaRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /**
   * SCR-006's live check. "Available" means *available to you*: another player's `@rina` in the same
   * world is somebody this account will never see, so it is not a reason to refuse the name
   * (`services/persona-handle.ts`). The two answers that still mean no are the world's own cast —
   * two `@rina` in one feed make reply targeting ambiguous — and a handle this player already has.
   */
  app.get("/check", requireAuth, async (c) => {
    const q = parseQuery({ worldId: c.req.query("worldId"), handle: c.req.query("handle") }, HandleCheckReqZ);
    if (!q.ok) return q.res;
    const deps = c.get("deps");
    const user = c.get("user");
    const claim = await resolveHandle(deps.prisma, q.value.worldId, user.id, q.value.handle);
    return ok({ available: claim.state === "free" });
  });

  app.post("/", requireAuth, async (c) => {
    const body = await parseBody(c.req, CreatePersonaReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const state = c.get("state");
    const user = c.get("user");

    // Idempotency: the client retries SCR-006 with the same key after a timeout.
    const known = state.personaIdempotency.get(`${user.id}:${body.value.idempotencyKey}`);
    if (known) {
      const persona = await deps.prisma.persona.findUnique({ where: { id: known }, include: { world: true } });
      if (persona) return ok({ persona: toApiPersona(persona, persona.world.slug), feedReady: true });
    }

    const result = await createPersonaWithFeed(deps, user, body.value);
    if (!result.ok) {
      if (result.code === "HANDLE_TAKEN") return fail("HANDLE_TAKEN", result.message, 409);
      return notFound("World");
    }
    state.personaIdempotency.set(`${user.id}:${body.value.idempotencyKey}`, result.persona.id);
    const world = await deps.prisma.world.findUniqueOrThrow({ where: { id: result.persona.worldId } });
    return ok({ persona: toApiPersona(result.persona, world.slug), feedReady: result.feedReady }, 201);
  });

  return app;
}
