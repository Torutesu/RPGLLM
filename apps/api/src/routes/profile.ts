import { Hono } from "hono";
import { xpForNextLevel } from "@rpgllm/shared";
import { requireAuth } from "../auth";
import { notFound, ok } from "../http";
import { personaFor } from "../services/digest";
import { atHandle } from "../services/handles";
import { toApiPersona, toApiPost, toApiSnapshot } from "../services/serialize";
import type { AppEnv } from "../types";

const POSTS = 20;
const SNAPSHOTS = 10;

/**
 * SCR-026 — profile (S2-6). The one screen where progression is visible: level + XP bar,
 * the persona's own posts, and the cast with affinity and how much each character remembers
 * (the count links into the memory ledger, SCR-039).
 */
export function profileRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const persona = await personaFor(deps.prisma, user.id, c.req.query("personaId"));
    if (!persona) return notFound("Persona");

    const [world, posts, snapshots, relationships, characters] = await Promise.all([
      deps.prisma.world.findUniqueOrThrow({ where: { id: persona.worldId }, select: { slug: true } }),
      deps.prisma.post.findMany({
        where: { personaId: persona.id, authorPersonaId: persona.id },
        orderBy: { createdAt: "desc" },
        take: POSTS,
        include: { authorCharacter: true },
      }),
      deps.prisma.statSnapshot.findMany({ where: { personaId: persona.id }, orderBy: { createdAt: "desc" }, take: SNAPSHOTS }),
      deps.prisma.relationshipState.findMany({ where: { personaId: persona.id } }),
      deps.prisma.worldCharacter.findMany({ where: { worldId: persona.worldId }, orderBy: { handle: "asc" } }),
    ]);

    const counts = await deps.prisma.memoryEntry.groupBy({
      by: ["relationshipId"],
      where: { relationshipId: { in: relationships.map((r) => r.id) } },
      _count: { _all: true },
    });
    const countByRelationship = new Map(counts.map((row) => [row.relationshipId, row._count._all]));
    const byId = new Map(characters.map((ch) => [ch.id, ch]));

    const cast = relationships
      .flatMap((r) => {
        const ch = byId.get(r.characterId);
        return ch
          ? [{
            characterId: ch.id,
            handle: atHandle(ch.handle),
            displayName: ch.displayName,
            avatarUrl: ch.avatarUrl,
            affinity: r.affinity,
            isFollower: r.isFollower,
            memoryCount: countByRelationship.get(r.id) ?? 0,
          }]
          : [];
      })
      .sort((a, b) => Number(b.isFollower) - Number(a.isFollower) || b.affinity - a.affinity || a.handle.localeCompare(b.handle));

    return ok({
      persona: toApiPersona(persona, world.slug),
      levelProgress: { level: persona.level, xp: persona.xp, xpForNext: xpForNextLevel(persona.level) },
      posts: posts.map((p) => toApiPost(p, persona)),
      relationships: cast,
      recentSnapshots: snapshots.map((s) => toApiSnapshot(s, persona)),
    });
  });

  return app;
}
