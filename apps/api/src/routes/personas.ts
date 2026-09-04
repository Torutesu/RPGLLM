import { Hono } from "hono";
import { CreatePersonaReqZ, HandleCheckReqZ } from "@rpgllm/shared";
import { requireAuth } from "../auth";
import { fail, notFound, ok, parseBody, parseQuery } from "../http";
import { normHandle } from "../services/handles";
import { createPersonaWithFeed } from "../services/persona";
import { toApiPersona } from "../services/serialize";
import type { AppEnv } from "../types";

export function personaRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/check", requireAuth, async (c) => {
    const q = parseQuery({ worldId: c.req.query("worldId"), handle: c.req.query("handle") }, HandleCheckReqZ);
    if (!q.ok) return q.res;
    const deps = c.get("deps");
    const taken = await deps.prisma.persona.findUnique({
      where: { worldId_handle: { worldId: q.value.worldId, handle: normHandle(q.value.handle) } },
    });
    return ok({ available: !taken });
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
