import { LOCALES, type GenerationMeta, type Locale, type Usage, type WorldSeed } from "@rpgllm/shared";
import { round } from "../eval-core.js";
import { cjkRatio, roleOf } from "../eval-g9.js";

/**
 * The measurements the live harness adds on top of the eval gate.
 *
 * The gate answers "does this world pass". This file answers the three questions that are actually
 * open about live output, and it answers them as numbers a person can argue with:
 *
 *   1. is the Japanese native, or is it the English translated (partly measurable, mostly human);
 *   2. do two premises in one genre make two worlds (fully measurable, and the headline);
 *   3. are the eight characters eight people (measurable, on what they say).
 */

/* ------------------------------------------------------------------ overlap ---- */

const CJK_ONLY = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/u;

const EN_STOP = new Set([
  "about", "after", "again", "against", "their", "there", "these", "those", "which", "while",
  "would", "could", "should", "every", "never", "always", "still", "where", "when", "with",
  "your", "yours", "into", "onto", "from", "that", "this", "they", "them", "then", "than",
  "have", "been", "will", "what", "who", "whom", "does", "done", "here", "some", "much",
]);

/** Content words (Latin) or character bigrams (CJK) — one comparable bag either way. */
export function shingles(text: string): Set<string> {
  const trimmed = text.trim();
  if (trimmed.length === 0) return new Set();
  if (CJK_ONLY.test(trimmed) && cjkRatio(trimmed) >= 0.3) {
    const dense = trimmed.replace(/[\s\u3000-\u303f\uff01-\uff65]/gu, "");
    const out = new Set<string>();
    for (let i = 0; i + 2 <= dense.length; i += 1) out.add(dense.slice(i, i + 2));
    return out;
  }
  return new Set(
    trimmed
      .toLowerCase()
      .replace(/[^a-z0-9\s']/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !EN_STOP.has(w)),
  );
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const v of a) if (b.has(v)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 1 : round(shared / union);
}

/** How much two pieces of prose share, in whichever alphabet they are written. */
export function textOverlap(a: string, b: string): number {
  return jaccard(shingles(a), shingles(b));
}

/* ------------------------------------- question 3: are eight characters eight people ---- */

export interface CastPairOverlap {
  a: string;
  b: string;
  /** their cards and intros — how they are *described* */
  card: number;
  /** their fallback lines and welcome post — how they *talk* */
  speech: number;
}

export interface CastDistinctness {
  locale: Locale;
  pairs: CastPairOverlap[];
  meanCard: number;
  maxCard: number;
  meanSpeech: number;
  maxSpeech: number;
  worstPair: string;
  /** distinct role lines / cast size — two "the rival" accounts is the cheap failure */
  distinctRoles: number;
  castSize: number;
}

/**
 * Everything one character says in one locale. Description tells you what the writer intended;
 * speech tells you whether it survived into the text a player actually reads, which is the half
 * that goes wrong — eight distinct biographies whose lines are interchangeable is the exact shape
 * of "a world with labels instead of authors", one level down.
 */
function speechOf(world: WorldSeed, handle: string, locale: Locale): string {
  const lines = world.fallbackReplies[handle]?.[locale] ?? [];
  const welcome = world.welcomePosts[handle]?.[locale] ?? "";
  const ambient = (world.ambientPool[locale] ?? [])
    .filter((a) => a.handle === handle)
    .map((a) => a.text);
  return [...lines, welcome, ...ambient].join("\n");
}

function descriptionOf(world: WorldSeed, member: WorldSeed["cast"][number], locale: Locale): string {
  return [roleOf(member, locale), member.card[locale] ?? "", member.intro[locale] ?? ""].join("\n");
}

export function castDistinctnessOf(world: WorldSeed, locale: Locale): CastDistinctness {
  const pairs: CastPairOverlap[] = [];
  for (let i = 0; i < world.cast.length; i += 1) {
    for (let j = i + 1; j < world.cast.length; j += 1) {
      const a = world.cast[i];
      const b = world.cast[j];
      if (a === undefined || b === undefined) continue;
      pairs.push({
        a: a.handle,
        b: b.handle,
        card: textOverlap(descriptionOf(world, a, locale), descriptionOf(world, b, locale)),
        speech: textOverlap(speechOf(world, a.handle, locale), speechOf(world, b.handle, locale)),
      });
    }
  }
  const cards = pairs.map((p) => p.card);
  const speech = pairs.map((p) => p.speech);
  const mean = (xs: number[]): number => (xs.length === 0 ? 0 : round(xs.reduce((s, x) => s + x, 0) / xs.length));
  const worst = pairs.reduce<CastPairOverlap | undefined>(
    (acc, p) => (acc === undefined || p.card > acc.card ? p : acc),
    undefined,
  );
  const roles = new Set(world.cast.map((c) => roleOf(c, locale).trim().toLowerCase()).filter((r) => r.length > 0));
  return {
    locale,
    pairs,
    meanCard: mean(cards),
    maxCard: cards.length === 0 ? 0 : round(Math.max(...cards)),
    meanSpeech: mean(speech),
    maxSpeech: speech.length === 0 ? 0 : round(Math.max(...speech)),
    worstPair: worst === undefined ? "-" : `@${worst.a} / @${worst.b}`,
    distinctRoles: roles.size,
    castSize: world.cast.length,
  };
}

/**
 * Above this, two characters are one character with two names. Calibrated on the blueprint, which
 * writes every card from the same archetype template and therefore sits high: the harness prints
 * the blueprint's own number next to the live one in the same run, so this constant is a
 * signpost, not the argument.
 */
export const CAST_OVERLAP_LIMIT = 0.35;

/* --------------------------------- question 1: is the Japanese native or translated ---- */

export interface BilingualRow {
  field: string;
  en: string;
  ja: string;
  /** true when the two halves are byte-identical — English that never got written in Japanese */
  identical: boolean;
  jaCjk: number;
}

const BIBLE_WINDOW = 1200;

/**
 * The JA and EN halves of one world, field by field, in reading order — the panel a human scans.
 *
 * Machine checks can prove the JA is dense in kana and is not the EN string. They cannot tell a
 * native sentence from a good translation of an English one, and that distinction is the whole
 * question, so the panel exists to put the pair in front of somebody who can.
 */
export function bilingualPanel(world: WorldSeed): BilingualRow[] {
  const rows: Array<{ field: string; en: string; ja: string }> = [
    { field: "title", en: world.title.en ?? "", ja: world.title.ja ?? "" },
    { field: "scenario", en: world.scenario.en ?? "", ja: world.scenario.ja ?? "" },
    {
      field: "bible (opening)",
      en: (world.bible.en ?? "").slice(0, BIBLE_WINDOW),
      ja: (world.bible.ja ?? "").slice(0, BIBLE_WINDOW),
    },
  ];
  for (const c of world.cast) {
    rows.push({ field: `@${c.handle} — role`, en: roleOf(c, "en"), ja: roleOf(c, "ja") });
    rows.push({ field: `@${c.handle} — card`, en: c.card.en ?? "", ja: c.card.ja ?? "" });
    rows.push({ field: `@${c.handle} — first post`, en: c.intro.en ?? "", ja: c.intro.ja ?? "" });
  }
  for (const e of world.presetEvents.slice(0, 3)) {
    rows.push({ field: "event — title", en: e.title.en ?? "", ja: e.title.ja ?? "" });
    rows.push({ field: "event — prompt", en: e.prompt.en ?? "", ja: e.prompt.ja ?? "" });
    for (const ch of e.choices) {
      rows.push({ field: "event — choice", en: ch.label.en ?? "", ja: ch.label.ja ?? "" });
    }
  }
  // Ambient and fallback lines are pooled per locale, not paired by field, so they are matched by
  // position and labelled as such: a live model may well order them differently.
  const enAmbient = (world.ambientPool.en ?? []).slice(0, 4);
  const jaAmbient = (world.ambientPool.ja ?? []).slice(0, 4);
  for (let i = 0; i < Math.max(enAmbient.length, jaAmbient.length); i += 1) {
    rows.push({
      field: "ambient (positional)",
      en: enAmbient[i]?.text ?? "",
      ja: jaAmbient[i]?.text ?? "",
    });
  }
  return rows
    .filter((r) => r.en.trim().length > 0 || r.ja.trim().length > 0)
    .map((r) => ({ ...r, identical: r.ja.length > 0 && r.ja === r.en, jaCjk: cjkRatio(r.ja) }));
}

/**
 * The tells a human is looking for. Printed in the report next to the panel, because "judge
 * whether this is native Japanese" with no rubric gets a shrug and a tick.
 */
export const JA_HUMAN_CHECKLIST: readonly string[] = [
  "語順が英語のままでないか（「〜することができる」「〜を持っている」の多用は英文和訳の匂い）",
  "主語が省略されるべきところで「彼は」「あなたは」が残っていないか",
  "キャラごとの語尾・一人称が書き分けられているか（全員が同じ丁寧語なら人物ではなく翻訳）",
  "固有名詞・スラングが日本語圏で自然か、英語をカタカナにしただけでないか",
  "改行と句読点のリズムが日本語のSNS投稿として読めるか（280字を英語の一文の直訳で埋めていないか）",
  "EN 側と JA 側が同じ出来事を語っているか（片方だけ具体的なら、もう片方は要約された翻訳）",
];

/* ------------------------------------------------------------------- spend ---- */

export interface StageSpend {
  stage: string;
  calls: number;
  usage: Usage;
  costUsd: number;
  fallbacks: number;
  models: string[];
  meanLatencyMs: number;
}

const EMPTY: Usage = { inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 };

/** Per-stage spend, from the metas the gateway emitted — the billed numbers, not an estimate. */
export function stageSpend(metas: readonly GenerationMeta[]): StageSpend[] {
  const by = new Map<string, StageSpend>();
  for (const m of metas) {
    const row = by.get(m.variantId) ?? {
      stage: m.variantId,
      calls: 0,
      usage: { ...EMPTY },
      costUsd: 0,
      fallbacks: 0,
      models: [],
      meanLatencyMs: 0,
    };
    row.calls += 1;
    row.usage.inputTokens += m.usage.inputTokens;
    row.usage.cacheWriteTokens += m.usage.cacheWriteTokens;
    row.usage.cacheReadTokens += m.usage.cacheReadTokens;
    row.usage.outputTokens += m.usage.outputTokens;
    row.costUsd += m.costUsd;
    row.meanLatencyMs += m.latencyMs;
    if (m.fallback) row.fallbacks += 1;
    if (!row.models.includes(m.model)) row.models.push(m.model);
    by.set(m.variantId, row);
  }
  return [...by.values()]
    .map((r) => ({
      ...r,
      costUsd: round(r.costUsd, 8),
      meanLatencyMs: r.calls === 0 ? 0 : Math.round(r.meanLatencyMs / r.calls),
    }))
    .sort((a, b) => b.costUsd - a.costUsd);
}

export function totalUsage(metas: readonly GenerationMeta[]): Usage {
  return metas.reduce<Usage>(
    (acc, m) => ({
      inputTokens: acc.inputTokens + m.usage.inputTokens,
      cacheWriteTokens: acc.cacheWriteTokens + m.usage.cacheWriteTokens,
      cacheReadTokens: acc.cacheReadTokens + m.usage.cacheReadTokens,
      outputTokens: acc.outputTokens + m.usage.outputTokens,
    }),
    { ...EMPTY },
  );
}

/** Cache reads over everything that could have been a cache read. cost-architecture's headline. */
export function cacheHitRate(usage: Usage): number {
  const cacheable = usage.cacheReadTokens + usage.cacheWriteTokens;
  return cacheable === 0 ? 0 : round(usage.cacheReadTokens / cacheable);
}

/* --------------------------------------------------- is this actually a live run ---- */

export interface LiveEvidence {
  /** every call really went to a model */
  live: boolean;
  calls: number;
  replayCalls: number;
  models: string[];
  reasons: string[];
}

/**
 * The check that makes the report worth reading: a run that claims to be live must have no call
 * that came from the deterministic fixtures. If one did, the report says so at the top rather
 * than quietly averaging replay text into a live quality claim.
 */
export function liveEvidenceOf(metas: readonly GenerationMeta[]): LiveEvidence {
  const replayCalls = metas.filter((m) => m.stopReason === "replay" || m.model === "replay").length;
  const models = [...new Set(metas.map((m) => m.model))].sort();
  const reasons: string[] = [];
  if (metas.length === 0) reasons.push("no generation was logged at all");
  if (replayCalls > 0) reasons.push(`${replayCalls} of ${metas.length} calls came from replay fixtures`);
  if (models.includes("replay")) reasons.push('a call was billed against the model id "replay"');
  return { live: reasons.length === 0, calls: metas.length, replayCalls, models, reasons };
}

/* ------------------------------------------------------------------ locales ---- */

export const ALL_LOCALES: readonly Locale[] = LOCALES;
