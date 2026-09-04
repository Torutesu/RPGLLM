import type { DMMessage, DMThread, RelationshipState, WorldCharacter } from "@prisma/client";
import type { DMStreamEvent, G4Input } from "@rpgllm/shared";
import { dmStreamDelayMs } from "../env";
import type { AppState, Deps } from "../types";
import { logGeneration } from "./generation";
import { localized } from "./locale";
import { seedFrom } from "./rng";
import { toApiMessage } from "./serialize";
import { baseCtx, personaState, type StoryContext } from "./story";
import { currentEnergy, refundEnergy } from "./wallet";

export type DMEmit = (ev: DMStreamEvent) => Promise<void>;
const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** AIF-010 (G4). Emits `message` per bubble, then `affinity`, then `done`. Idempotent per user turn. */
export async function runDMStream(
  deps: Deps,
  state: AppState,
  ctx: StoryContext,
  thread: DMThread & { character: WorldCharacter },
  relationship: RelationshipState,
  walletId: string,
  emit: DMEmit,
): Promise<void> {
  const history = await deps.prisma.dMMessage.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: "asc" },
  });
  const last = history[history.length - 1];

  // Nothing to answer (or already answered) → replay the trailing character bubbles.
  if (!last || last.fromCharacter) {
    const trailing: DMMessage[] = [];
    for (let i = history.length - 1; i >= 0 && history[i]?.fromCharacter; i--) trailing.unshift(history[i]!);
    for (const m of trailing) await emit({ type: "message", message: toApiMessage(m) });
    await emit({ type: "affinity", delta: 0, affinity: relationship.affinity });
    await emit({ type: "done", energy: await currentEnergy(deps.prisma, walletId) });
    return;
  }

  const softened = state.softenedThreads.get(thread.id) ?? false;
  const priorTurns = history.slice(0, -1).slice(-10);
  const input: G4Input = {
    ...baseCtx(ctx),
    persona: personaState(ctx),
    character: {
      handle: thread.character.handle,
      displayName: thread.character.displayName,
      role: thread.character.role,
      card: localized(thread.character.card, ctx.locale),
      isPressAccount: thread.character.isPressAccount,
    },
    relationship: {
      handle: thread.character.handle,
      affinity: relationship.affinity,
      summary: relationship.summary,
      isFollower: relationship.isFollower,
    },
    history: priorTurns.map((m) => ({ fromCharacter: m.fromCharacter, text: m.text })),
    message: last.text,
    softened,
    seed: seedFrom(last.id),
  };

  const result = await deps.gateway.g4(input);
  const generationId = await logGeneration(deps.prisma, result.meta, ctx.user.id);
  state.softenedThreads.delete(thread.id);

  if (result.meta.fallback) {
    await refundEnergy(deps.prisma, walletId, last.id);
    await emit({ type: "fallback", message: "Message not delivered — we refunded that one." });
  }

  const delay = dmStreamDelayMs();
  for (const [i, bubble] of result.output.bubbles.entries()) {
    const row = await deps.prisma.dMMessage.create({
      data: { threadId: thread.id, fromCharacter: true, text: bubble, generationId },
    });
    await emit({ type: "message", message: toApiMessage(row) });
    if (i < result.output.bubbles.length - 1) await sleep(delay);
  }

  const affinity = clamp(relationship.affinity + result.output.affinity_delta, -100, 100);
  await deps.prisma.relationshipState.update({
    where: { id: relationship.id },
    data: { affinity, isFollower: relationship.isFollower || affinity >= 10 },
  });
  if (result.output.memory_note) {
    await deps.prisma.memoryEntry.create({
      data: { relationshipId: relationship.id, note: result.output.memory_note, sourceRef: `dm:${last.id}` },
    });
  }
  await deps.prisma.dMThread.update({
    where: { id: thread.id },
    data: { lastMessageAt: deps.clock.now(), unreadCount: 0 },
  });

  await emit({ type: "affinity", delta: result.output.affinity_delta, affinity });
  await emit({ type: "done", energy: await currentEnergy(deps.prisma, walletId) });
}
