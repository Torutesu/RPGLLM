import { Hono } from "hono";
import { requireAuth } from "../auth";
import { notFound, ok } from "../http";
import { blockedCharacterIds } from "../services/moderation";
import { trendingFor } from "../services/trending";
import type { AppEnv } from "../types";

/** SCR-046 — what the world is talking about, who is moving toward you, and where you rank. */
export function trendingRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const personaId = c.req.query("personaId");
    const persona = personaId
      ? await deps.prisma.persona.findUnique({ where: { id: personaId } })
      : await deps.prisma.persona.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
    if (!persona || persona.userId !== user.id) return notFound("Persona");

    // S1-2: a blocked character never trends, never rises, and their posts never seed a topic.
    const blocked = await blockedCharacterIds(deps.prisma, persona.id);
    return ok(await trendingFor(deps.prisma, persona, deps.clock.now(), blocked));
  });

  return app;
}
