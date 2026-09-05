import { createHash } from "node:crypto";
import {
  LOCALES,
  type GenerationMeta,
  type GenerationResult,
  type Locale,
  type ModelTier,
  type Usage,
  type WorldSeed,
} from "@rpgllm/shared";
import type { GeneratorSpec } from "../../types.js";
import { assembleWorld, deterministicWorld, type G9Parts } from "./assemble.js";
import {
  g9Bible,
  g9Card,
  g9CastEvents,
  g9Concept,
  g9Texture,
  replayG9Bible,
  replayG9Card,
  replayG9CastEvents,
  replayG9Concept,
  replayG9Texture,
  stageSeed,
} from "./stages.js";
import {
  G9_VARIANT_IDS,
  type G9BibleOutput,
  type G9CardOutput,
  type G9Concept,
  type G9Input,
  type G9TextureOutput,
} from "./types.js";

/**
 * G9 — the orchestrator (AIF-003).
 *
 * Fourteen calls in five stages, in dependency order:
 *
 *   1  concept     high   — premise -> title, tone, platform, places, factions, slang, 8 accounts
 *   2  bible x2    high   — one call per locale, written natively
 *   8  cards x8    mid    — one per character, both locales, fanned out concurrently
 *   1  castevents  mid    — 7 preset personas + 5 events x 3 choices
 *   2  texture x2  light  — 22 ambient + 5 fallback lines/handle + welcome posts, per locale
 *
 * Every one of them is an ordinary gateway call, so every one lands in `GenerationLog` with its
 * own four token counts and cost. The `meta` returned here is the **aggregate** and is deliberately
 * not emitted again: summing it into the log as a fifteenth row would double-count the spend.
 *
 * Stages after the concept share one per-world cached prefix (concept + bible prose), so the
 * eleven mid/light calls are one cache write and ten cache reads.
 */

export type G9StageRunner = <TIn, TOut>(args: {
  spec: GeneratorSpec<TIn, TOut>;
  variantId: string;
  tier: ModelTier;
  maxTokens: number;
  input: TIn;
  replay: (input: TIn) => TOut;
  seed: number;
}) => Promise<GenerationResult<TOut>>;

