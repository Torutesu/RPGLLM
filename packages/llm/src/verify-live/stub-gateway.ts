import {
  LOCALES,
  type GenerationMeta,
  type GenerationResult,
  type GeneratorId,
  type Locale,
  type ModelTier,
  type Usage,
  type WorldSeed,
} from "@rpgllm/shared";
import { mintCastHandles } from "../cast-handles.js";
import { priceOf } from "../cost.js";
import { modelForTier } from "../experiments.js";
import { createGateway, type BatchItem, type BatchResults, type Gateway, type G9RunOptions } from "../gateway.js";
import { deterministicWorld } from "../generators/g9/assemble.js";
import { premiseKeywords } from "../generators/g9/blueprint.js";
import { G9_VARIANT_IDS, type G9Input } from "../generators/g9/types.js";
import { scoreCandidateOffline, type GJInput, type GJOutput } from "../generators/gj.js";
import { bareHandle } from "../handles.js";
import { estimateTokens, fnv1a, pick } from "../tokens.js";

/**
 * A stand-in for the live gateway, so the harness is not executed for the first time on the
 * morning somebody is paying for it.
 *
 * What it is: the deterministic blueprint world, put through the transformation a *good* live run
 * would make — handles and display names derived from the premise, most bible lines rewritten,
 * per-character traits and verbal tics — and returned with **live-shaped metas**: real model ids,
 * `stop_reason: end_turn`, four token counts, prices from `PRICING`. That is enough for every
 * measurement, every rollup, every threshold and every failure path in the report to execute.
 *
 * What it is not, and what the report says on its face: evidence about a model. The stub is
 * written to pass, so a green stub report proves the harness works and proves nothing whatsoever
 * about Claude's Japanese, or about whether two premises really diverge. Only a key can do that.
 */

export interface StubGatewayOptions {
  onGeneration?: (meta: GenerationMeta & { userId: string | null; generator: GeneratorId }) => void;
  /** world slugs whose build should come back as a refusal (fallback world, `meta.fallback`) */
  refuseSlugs?: readonly string[];
  /** world slugs whose build never resolves — the harness's per-case timeout must catch it */
  hangSlugs?: readonly string[];
  /** world slugs where one non-critical stage falls back (a dented world, not a lost one) */
  degradeSlugs?: readonly string[];
  /** 0..1: how much of the blueprint bible a premise rewrites. 0 reproduces the template. */
  authorship?: number;
}

/* ------------------------------------------------------------- the transform ---- */

const TRAITS_EN: readonly string[] = [
  "keeps every receipt",
  "answers at three in the morning",
  "never posts twice about the same night",
  "quotes the rules back at people",
  "counts in public",
  "apologises in the replies and not the post",
  "types in one long breath",
  "will not use the word everyone else is using",
];
const TRAITS_JA: readonly string[] = [
  "証拠のスクショだけは必ず残す",
  "深夜三時にだけ本音を書く",
  "同じ夜のことは二度書かない",
  "規約を引用してから怒る",
  "数字を人前で数える",
  "本文では謝らず返信でだけ謝る",
  "句読点を打たずに一息で書く",
  "みんなが使っている言葉だけは使わない",
];
const TICS_EN: readonly string[] = [
  "ok so.",
  "listen —",
  "genuinely,",
  "for the record:",
  "hm.",
  "right, so",
  "look.",
  "fine:",
];
const TICS_JA: readonly string[] = [
  "まあ、",
  "というか、",
  "正直、",
  "記録として:",
  "ふーん。",
  "つまり、",
  "ねえ、",
  "了解。",
];

function keywordStem(input: G9Input, i: number): string {
  const kw = premiseKeywords(input.premise);
  const pool = kw.en.length > 0 ? kw.en : input.slug.split(/[^a-z0-9]+/i).filter((w) => w.length >= 3);
  const word = pool[i % Math.max(pool.length, 1)] ?? "acct";
  return `${word.toLowerCase().replace(/[^a-z0-9]/g, "")}${i}`.slice(0, 15);
}

