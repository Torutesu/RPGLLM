import type { Event as DramaEvent, Prisma } from "@prisma/client";
import type { G5Input } from "@rpgllm/shared";
import { logGeneration } from "./generation";
import { seedFrom } from "./rng";
import { localized } from "./locale";
import { baseCtx, personaState, type StoryContext } from "./story";
import type { StoredChoice } from "./serialize";
import type { Deps } from "../types";

export const pendingEvent = (deps: Deps, personaId: string): Promise<DramaEvent | null> =>
  deps.prisma.event.findFirst({ where: { personaId, resolvedAt: null }, orderBy: { createdAt: "desc" } });

async function buildG5Input(deps: Deps, ctx: StoryContext, seedKey: string): Promise<G5Input> {
  const [snapshots, past] = await Promise.all([
    deps.prisma.statSnapshot.findMany({ where: { personaId: ctx.persona.id }, orderBy: { createdAt: "desc" }, take: 5 }),
    deps.prisma.event.findMany({ where: { personaId: ctx.persona.id }, select: { title: true } }),
  ]);
  const byId = new Map(ctx.characters.map((c) => [c.id, c]));
  return {
    ...baseCtx(ctx),
    persona: personaState(ctx),
    relationships: ctx.relationships.flatMap((r) => {
      const ch = byId.get(r.characterId);
      return ch ? [{ handle: ch.handle, affinity: r.affinity, summary: r.summary, isFollower: r.isFollower }] : [];
    }),
    recentSnapshots: snapshots.map((s) => ({
      narrative: s.narrative, followersDelta: s.followersDelta, auraDelta: s.auraDelta, humorDelta: s.humorDelta,
    })),
    pastEventTitles: past.map((p) => p.title),
    seed: seedFrom(seedKey),
  };
}

/** Preset event drawn from the world seed (AIF-011 fallback). */
function presetEvent(ctx: StoryContext, usedTitles: Set<string>): { title: string; prompt: string; choices: StoredChoice[] } | null {
  const presets = ctx.seed?.presetEvents ?? [];
  for (const preset of presets) {
    const title = localized(preset.title, ctx.locale);
    if (usedTitles.has(title)) continue;
    return {
      title,
      prompt: localized(preset.prompt, ctx.locale),
      choices: preset.choices.map((c, i) => ({
        id: `c${i + 1}`,
        label: localized(c.label, ctx.locale),
        outcomeText: localized(c.outcomeText, ctx.locale),
        statDeltas: c.statDeltas,
        relationshipDeltas: {},
        newsText: null,
      })),
    };
  }
  return null;
}

/**
 * Generate + persist the next drama event (AIF-011 / G5).
 * `cause` distinguishes the prefetch (actionCount % 8 == 7) from an on-demand creation.
 */
export async function generateEvent(deps: Deps, ctx: StoryContext, cause: string): Promise<DramaEvent | null> {
  const input = await buildG5Input(deps, ctx, `${ctx.persona.id}:${cause}`);
  const result = await deps.gateway.g5(input);
  const generationId = await logGeneration(deps.prisma, result.meta, ctx.user.id);
  const usedTitles = new Set(input.pastEventTitles);

  let title = result.output.title;
  let prompt = result.output.prompt;
  let choices: StoredChoice[] = result.output.choices.map((c, i) => ({
    id: c.id && c.id.length > 0 ? c.id : `c${i + 1}`,
    label: c.label,
    outcomeText: c.outcomeText,
    statDeltas: c.statDeltas,
    relationshipDeltas: c.relationshipDeltas,
    newsText: c.newsText,
  }));

  if (result.meta.fallback || usedTitles.has(title)) {
    const preset = presetEvent(ctx, usedTitles);
    if (preset) {
      title = preset.title;
      prompt = preset.prompt;
      choices = preset.choices;
    } else if (usedTitles.has(title)) {
      title = `${title} (${usedTitles.size + 1})`;
    }
  }

  return await deps.prisma.event.create({
    data: {
      personaId: ctx.persona.id,
      title,
      prompt,
      choices: choices as unknown as Prisma.InputJsonValue,
      generationId,
    },
  });
}

/** Returns the unresolved event for this persona, generating one on the spot if the prefetch missed. */
export async function ensureEvent(deps: Deps, ctx: StoryContext): Promise<DramaEvent | null> {
  const existing = await pendingEvent(deps, ctx.persona.id);
  if (existing) return existing;
  return await generateEvent(deps, ctx, `event:${ctx.persona.actionCount}`);
}
