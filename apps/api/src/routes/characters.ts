import { Hono } from "hono";
import { requireAuth } from "../auth";
import { notFound, ok } from "../http";
import { sameHandle } from "../services/handles";
import { localized, type LocaleKey } from "../services/locale";
import { toApiCharacter, toApiPost } from "../services/serialize";
import type { AppEnv } from "../types";

const POSTS = 20;

/**
 * `WorldCharacter.card` is a *prompt*, not a bio: it opens with a "Voice:" label and closes with an
 * "NG:" line of things the model must never do. Neither belongs on a profile — the reader wants to
 * know who this person is, not how the generator is steered. Everything else is kept verbatim.
 */
export function bioFrom(card: string): string {
  const sentences = card
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?。！？])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^(NG|禁止)\s*[:：]/i.test(s));
  const text = sentences.join(" ").replace(/^(Voice|口調)\s*[:：]\s*/i, "").trim();
  if (text.length === 0) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * SCR-047 — a character's own page. Everything the world knows about them and everything they
 * know about you: their bio, whether they follow you back, the affinity bar, how many memories
 * they are carrying, and what they have been posting in your feed.
 */
export function characterRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/:handle", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const personaId = c.req.query("personaId");
    const persona = personaId
      ? await deps.prisma.persona.findUnique({ where: { id: personaId } })
      : await deps.prisma.persona.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
    if (!persona || persona.userId !== user.id) return notFound("Persona");

    const raw = decodeURIComponent(c.req.param("handle"));
    // Reachable by handle (how the feed links) or by id (how the cast list links). The cast is a
    // handful of rows, and `WorldCharacter.handle` is stored with a leading "@" while the API emits
    // it bare — so the match runs through `sameHandle` rather than a WHERE on an exact string.
    const cast = await deps.prisma.worldCharacter.findMany({ where: { worldId: persona.worldId } });
    const character = cast.find((ch) => sameHandle(ch.handle, raw)) ?? cast.find((ch) => ch.id === raw);
    if (!character) return notFound("Character");

    const locale = user.locale as LocaleKey;
    const [relationship, posts, blocked] = await Promise.all([
      deps.prisma.relationshipState.findUnique({
        where: { personaId_characterId: { personaId: persona.id, characterId: character.id } },
        include: { _count: { select: { memories: true } } },
      }),
      deps.prisma.post.findMany({
        where: { personaId: persona.id, authorCharacterId: character.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: POSTS,
        include: { authorCharacter: true },
      }),
      deps.prisma.blockedCharacter.findUnique({
        where: { personaId_characterId: { personaId: persona.id, characterId: character.id } },
      }),
    ]);

    return ok({
      character: toApiCharacter(character, locale),
      bio: bioFrom(localized(character.card, locale)),
      relationship: {
        affinity: relationship?.affinity ?? 0,
        summary: relationship?.summary ?? "",
        isFollower: relationship?.isFollower ?? false,
        memoryCount: relationship?._count.memories ?? 0,
      },
      // A blocked character keeps their page (that is how you unblock them) but not their posts.
      posts: blocked ? [] : posts.map((p) => toApiPost(p, persona)),
      blocked: blocked !== null,
    });
  });

  return app;
}