/** Rewrite `@old` mentions everywhere, then the structural handle fields and record keys. */
function renameHandles(world: WorldSeed, moves: ReadonlyMap<string, string>): WorldSeed {
  if (moves.size === 0) return world;
  const alternation = [...moves.keys()].sort((a, b) => b.length - a.length).join("|");
  const rewritten = JSON.stringify(world).replace(
    new RegExp(`@(${alternation})(?![a-z0-9_])`, "g"),
    (whole, name: string) => (moves.has(name) ? `@${moves.get(name) ?? name}` : whole),
  );
  const next = JSON.parse(rewritten) as WorldSeed;
  const to = (h: string): string => moves.get(bareHandle(h)) ?? h;

  next.cast = next.cast.map((c) => ({ ...c, handle: to(c.handle), avatarKey: `${to(c.handle)}-av` }));
  for (const locale of LOCALES) {
    const pool = next.ambientPool[locale];
    if (pool !== undefined) next.ambientPool[locale] = pool.map((p) => ({ ...p, handle: to(p.handle) }));
  }
  next.fallbackReplies = Object.fromEntries(Object.entries(next.fallbackReplies).map(([h, v]) => [to(h), v]));
  next.welcomePosts = Object.fromEntries(Object.entries(next.welcomePosts).map(([h, v]) => [to(h), v]));
  return next;
}

/** Rewrite a share of the bible's long lines so two premises stop sharing their sentences. */
function authorBible(text: string, input: G9Input, share: number, locale: Locale): string {
  const kw = premiseKeywords(input.premise);
  // A slug would read as scaffolding leaking into the world; the genre is the honest fallback
  // when a premise has no keyword in this alphabet (a JA premise has no Latin words).
  const token = (locale === "ja" ? kw.ja[0] : kw.en[0]) ?? kw.en[0] ?? kw.ja[0] ?? input.genre;
  return text
    .split("\n")
    .map((line) => {
      if (line.trim().length < 40) return line;
      if ((fnv1a(`${input.slug}|${line}`) % 100) / 100 >= share) return line;
      return locale === "ja" ? `${token}のこと。${line}` : `On ${token}: ${line}`;
    })
    .join("\n");
}

/**
 * The blueprint world as a plausible live one. Deterministic in `(slug, premise, seed)`, so the
 * stub's own numbers are reproducible and a test can assert them.
 */
export function stubLiveWorld(input: G9Input, authorship = 0.75): WorldSeed {
  const base = deterministicWorld(input);
  const mint = mintCastHandles({
    candidates: base.cast.map((_, i) => keywordStem(input, i)),
    seed: `${input.slug}|stub`,
  });
  const moves = new Map<string, string>();
  base.cast.forEach((c, i) => {
    const to = mint.handles[i];
    if (to !== undefined && to !== c.handle) moves.set(c.handle, to);
  });
  const world = renameHandles(base, moves);
  const kw = premiseKeywords(input.premise);
  const nameToken = (kw.en[0] ?? input.slug.split("-")[0] ?? "the").replace(/[^a-z0-9]/gi, "");

  world.title = {
    en: `${nameToken} ${world.title.en ?? ""}`.trim(),
    ja: `${kw.ja[0] ?? nameToken}${world.title.ja ?? ""}`,
  };
  for (const locale of LOCALES) {
    world.bible[locale] = authorBible(world.bible[locale] ?? "", input, authorship, locale);
  }

  world.cast = world.cast.map((c, i) => {
    const traitEn = TRAITS_EN[i % TRAITS_EN.length] ?? "";
    const traitJa = TRAITS_JA[i % TRAITS_JA.length] ?? "";
    return {
      ...c,
      displayName: `${nameToken.slice(0, 6)}${i} ${c.displayName}`.slice(0, 40),
      card: {
        en: `${c.card.en ?? ""} ${traitEn}. ${nameToken}.`,
        ja: `${c.card.ja ?? ""} ${traitJa}。`,
      },
      intro: {
        en: `${TICS_EN[i % TICS_EN.length] ?? ""} ${c.intro.en ?? ""}`,
        ja: `${TICS_JA[i % TICS_JA.length] ?? ""}${c.intro.ja ?? ""}`,
      },
    };
  });

  // Give each account a voice: the lines a player actually reads must not be interchangeable.
  world.cast.forEach((c, i) => {
    const ticEn = TICS_EN[i % TICS_EN.length] ?? "";
    const ticJa = TICS_JA[i % TICS_JA.length] ?? "";
    const traitEn = TRAITS_EN[i % TRAITS_EN.length] ?? "";
    const traitJa = TRAITS_JA[i % TRAITS_JA.length] ?? "";
    const lines = world.fallbackReplies[c.handle];
    if (lines !== undefined) {
      lines.en = (lines.en ?? []).map((l) => `${ticEn} ${l} ${traitEn}`);
      lines.ja = (lines.ja ?? []).map((l) => `${ticJa}${l}${traitJa}`);
    }
    const welcome = world.welcomePosts[c.handle];
    if (welcome !== undefined) {
      welcome.en = `${ticEn} ${welcome.en ?? ""} ${traitEn}`;
      welcome.ja = `${ticJa}${welcome.ja ?? ""}${traitJa}`;
    }
    for (const locale of LOCALES) {
      const pool = world.ambientPool[locale] ?? [];
      world.ambientPool[locale] = pool.map((p) =>
        p.handle === c.handle ? { ...p, text: `${locale === "ja" ? ticJa : `${ticEn} `}${p.text}`.slice(0, 280) } : p,
      );
    }
  });

  return world;
}

