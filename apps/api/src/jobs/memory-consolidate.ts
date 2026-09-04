import type { MemoryEntry, Persona, PrismaClient, RelationshipState } from "@prisma/client";
import type { Gateway } from "@rpgllm/llm";
import { PACING, type G7Input } from "@rpgllm/shared";
import type { Clock } from "../clock";
import { logGeneration } from "../services/generation";
import { normHandle, sameHandle } from "../services/handles";
import { baseCtx, loadStoryContext, personaState } from "../services/story";
import type { Deps } from "../types";

/**
 * S2-3 — G7 memory consolidation.
 *
 * The gap analysis' actual bug: **G7 was never called from anywhere**, so `MemoryEntry` grew
 * forever and `RelationshipState.summary` stayed empty — the prompt context that G1/G4/G5 read
 * ("what this character remembers") was permanently blank.
 *
 * A relationship is consolidated once it has `PACING.MEMORY_CONSOLIDATE_AT` unconsolidated notes.
 * The notes are not deleted: the ledger (SCR-039) still shows them with their receipts, they are
 * just marked `consolidated` and folded into the ≤150-token summary the generators send.
 *
 * Runnable without a scheduler: `POST /v1/__test/run-job {"job":"memory"}` and opportunistically
 * at the end of `GET /v1/memory/:characterId`.
 */
export interface MemoryConsolidateOptions {
  personaId?: string;
  /** override `PACING.MEMORY_CONSOLIDATE_AT` (never below 1) */
  minNotes?: number;
  limit?: number;
}

export interface MemoryConsolidateResult {
  personas: number;
  relationships: number;
  notes: number;
}

const DEFAULT_LIMIT = 25;
/** How many notes one G7 call folds per relationship (cost-architecture §3: G7 is a compressor). */
const MAX_NOTES_PER_RELATIONSHIP = 50;

interface Pending {
  relationship: RelationshipState;
  handle: string;
  notes: MemoryEntry[];
}

/** Relationships of this persona that have enough unconsolidated notes to be worth folding. */
export async function pendingConsolidations(
  prisma: PrismaClient,
  personaId: string,
  characters: { id: string; handle: string }[],
  minNotes: number,
): Promise<Pending[]> {
  const relationships = await prisma.relationshipState.findMany({ where: { personaId } });
  const out: Pending[] = [];
  for (const relationship of relationships) {
    const notes = await prisma.memoryEntry.findMany({
      where: { relationshipId: relationship.id, consolidated: false },
      orderBy: { createdAt: "asc" },
      take: MAX_NOTES_PER_RELATIONSHIP,
    });
    if (notes.length < minNotes) continue;
    const character = characters.find((c) => c.id === relationship.characterId);
    if (!character) continue;
    out.push({ relationship, handle: normHandle(character.handle), notes });
  }
  return out;
}

export async function consolidatePersona(
  deps: Deps,
  persona: Persona,
  opts: { minNotes?: number } = {},
): Promise<{ relationships: number; notes: number }> {
  const minNotes = Math.max(1, opts.minNotes ?? PACING.MEMORY_CONSOLIDATE_AT);
  const user = await deps.prisma.user.findUnique({ where: { id: persona.userId } });
  if (!user || user.deletedAt) return { relationships: 0, notes: 0 };
  const ctx = await loadStoryContext(deps.prisma, user, persona.id);
  if (!ctx) return { relationships: 0, notes: 0 };

  const pending = await pendingConsolidations(deps.prisma, persona.id, ctx.characters, minNotes);
  if (pending.length === 0) return { relationships: 0, notes: 0 };

  const input: G7Input = {
    ...baseCtx(ctx),
    persona: personaState(ctx),
    relationships: pending.map((p) => ({
      handle: p.handle,
      affinity: p.relationship.affinity,
      oldSummary: p.relationship.summary,
      notes: p.notes.map((n) => n.note),
    })),
  };
  const result = await deps.gateway.g7(input);
  await logGeneration(deps.prisma, result.meta, user.id);
  // A fallback keeps the old summaries; leave the notes unconsolidated so the next run retries.
  if (result.meta.fallback) return { relationships: 0, notes: 0 };

  let notes = 0;
  for (const p of pending) {
    const summary = result.output.relationships.find((r) => sameHandle(r.handle, p.handle))?.summary;
    if (summary !== undefined) {
      await deps.prisma.relationshipState.update({ where: { id: p.relationship.id }, data: { summary } });
    }
    const ids = p.notes.map((n) => n.id);
    await deps.prisma.memoryEntry.updateMany({ where: { id: { in: ids } }, data: { consolidated: true } });
    notes += ids.length;
  }
  await deps.prisma.persona.update({ where: { id: persona.id }, data: { worldSummary: result.output.worldSummary } });

  return { relationships: pending.length, notes };
}

export async function runMemoryConsolidation(
  prisma: PrismaClient,
  gateway: Gateway,
  clock: Clock,
  opts: MemoryConsolidateOptions = {},
): Promise<MemoryConsolidateResult> {
  const deps: Deps = { prisma, gateway, clock };
  const personas = opts.personaId
    ? await prisma.persona.findMany({ where: { id: opts.personaId } })
    : await prisma.persona.findMany({ orderBy: { createdAt: "desc" }, take: opts.limit ?? DEFAULT_LIMIT });

  const result: MemoryConsolidateResult = { personas: 0, relationships: 0, notes: 0 };
  for (const persona of personas) {
    const one = await consolidatePersona(deps, persona, { minNotes: opts.minNotes });
    if (one.relationships > 0) result.personas += 1;
    result.relationships += one.relationships;
    result.notes += one.notes;
  }
  return result;
}
