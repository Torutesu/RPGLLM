import { Hono } from "hono";
import { requireAuth } from "../auth";
import { notFound, ok } from "../http";
import { sameHandle } from "../services/handles";
import { localized, type LocaleKey } from "../services/locale";
import { toApiCharacter, toApiWorld } from "../services/serialize";
import { getWorldSeed } from "../services/world-seeds";
import type { AppEnv } from "../types";

export function worldRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", requireAuth, async (c) => {
    const deps = c.get("deps");
    const locale = c.get("user").locale as LocaleKey;
    const worlds = await deps.prisma.world.findMany({ orderBy: { createdAt: "asc" } });
    return ok(worlds.map((w) => toApiWorld(w, locale)));
  });

  app.get("/:id", requireAuth, async (c) => {
    const deps = c.get("deps");
    const locale = c.get("user").locale as LocaleKey;
    const id = c.req.param("id");
    const world = await deps.prisma.world.findFirst({ where: { OR: [{ id }, { slug: id }] } });
    if (!world) return notFound("World");
    const characters = await deps.prisma.worldCharacter.findMany({ where: { worldId: world.id }, orderBy: { handle: "asc" } });
    const seed = await getWorldSeed(world.slug);
    return ok({
      world: toApiWorld(world, locale),
      characters: characters.map((ch) => {
        const seeded = seed?.cast.find((s) => sameHandle(s.handle, ch.handle));
        return toApiCharacter(ch, locale, seeded ? localized(seeded.intro, locale) : undefined);
      }),
      presetPersonas: (seed?.presetPersonas ?? []).map((p) => ({
        handle: p.handle,
        displayName: localized(p.displayName, locale),
        bio: localized(p.bio, locale),
        avatarUrl: null,
      })),
    });
  });

  return app;
}
