import { Hono } from "hono";
import { requireAuth } from "../auth";
import { notFound, ok } from "../http";
import { personaFor } from "../services/digest";
import { ensureMomentsFor, toApiMoment } from "../services/moment";
import { buildReel } from "../services/reel";
import type { AppEnv } from "../types";

const PAGE = 20;

/**
 * SCR-040 — Shareable Moment (S2-4 / AIF-005).
 *
 * `GET /v1/moments/:slug` is **public on purpose**: it is the share target, so a link posted to
 * TikTok/X has to render for someone with no account. It exposes only what the card shows
 * (headline, narrative, stat deltas, up to 3 character reactions) — no user id, no email.
 */
export function momentRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const persona = await personaFor(deps.prisma, user.id, c.req.query("personaId"));
    if (!persona) return notFound("Persona");

    // No scheduler: the read materialises any qualifying swing that has no card yet.
    await ensureMomentsFor(deps.prisma, persona);
    const rows = await deps.prisma.moment.findMany({
      where: { personaId: persona.id },
      orderBy: { createdAt: "desc" },
      take: PAGE,
    });
    return ok({ moments: rows.map(toApiMoment) });
  });

  /** Public share target — no auth. */
  app.get("/:slug", async (c) => {
    const deps = c.get("deps");
    const row = await deps.prisma.moment.findUnique({ where: { shareSlug: c.req.param("slug") } });
    if (!row) return notFound("Moment");
    return ok({ moment: toApiMoment(row) });
  });

  /**
   * The reel (gtm.md §4) — the same moment as a timeline, **public for the same reason the card
   * is**: it is the share target. A still cannot carry the turn, so this is what a TikTok/Shorts
   * recording is made from, and the server owns the timing so that every viewer sees the same cut
   * and a recording can never drift from the animation. See `services/reel.ts` for what earns a
   * beat, how it is paced, and why it is deterministic.
   */
  app.get("/:slug/reel", async (c) => {
    const deps = c.get("deps");
    const row = await deps.prisma.moment.findUnique({ where: { shareSlug: c.req.param("slug") } });
    if (!row) return notFound("Moment");
    const reel = await buildReel(deps.prisma, row);
    if (!reel) return notFound("Moment");
    return ok(reel);
  });

  return app;
}
