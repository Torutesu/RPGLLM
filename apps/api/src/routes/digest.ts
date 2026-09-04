import { Hono } from "hono";
import { requireAuth } from "../auth";
import { notFound, ok } from "../http";
import { newestUnseenDigest, personaFor, toApiDigest } from "../services/digest";
import { generateDigestFor } from "../jobs/offline-director";
import type { AppEnv } from "../types";

/**
 * SCR-038 — "While you were away" (S2-1 / AIF-001).
 *
 * The read is also the trigger: with no scheduler in this build, `GET /v1/digest` generates the
 * digest on demand when the away window is met and nothing unseen is waiting. That keeps the
 * feature working from a cold start (a cron would simply have got there first).
 */
export function digestRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const persona = await personaFor(deps.prisma, user.id, c.req.query("personaId"));
    if (!persona) return notFound("Persona");

    const existing = await newestUnseenDigest(deps.prisma, persona.id);
    if (existing) return ok({ digest: toApiDigest(existing) });

    // Opportunistic AIF-001 run. Costs no energy — the user did not act.
    const generated = await generateDigestFor(deps, persona);
    if (!generated) return ok({ digest: null });
    const row = await deps.prisma.digest.findUnique({ where: { id: generated.digestId } });
    return ok({ digest: row ? toApiDigest(row) : null });
  });

  app.post("/:id/seen", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const row = await deps.prisma.digest.findUnique({ where: { id: c.req.param("id") }, include: { persona: true } });
    if (!row || row.persona.userId !== user.id) return notFound("Digest");
    const seenAt = row.seenAt ?? deps.clock.now();
    if (!row.seenAt) await deps.prisma.digest.update({ where: { id: row.id }, data: { seenAt } });
    return ok({ seenAt: seenAt.toISOString() });
  });

  return app;
}
