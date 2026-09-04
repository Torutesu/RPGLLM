import { Hono } from "hono";
import { requireAuth } from "../auth";
import { notFound, ok } from "../http";
import { pendingEvent } from "../services/events";
import { toApiEvent, toApiPost, toApiSnapshot } from "../services/serialize";
import type { AppEnv } from "../types";

const PAGE = 20;

export function feedRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const personaId = c.req.query("personaId");
    const persona = personaId
      ? await deps.prisma.persona.findUnique({ where: { id: personaId } })
      : await deps.prisma.persona.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
    if (!persona || persona.userId !== user.id) return notFound("Persona");

    const cursor = c.req.query("cursor");
    const rows = await deps.prisma.post.findMany({
      where: { personaId: persona.id, parentId: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { authorCharacter: true },
    });

    const replies = rows.length
      ? await deps.prisma.post.findMany({
        where: { parentId: { in: rows.map((r) => r.id) }, kind: "character" },
        orderBy: { createdAt: "asc" },
        include: { authorCharacter: true },
      })
      : [];
    const byParent = new Map<string, typeof replies>();
    for (const r of replies) {
      if (!r.parentId) continue;
      const list = byParent.get(r.parentId) ?? [];
      if (list.length < 2) list.push(r);
      byParent.set(r.parentId, list);
    }

    const [event, snapshot] = await Promise.all([
      pendingEvent(deps, persona.id),
      deps.prisma.statSnapshot.findFirst({ where: { personaId: persona.id }, orderBy: { createdAt: "desc" } }),
    ]);

    return ok({
      posts: rows.map((r) => toApiPost(r, persona, (byParent.get(r.id) ?? []).map((x) => toApiPost(x, persona)))),
      nextCursor: rows.length === PAGE ? (rows[rows.length - 1]?.id ?? null) : null,
      pendingEvent: event ? toApiEvent(event) : null,
      lastSnapshot: snapshot ? toApiSnapshot(snapshot, persona) : null,
    });
  });

  return app;
}