function sumUsage(metas: readonly GenerationMeta[]): Usage {
  return metas.reduce<Usage>(
    (acc, m) => ({
      inputTokens: acc.inputTokens + m.usage.inputTokens,
      cacheWriteTokens: acc.cacheWriteTokens + m.usage.cacheWriteTokens,
      cacheReadTokens: acc.cacheReadTokens + m.usage.cacheReadTokens,
      outputTokens: acc.outputTokens + m.usage.outputTokens,
    }),
    { inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
  );
}

function emptyLocaleRecord<T>(make: (locale: Locale) => T): Record<Locale, T> {
  const out = {} as Record<Locale, T>;
  for (const locale of LOCALES) out[locale] = make(locale);
  return out;
}

/**
 * The stages that decide whether this is the player's world at all.
 *
 * `meta.fallback` is not a quality score — apps/api refunds 120 gems on it and fails the build.
 * So it means *irrecoverable*: the concept (the world's identity, the only stage that reads the
 * premise) or the bible (the cached prefix every later generation inherits) came from the template
 * instead of the model, or the parts would not assemble into a valid seed. A cast card, an event
 * set or an ambient pool falling back leaves a complete, coherent, playable world — the blueprint
 * writes those in the concept's own nouns and handles — so it dents quality without voiding the
 * purchase. Every stage still logs its own `fallback` flag, so the dashboard sees what the
 * aggregate deliberately forgives.
 */
const CRITICAL_STAGES: ReadonlySet<string> = new Set([
  G9_VARIANT_IDS.concept,
  G9_VARIANT_IDS.bible,
]);

/** The aggregate row: summed spend, wall-clock latency, fallback only when the world is not theirs. */
export function aggregateMeta(
  metas: readonly GenerationMeta[],
  startedAt: number,
  escalatedFrom: string | null,
  assembledCleanly: boolean,
): GenerationMeta {
  const usage = sumUsage(metas);
  const costUsd = Math.round(metas.reduce((sum, m) => sum + m.costUsd, 0) * 1e9) / 1e9;
  const criticalFailures = metas.filter((m) => m.fallback && CRITICAL_STAGES.has(m.variantId));
  const fallback = criticalFailures.length > 0 || !assembledCleanly;
  const allReplay = metas.length > 0 && metas.every((m) => m.stopReason === "replay");
  const stopReason = !assembledCleanly
    ? "invalid_json"
    : criticalFailures.length > 0
      ? (criticalFailures[0]?.stopReason ?? "error")
      : allReplay
        ? "replay"
        : "end_turn";

  return {
    generator: "G9",
    variantId: "G9@v1",
    model: metas[0]?.model ?? "replay",
    tier: "high",
    promptHash: createHash("sha256")
      .update(metas.map((m) => m.promptHash).join("|"), "utf8")
      .digest("hex"),
    usage,
    costUsd,
    ttftMs: metas[0]?.ttftMs ?? null,
    latencyMs: Date.now() - startedAt,
    stopReason,
    fallback,
    escalatedFrom,
  };
}

/**
 * Run the studio. `runStage` is supplied by the gateway (it owns mode, logging, pricing and the
 * replay clock); this function owns the dependency graph and the assembly.
 */
export async function runG9(
  base: G9Input,
  runStage: G9StageRunner,
  escalatedFrom: string | null = null,
): Promise<GenerationResult<WorldSeed>> {
  const startedAt = Date.now();
  const metas: GenerationMeta[] = [];
  const take = <T>(res: GenerationResult<T>): T => {
    metas.push(res.meta);
    return res.output;
  };

  // 1 — concept (high). The only call that sees the premise.
  const concept: G9Concept = take(
    await runStage({
      spec: g9Concept,
      variantId: G9_VARIANT_IDS.concept,
      tier: g9Concept.defaultTier,
      maxTokens: g9Concept.maxTokens,
      input: { base },
      replay: replayG9Concept,
      seed: stageSeed(base, "concept"),
    }),
  );

  // 2 — bible prose, one call per locale (high).
  const bibleResults = await Promise.all(
    LOCALES.map((locale) =>
      runStage({
        spec: g9Bible,
        variantId: G9_VARIANT_IDS.bible,
        tier: g9Bible.defaultTier,
        maxTokens: g9Bible.maxTokens,
        input: { base, concept, locale },
        replay: replayG9Bible,
        seed: stageSeed(base, `bible-${locale}`),
      }),
    ),
  );
  const bible = {} as Record<Locale, G9BibleOutput>;
  LOCALES.forEach((locale, i) => {
    const res = bibleResults[i];
    bible[locale] = res === undefined ? { prose: "", outro: "" } : take(res);
  });
  const prose = emptyLocaleRecord((locale) => bible[locale].prose);

  // 3 — cast cards, fanned out one per character (mid). Same prefix on all eight.
  const cardResults = await Promise.all(
    concept.cast.map((member) =>
      runStage({
        spec: g9Card,
        variantId: G9_VARIANT_IDS.cards,
        tier: g9Card.defaultTier,
        maxTokens: g9Card.maxTokens,
        input: { base, concept, prose, handle: member.handle },
        replay: replayG9Card,
        seed: stageSeed(base, `card-${member.handle}`),
      }),
    ),
  );
  const cards: Record<string, G9CardOutput> = {};
  concept.cast.forEach((member, i) => {
    const res = cardResults[i];
    if (res !== undefined) cards[member.handle] = take(res);
  });

  // 4 — preset personas and events (mid).
  const castEvents = take(
    await runStage({
      spec: g9CastEvents,
      variantId: G9_VARIANT_IDS.castevents,
      tier: g9CastEvents.defaultTier,
      maxTokens: g9CastEvents.maxTokens,
      input: { base, concept, prose },
      replay: replayG9CastEvents,
      seed: stageSeed(base, "castevents"),
    }),
  );

  // 5 — ambient, fallback replies and welcome posts, one call per locale (light).
  const textureResults = await Promise.all(
    LOCALES.map((locale) =>
      runStage({
        spec: g9Texture,
        variantId: G9_VARIANT_IDS.texture,
        tier: g9Texture.defaultTier,
        maxTokens: g9Texture.maxTokens,
        input: { base, concept, prose, locale },
        replay: replayG9Texture,
        seed: stageSeed(base, `texture-${locale}`),
      }),
    ),
  );
  const texture = {} as Record<Locale, G9TextureOutput>;
  LOCALES.forEach((locale, i) => {
    const res = textureResults[i];
    texture[locale] =
      res === undefined
        ? { ambient: [], fallbackReplies: {}, welcomePosts: {} }
        : take(res);
  });

  const parts: G9Parts = { base, concept, bible, cards, castEvents, texture };
  let assembled: { seed: WorldSeed; valid: boolean };
  try {
    assembled = assembleWorld(parts);
  } catch {
    assembled = { seed: deterministicWorld(base), valid: false };
  }

  return {
    output: assembled.seed,
    meta: aggregateMeta(metas, startedAt, escalatedFrom, assembled.valid),
  };
}
