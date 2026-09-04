import { Hono } from "hono";
import { requireAuth } from "../auth";
import { notFound, ok } from "../http";
import { toApiSnapshot } from "../services/serialize";
import type { AppEnv } from "../types";

export function statRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/:snapshotId", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const snapshot = await deps.prisma.statSnapshot.findUnique({ where: { id: c.req.param("snapshotId") } });
    if (!snapshot) return notFound("Snapshot");
    const persona = await deps.prisma.persona.findUnique({ where: { id: snapshot.personaId } });
    if (!persona || persona.userId !== user.id) return notFound("Snapshot");
    return ok({
      snapshot: toApiSnapshot(snapshot, persona),
      persona: { followers: persona.followers, aura: persona.aura, humor: persona.humor },
    });
  });

  return app;
}
