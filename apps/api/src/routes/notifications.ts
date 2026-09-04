import { Hono } from "hono";
import { MarkNotificationsReadReqZ } from "@rpgllm/shared";
import { requireAuth } from "../auth";
import { notFound, ok, parseBody } from "../http";
import { personaFor } from "../services/digest";
import { atHandle } from "../services/handles";
import type { AppEnv } from "../types";

const PAGE = 30;

/**
 * SCR-042 — notifications.
 *
 * `text` was rendered in the persona's locale when the row was written (services/notify.ts), so the
 * list is one indexed query plus the actor join. Paging is id-cursored like `/v1/dms`.
 */
export function notificationRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const persona = await personaFor(deps.prisma, user.id, c.req.query("personaId"));
    if (!persona) return notFound("Persona");

    const cursor = c.req.query("cursor");
    const rows = await deps.prisma.notification.findMany({
      where: { personaId: persona.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { actor: { select: { handle: true, displayName: true, avatarUrl: true } } },
    });
    const unread = await deps.prisma.notification.count({ where: { personaId: persona.id, readAt: null } });

    return ok({
      notifications: rows.map((n) => ({
        id: n.id,
        kind: n.kind,
        text: n.text,
        target: n.target,
        actor: n.actor
          ? { handle: atHandle(n.actor.handle), displayName: n.actor.displayName, avatarUrl: n.actor.avatarUrl }
          : null,
        payload: (n.payload ?? {}) as Record<string, unknown>,
        readAt: n.readAt ? n.readAt.toISOString() : null,
        createdAt: n.createdAt.toISOString(),
      })),
      unread,
      nextCursor: rows.length === PAGE ? (rows[rows.length - 1]?.id ?? null) : null,
    });
  });

  /** `{ids: null}` means "all" — the badge has to be clearable in one tap. */
  app.post("/read", requireAuth, async (c) => {
    const body = await parseBody(c.req, MarkNotificationsReadReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const user = c.get("user");
    const persona = await personaFor(deps.prisma, user.id, c.req.query("personaId"));
    if (!persona) return notFound("Persona");

    const ids = body.value.ids;
    await deps.prisma.notification.updateMany({
      where: { personaId: persona.id, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
      data: { readAt: deps.clock.now() },
    });
    const unread = await deps.prisma.notification.count({ where: { personaId: persona.id, readAt: null } });
    return ok({ unread });
  });

  return app;
}
