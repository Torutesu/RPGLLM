import type { PrismaClient } from "@prisma/client";
import { Hono } from "hono";
import { requireAuth } from "../auth";
import { notFound, ok } from "../http";
import { consolidatePersona } from "../jobs/memory-consolidate";
import { personaFor } from "../services/digest";
import { atHandle, normHandle } from "../services/handles";
import type { AppEnv } from "../types";

/**
 * SCR-039 — the Relationship Memory Ledger ("Receipts", S2-3 / AIF-002).
 *
 * Every note carries the text that produced it, resolved from its `sourceRef`
 * (`post:<id>` / `dm:<id>`). When the source is gone the note stays and `quote` is null —
 * the character still remembers, the receipt is just no longer on file.
 */
const QUOTE_MAX = 280;

async function quoteFor(prisma: PrismaClient, sourceRef: string): Promise<string | null> {
  const [kind, id] = sourceRef.split(":");
  if (!id) return null;
  if (kind === "post") {
    const row = await prisma.post.findUnique({ where: { id }, select: { text: true } });
    return row ? row.text.slice(0, QUOTE_MAX) : null;
  }
  if (kind === "dm") {
    const row = await prisma.dMMessage.findUnique({ where: { id }, select: { text: true } });
    return row ? row.text.slice(0, QUOTE_MAX) : null;
  }
  return null;
}

export function memoryRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /** `:characterId` accepts the character id or its handle (SCR-039 is linked by handle). */
  app.get("/:characterId", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const persona = await personaFor(deps.prisma, user.id, c.req.query("personaId"));
    if (!persona) return notFound("Persona");

    const key = c.req.param("characterId");
    const characters = await deps.prisma.worldCharacter.findMany({ where: { worldId: persona.worldId } });
    const character = characters.find((ch) => ch.id === key) ?? characters.find((ch) => normHandle(ch.handle) === normHandle(key));
    if (!character) return notFound("Character");

    const relationship = await deps.prisma.relationshipState.findUnique({
      where: { personaId_characterId: { personaId: persona.id, characterId: character.id } },
    });
    if (!relationship) return notFound("Relationship");

    // Opportunistic G7 (no scheduler in this build): folds the backlog before it is displayed,
    // so the summary the ledger shows is the one the generators will send next.
    await consolidatePersona(deps, persona);

    const [fresh, entries] = await Promise.all([
      deps.prisma.relationshipState.findUnique({ where: { id: relationship.id } }),
      deps.prisma.memoryEntry.findMany({ where: { relationshipId: relationship.id }, orderBy: { createdAt: "desc" }, take: 100 }),
    ]);

    const memories = [];
    for (const entry of entries) {
      memories.push({
        id: entry.id,
        note: entry.note,
        sourceRef: entry.sourceRef,
        quote: await quoteFor(deps.prisma, entry.sourceRef),
        consolidated: entry.consolidated,
        createdAt: entry.createdAt.toISOString(),
      });
    }

    return ok({
      character: { handle: atHandle(character.handle), displayName: character.displayName, avatarUrl: character.avatarUrl },
      affinity: fresh?.affinity ?? relationship.affinity,
      summary: fresh?.summary ?? relationship.summary,
      memories,
    });
  });

  return app;
}