/* ------------------------------------------------------------- live-shaped metas ---- */

interface StageShape {
  variantId: string;
  tier: ModelTier;
  inputTokens: number;
  cacheWrite: number;
  cacheRead: number;
  outputTokens: number;
}

const PREFIX_TOKENS = 4400; // the concept + bible prefix stages 3..5 share (cost-architecture 3.1)

function localeText(rec: Partial<Record<Locale, string>>): string {
  return LOCALES.map((l) => rec[l] ?? "").join("\n");
}

/**
 * The fourteen calls a world costs, sized from the artifacts they produced. One cache write for
 * the shared prefix and ten reads, which is the shape the studio was designed around.
 */
function stageShapes(world: WorldSeed): StageShape[] {
  const out: StageShape[] = [];
  const conceptOut = estimateTokens(
    JSON.stringify({
      title: world.title,
      scenario: world.scenario,
      cast: world.cast.map((c) => ({ h: c.handle, n: c.displayName, r: c.role, i: c.intro })),
    }),
  );
  out.push({
    variantId: G9_VARIANT_IDS.concept,
    tier: "high",
    inputTokens: 1400,
    cacheWrite: 1800,
    cacheRead: 0,
    outputTokens: conceptOut,
  });
  LOCALES.forEach((locale, i) => {
    // `world.bible` is the *assembled* text — prose + the eight cast cards + outro. The bible
    // stage only writes the prose and the outro, so the cards are subtracted rather than billed
    // twice (they are billed by the card stage below).
    const cards = world.cast.reduce((n, c) => n + estimateTokens(c.card[locale] ?? ""), 0);
    out.push({
      variantId: G9_VARIANT_IDS.bible,
      tier: "high",
      inputTokens: 320,
      cacheWrite: i === 0 ? PREFIX_TOKENS : 0,
      cacheRead: i === 0 ? 0 : PREFIX_TOKENS,
      outputTokens: Math.max(200, estimateTokens(world.bible[locale] ?? "") - cards),
    });
  });
  for (const c of world.cast) {
    out.push({
      variantId: G9_VARIANT_IDS.cards,
      tier: "mid",
      inputTokens: 180,
      cacheWrite: 0,
      cacheRead: PREFIX_TOKENS,
      outputTokens: estimateTokens(localeText(c.card) + localeText(c.intro)),
    });
  }
  out.push({
    variantId: G9_VARIANT_IDS.castevents,
    tier: "mid",
    inputTokens: 260,
    cacheWrite: 0,
    cacheRead: PREFIX_TOKENS,
    outputTokens: estimateTokens(JSON.stringify({ p: world.presetPersonas, e: world.presetEvents })),
  });
  for (const locale of LOCALES) {
    out.push({
      variantId: G9_VARIANT_IDS.texture,
      tier: "light",
      inputTokens: 240,
      cacheWrite: 0,
      cacheRead: PREFIX_TOKENS,
      outputTokens: estimateTokens(
        JSON.stringify({
          a: world.ambientPool[locale],
          f: Object.values(world.fallbackReplies).map((v) => v[locale]),
          w: Object.values(world.welcomePosts).map((v) => v[locale]),
        }),
      ),
    });
  }
  return out;
}

