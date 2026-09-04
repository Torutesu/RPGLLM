import type { MemoryEntry, Persona, PrismaClient, RelationshipState } from "@prisma/client";
import type { BatchItem, Gateway } from "@rpgllm/llm";
import { runMemoryConsolidationBatched } from "@rpgllm/llm";
import { PACING, type G7Input, type G7Output } from "@rpgllm/shared";
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
 * Two paths (cost-architecture §5.4): `runMemoryConsolidationBatchedJob` is what the **scheduler**
 * runs — every persona's folding in **one G7 batch** at half price — while `runMemoryConsolidation`
 * stays interactive for the callers that need an answer now: `GET /v1/memory/:characterId` (which
 * folds opportunistically at the end of the read) and `POST /v1/__test/run-job {"job":"memory"}`.
 * A batch has a 24-hour SLA in live mode, so neither of those may use it.
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


/* ------------------------------------------------------- the batch tier ---- */

interface PreparedConsolidation {
  persona: Persona;
  userId: string;
  pending: Pending[];
  input: G7Input;
}

/** Everything the fold needs for one persona, gathered without calling the model. */
async function prepareConsolidation(
  deps: Deps,
  persona: Persona,
  minNotes: number,
): Promise<PreparedConsolidation | null> {
  const user = await deps.prisma.user.findUnique({ where: { id: persona.userId } });
  if (!user || user.deletedAt) return null;
  const ctx = await loadStoryContext(deps.prisma, user, persona.id);
  if (!ctx) return null;
  const pending = await pendingConsolidations(deps.prisma, persona.id, ctx.characters, minNotes);
  if (pending.length === 0) return null;
  return {
    persona,
    userId: user.id,
    pending,
    input: {
      ...baseCtx(ctx),
      persona: personaState(ctx),
      relationships: pending.map((p) => ({
        handle: p.handle,
        affinity: p.relationship.affinity,
        oldSummary: p.relationship.summary,
        notes: p.notes.map((n) => n.note),
      })),
    },
  };
}

/** Writes one G7 answer back: summaries, the notes it consumed, and the persona's world summary. */
async function applyConsolidation(
  deps: Deps,
  prepared: PreparedConsolidation,
  output: G7Output,
): Promise<{ relationships: number; notes: number }> {
  let notes = 0;
  for (const p of prepared.pending) {
    const summary = output.relationships.find((r) => sameHandle(r.handle, p.handle))?.summary;
    if (summary !== undefined) {
      await deps.prisma.relationshipState.update({ where: { id: p.relationship.id }, data: { summary } });
    }
    const ids = p.notes.map((n) => n.id);
    await deps.prisma.memoryEntry.updateMany({ where: { id: { in: ids } }, data: { consolidated: true } });
    notes += ids.length;
  }
  await deps.prisma.persona.update({ where: { id: prepared.persona.id }, data: { worldSummary: output.worldSummary } });
  return { relationships: prepared.pending.length, notes };
}

/** The scheduled fold: one G7 batch for every persona that has notes to collapse. */
export async function runMemoryConsolidationBatchedJob(
  prisma: PrismaClient,
  gateway: Gateway,
  clock: Clock,
  opts: MemoryConsolidateOptions = {},
): Promise<MemoryConsolidateResult> {
  const deps: Deps = { prisma, gateway, clock };
  const minNotes = Math.max(1, opts.minNotes ?? PACING.MEMORY_CONSOLIDATE_AT);
  const personas = opts.personaId
    ? await prisma.persona.findMany({ where: { id: opts.personaId } })
    : await prisma.persona.findMany({ orderBy: { createdAt: "desc" }, take: opts.limit ?? DEFAULT_LIMIT });

  const prepared = new Map<string, PreparedConsolidation>();
  const items: BatchItem<G7Input>[] = [];
  for (const persona of personas) {
    const one = await prepareConsolidation(deps, persona, minNotes);
    if (!one) continue;
    prepared.set(persona.id, one);
    items.push({ customId: persona.id, input: one.input });
  }

  const result: MemoryConsolidateResult = { personas: 0, relationships: 0, notes: 0 };
  if (items.length === 0) return result;

  const results = await runMemoryConsolidationBatched(gateway, items);
  for (const [personaId, outcome] of results) {
    const one = prepared.get(personaId);
    if (!one) continue;
    await logGeneration(prisma, outcome.meta, one.userId);
    // A fallback keeps the old summaries and leaves the notes unconsolidated, so the next run retries.
    if (outcome.meta.fallback) continue;
    const applied = await applyConsolidation(deps, one, outcome.output);
    if (applied.relationships > 0) result.personas += 1;
    result.relationships += applied.relationships;
    result.notes += applied.notes;
  }
  return result;
}
