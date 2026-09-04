import { Hono } from "hono";
import { ACHIEVEMENTS, MarkAchievementsSeenReqZ } from "@rpgllm/shared";
import { requireAuth } from "../auth";
import { notFound, ok, parseBody } from "../http";
import { achievementDescription, achievementTitle, evaluate, progressFor } from "../services/achievements";
import { personaFor } from "../services/digest";
import type { LocaleKey } from "../services/locale";
import type { AppEnv } from "../types";

/**
 * SCR-044 — achievements.
 *
 * The read re-evaluates first, so a player who crossed a threshold through a path that does not
 * spend energy (a follower milestone from an offline beat, say) still sees the tile flip.
 */
export function achievementRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const persona = await personaFor(deps.prisma, user.id, c.req.query("personaId"));
    if (!persona) return notFound("Persona");
    const locale = user.locale as LocaleKey;

    const evaluated = await evaluate(deps.prisma, persona.id, locale);
    if (!evaluated) return notFound("Persona");

    const unlocks = await deps.prisma.achievementUnlock.findMany({ where: { personaId: persona.id } });
    const byKey = new Map(unlocks.map((u) => [u.key, u]));

    const achievements = ACHIEVEMENTS.map((def) => {
      const row = byKey.get(def.key);
      return {
        key: def.key,
        title: achievementTitle(locale, def.key),
        description: achievementDescription(locale, def.key),
        icon: def.icon,
        tier: def.tier,
        unlockedAt: row ? row.unlockedAt.toISOString() : null,
        seenAt: row?.seenAt ? row.seenAt.toISOString() : null,
        value: row ? row.value : evaluated.metrics[def.metric],
        progress: row ? 1 : progressFor(def, evaluated.metrics),
      };
    });

    return ok({
      achievements,
      unlocked: unlocks.length,
      total: ACHIEVEMENTS.length,
      pending: achievements.filter((a) => a.unlockedAt !== null && a.seenAt === null),
    });
  });

  app.post("/seen", requireAuth, async (c) => {
    const body = await parseBody(c.req, MarkAchievementsSeenReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const user = c.get("user");
    const persona = await personaFor(deps.prisma, user.id, c.req.query("personaId"));
    if (!persona) return notFound("Persona");

    await deps.prisma.achievementUnlock.updateMany({
      where: { personaId: persona.id, key: { in: body.value.keys }, seenAt: null },
      data: { seenAt: deps.clock.now() },
    });
    const pending = await deps.prisma.achievementUnlock.count({ where: { personaId: persona.id, seenAt: null } });
    return ok({ pending });
  });

  return app;
}