function metaOf(shape: StageShape, seed: number, degrade: boolean): GenerationMeta {
  const model = modelForTier(shape.tier);
  const usage: Usage = {
    inputTokens: shape.inputTokens,
    cacheWriteTokens: shape.cacheWrite,
    cacheReadTokens: shape.cacheRead,
    outputTokens: shape.outputTokens,
  };
  return {
    generator: "G9",
    variantId: shape.variantId,
    model,
    tier: shape.tier,
    promptHash: fnv1a(`${shape.variantId}|${seed}`).toString(16).padStart(8, "0").repeat(8),
    usage,
    costUsd: priceOf(model, usage),
    ttftMs: 400 + pick(600, seed, shape.variantId),
    latencyMs: 1800 + pick(4000, seed, shape.variantId),
    stopReason: degrade ? "invalid_json" : "end_turn",
    fallback: degrade,
    escalatedFrom: null,
  };
}

/* ------------------------------------------------------------------- gateway ---- */

const never = new Promise<never>(() => {
  /* a call that never returns — the timeout path */
});

export function createStubLiveGateway(opts: StubGatewayOptions = {}): Gateway {
  const inner = createGateway({ mode: "replay" });
  const refuse = new Set(opts.refuseSlugs ?? []);
  const hang = new Set(opts.hangSlugs ?? []);
  const degrade = new Set(opts.degradeSlugs ?? []);
  const emit = (meta: GenerationMeta): void => {
    opts.onGeneration?.({ ...meta, userId: null, generator: "G9" });
  };

  async function g9(input: G9Input, runOpts?: G9RunOptions): Promise<GenerationResult<WorldSeed>> {
    if (hang.has(input.slug)) return never;
    const refused = refuse.has(input.slug);
    const dented = degrade.has(input.slug);
    const world = refused ? deterministicWorld(input) : stubLiveWorld(input, opts.authorship);

    const shapes = stageShapes(world);
    const metas = shapes.map((shape, i) =>
      metaOf(
        shape,
        input.seed + i,
        // A refusal takes the concept with it; a dent is one cast card.
        (refused && shape.variantId === G9_VARIANT_IDS.concept) ||
          (dented && shape.variantId === G9_VARIANT_IDS.cards && i === 4),
      ),
    );
    if (refused) {
      const first = metas[0];
      if (first !== undefined) first.stopReason = "refusal";
    }
    for (const m of metas) emit(m);

    const usage: Usage = metas.reduce<Usage>(
      (acc, m) => ({
        inputTokens: acc.inputTokens + m.usage.inputTokens,
        cacheWriteTokens: acc.cacheWriteTokens + m.usage.cacheWriteTokens,
        cacheReadTokens: acc.cacheReadTokens + m.usage.cacheReadTokens,
        outputTokens: acc.outputTokens + m.usage.outputTokens,
      }),
      { inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
    );
    return {
      output: world,
      meta: {
        generator: "G9",
        variantId: runOpts?.variantId ?? "G9@v1",
        model: modelForTier("high"),
        tier: "high",
        promptHash: metas[0]?.promptHash ?? "",
        usage,
        costUsd: metas.reduce((s, m) => s + m.costUsd, 0),
        ttftMs: metas[0]?.ttftMs ?? null,
        latencyMs: metas.reduce((s, m) => s + m.latencyMs, 0),
        stopReason: refused ? "refusal" : "end_turn",
        fallback: refused,
        escalatedFrom: null,
      },
    };
  }

  /** The judge, live-shaped: the deterministic rubric with Opus-5 metas and Opus-5 prices. */
  async function batchGJ(items: ReadonlyArray<BatchItem<GJInput>>): Promise<BatchResults<GJOutput>> {
    const out: BatchResults<GJOutput> = new Map();
    for (const item of items) {
      const output = scoreCandidateOffline(item.input);
      const model = modelForTier("high");
      const usage: Usage = {
        inputTokens: estimateTokens(item.input.context + item.input.candidate),
        cacheWriteTokens: 0,
        cacheReadTokens: 900,
        outputTokens: estimateTokens(JSON.stringify(output)),
      };
      const meta: GenerationMeta = {
        generator: "GJ",
        variantId: "GJ@v1",
        model,
        tier: "high",
        promptHash: fnv1a(item.customId).toString(16).padStart(8, "0").repeat(8),
        usage,
        costUsd: priceOf(model, usage, { batch: true }),
        ttftMs: null,
        latencyMs: 2400,
        stopReason: "batch:end_turn",
        fallback: false,
        escalatedFrom: null,
      };
      opts.onGeneration?.({ ...meta, userId: null, generator: "GJ" });
      out.set(item.customId, { customId: item.customId, status: "succeeded", output, meta });
    }
    return out;
  }

  return { ...inner, g9, batchGJ };
}
