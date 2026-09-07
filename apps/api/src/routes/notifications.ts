import { Hono } from "hono";
import type { Prisma } from "@prisma/client";
import { MarkNotificationsReadReqZ } from "@rpgllm/shared";
import { requireAuth } from "../auth";
import { notFound, ok, parseBody } from "../http";
import { personaFor } from "../services/digest";
import { atHandle } from "../services/handles";
import type { AppEnv } from "../types";

const PAGE = 30;

/**
 * What this inbox contains: the account's own rows always, plus the rows of the persona being
 * shown. Never another persona's — a second world's story is a different inbox.
 */
const inboxWhere = (userId: string, personaId: string | null): Prisma.NotificationWhereInput => ({
  OR: personaId ? [{ personaId }, { userId }] : [{ userId }],
});

/**
 * SCR-042 — notifications.
 *
 * `text` was rendered in the persona's locale when the row was written (services/notify.ts), so the
 * list is one indexed query plus the actor join. Paging is id-cursored like `/v1/dms`.
 *
 * **The inbox is one list made of two scopes.** A row hangs off either a persona (something that
 * happened inside that persona's story) or the account (something that happened to a world it
 * wrote), and both belong in the same tab because they are the same tap for the same person. That
 * is also the fix for the hole this endpoint had: the World Studio is reachable before any persona
 * exists, so a creator with no persona had no inbox at all — `personaFor` returned null and every
 * one of their world's notifications 404'd, if it had been written anywhere in the first place
 * (gtm.md 勝ち筋 A ①, `services/creator-notify.ts`).
 *
 * An explicit `?personaId=` that does not resolve is still a 404: naming a persona that is not
 * yours must never quietly answer with something else.
 */
export function notificationRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const requested = c.req.query("personaId");
    const persona = await personaFor(deps.prisma, user.id, requested);
    if (requested && !persona) return notFound("Persona");
    const inbox = inboxWhere(user.id, persona?.id ?? null);

    const cursor = c.req.query("cursor");
    const rows = await deps.prisma.notification.findMany({
      where: inbox,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { actor: { select: { handle: true, displayName: true, avatarUrl: true } } },
    });
    const unread = await deps.prisma.notification.count({ where: { ...inbox, readAt: null } });

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
    const requested = c.req.query("personaId");
    const persona = await personaFor(deps.prisma, user.id, requested);
    if (requested && !persona) return notFound("Persona");
    const inbox = inboxWhere(user.id, persona?.id ?? null);

    const ids = body.value.ids;
    await deps.prisma.notification.updateMany({
      where: { ...inbox, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
      data: { readAt: deps.clock.now() },
    });
    const unread = await deps.prisma.notification.count({ where: { ...inbox, readAt: null } });
    return ok({ unread });
  });

  return app;
}
