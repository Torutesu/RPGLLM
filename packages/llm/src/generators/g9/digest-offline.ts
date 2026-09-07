import { LOCALES, ReviewPointZ, type Locale, type WorldSeed } from "@rpgllm/shared";
import type { z } from "zod";
import { clamp } from "../../prompts/render.js";
import { screenPremise } from "./screen.js";

/**
 * G9 — the review digest, deterministic half (docs/moderation.md §3, gtm.md §2).
 *
 * The digest a reviewer reads is two halves ANDed together: what a **measurement** can establish,
 * and what only a **model** can notice. This file is the first half. It runs offline, costs
 * nothing, is byte-identical for the same world, and is the whole digest in replay mode.
 *
 * Its governing rule is the one that makes the digest worth reading at all:
 *
 *   > **No citation, no point.**
 *
 * Every function here that wants to say something has to produce the passage it is saying it
 * about. That rules out a whole class of true-but-useless observations ("the cast has seven
 * members", "there are no events") — those are structural facts `apps/api` already has, and a
 * reviewer cannot check a number by reading the world. What is left is exactly the set of things
 * that live *in a passage*: an English sentence in the Japanese column, two cast cards that are
 * the same card, a brand name in the bible, a line that is addressed to the model.
 *
 * ## What this half contributes that the gates in §1 do not
 *
 * `screenPremise` runs on the **premise**, before generation. Its own documentation says what it
 * cannot see: "anything the *generator* invented that the premise did not say". So the cheapest
 * real contribution available is to point the same vocabulary at the **generated world**, line by
 * line, and cite what it hits. That costs one pass over the text and needs no key.
 *
 * It is run in two stages for speed: once over the whole locale as a single haystack (the common
 * case, where a clean world costs two calls), and per passage only when that first pass fires —
 * because a point is only allowed to exist if some single passage carries it.
 */

export type ReviewPoint = z.infer<typeof ReviewPointZ>;

/** The five rules of docs/moderation.md §3, in the order a reviewer should read them. */
export const DIGEST_RULES = ["original", "age", "playable", "locales", "vector"] as const;
export type DigestRule = (typeof DIGEST_RULES)[number];

export const CONFIDENCES = ["high", "medium", "low"] as const;
export type DigestConfidence = (typeof CONFIDENCES)[number];

/**
 * The size of a digest, in one place.
 *
 * These bind the deterministic half exactly as hard as they bind the model: a measured point that
 * quoted a whole 900-character cast card would be as unreadable as a model one, and the eval gate
 * checks the finished digest without caring which half produced a point.
 */
export const DIGEST_MAX_POINTS = 6;
export const DIGEST_MAX_PER_RULE = 2;
export const DIGEST_CONCERN_MAX = 220;
export const DIGEST_EVIDENCE_MAX = 300;
/** Shorter than this is not a citation, it is a word. */
export const DIGEST_EVIDENCE_MIN = 12;

/** Below this the "Japanese" side of a field is not written in Japanese. Mirrors the G9 eval gate. */
export const DIGEST_MIN_JA_CJK = 0.3;
/** Two cast cards this similar are one cast card. Token-set Jaccard over the English halves. */
export const DIGEST_CARD_COLLISION = 0.8;

const CJK_G = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/gu;

/** Fraction of non-space characters that are CJK. */
export function cjkDensity(text: string): number {
  const dense = text.replace(/\s+/gu, "");
  if (dense.length === 0) return 0;
  return (dense.match(CJK_G) ?? []).length / dense.length;
}

/* ------------------------------------------------------------------ passages ---- */

/**
 * One quotable place in the world. `field` is where it is, so the digest can tell a reviewer
 * where to look as well as what to look at; `text` is what the point may quote.
 */
export interface Passage {
  locale: Locale;
  field: string;
  text: string;
}

/** Long enough that quoting it means something; short enough that a reviewer can find it. */
const MIN_PASSAGE = 12;

function push(out: Passage[], locale: Locale, field: string, text: string | undefined): void {
  const t = (text ?? "").trim();
  if (t.length >= MIN_PASSAGE) out.push({ locale, field, text: t });
}

/**
 * Every passage of the world a point may cite, in a stable order.
 *
 * The bible is split into lines rather than kept whole: a 19,000-character quotation is not
 * evidence, it is the world again. A cited bible line is something a reviewer can search for.
 */
export function worldPassages(world: WorldSeed): Passage[] {
  const out: Passage[] = [];
  for (const locale of LOCALES) {
    push(out, locale, "title", world.title[locale]);
    push(out, locale, "scenario", world.scenario[locale]);
    const bible = world.bible[locale] ?? "";
    bible
      .split(/\n+/)
      .map((l) => l.trim())
      .filter((l) => l.length >= 20)
      .forEach((line, i) => {
        push(out, locale, `bible[${i}]`, line);
      });
    for (const c of world.cast) {
      push(out, locale, `cast.${c.handle}.role`, c.roleLocalized?.[locale] ?? c.role);
      push(out, locale, `cast.${c.handle}.card`, c.card[locale]);
      push(out, locale, `cast.${c.handle}.intro`, c.intro[locale]);
    }
    for (const p of world.presetPersonas) push(out, locale, `persona.${p.handle}.bio`, p.bio[locale]);
    world.presetEvents.forEach((e, i) => {
      push(out, locale, `event[${i}].title`, e.title[locale]);
      push(out, locale, `event[${i}].prompt`, e.prompt[locale]);
      e.choices.forEach((ch, j) => {
        push(out, locale, `event[${i}].choice[${j}]`, ch.label[locale]);
        push(out, locale, `event[${i}].outcome[${j}]`, ch.outcomeText[locale]);
      });
    });
    (world.ambientPool[locale] ?? []).forEach((a, i) => {
      push(out, locale, `ambient[${i}].${a.handle}`, a.text);
    });
    for (const handle of Object.keys(world.fallbackReplies).sort()) {
      (world.fallbackReplies[handle]?.[locale] ?? []).forEach((line, i) => {
        push(out, locale, `fallback.${handle}[${i}]`, line);
      });
    }
    for (const handle of Object.keys(world.welcomePosts).sort()) {
      push(out, locale, `welcome.${handle}`, world.welcomePosts[handle]?.[locale]);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ grounding ---- */

/**
 * Normalisation for the "is this passage actually in the world" test.
 *
 * Deliberately forgiving about *shape* and unforgiving about *content*: whitespace collapses,
 * the quote characters a model wraps a citation in are stripped, and case is folded — but no
 * character of the passage itself may be invented. Full-width punctuation is folded too, because
 * a model quoting Japanese routinely normalises 「」 and ・ on its way out.
 */
export function normaliseEvidence(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, "")
    .replace(/[“”„‟"'’‘`´「」『』]/g, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

/** The whole world as one normalised string, for substring grounding. */
export function worldHaystack(world: WorldSeed): string {
  return normaliseEvidence(worldPassages(world).map((p) => p.text).join("\n"));
}

/** An elided quotation ("A … B") is grounded when every segment of it is. */
const ELLIPSIS_RE = /\s*(?:\.{3}|…|\[\.\.\.\]|\[…\])\s*/g;

/**
 * Is this citation checkable? A point whose evidence the world does not contain is worse than no
 * point at all — it is a summary the reviewer has to trust, which is the thing the digest exists
 * not to be — so `postprocess` drops those and the eval gate fails on them.
 */
export function isGrounded(evidence: string, haystack: string): boolean {
  const norm = normaliseEvidence(evidence);
  if (norm.length === 0) return false;
  const parts = norm
    .split(ELLIPSIS_RE)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return false;
  // A one-word fragment is grounded by accident, not by citation.
  if (parts.every((p) => p.length < 6)) return false;
  return parts.every((p) => (p.length < 6 ? true : haystack.includes(p)));
}

/* -------------------------------------------------------------- measured points ---- */

function point(rule: DigestRule, concern: string, evidence: string, confidence: DigestConfidence): ReviewPoint {
  return {
    rule,
    concern: clamp(concern, DIGEST_CONCERN_MAX),
    evidence: clamp(evidence, DIGEST_EVIDENCE_MAX),
    confidence,
  };
}

/**
 * The premise screen's categories, mapped onto the five review rules.
 *
 * `hate`, `violence_graphic` and `illegal` have no rule of their own in §3, and the closest true
 * statement about them is §3.2: the product is rated 13+ and a thirteen-year-old is playing it.
 * So they arrive as `age` with the category named in the concern, rather than being dropped for
 * want of a bucket — a reviewer who sees the category knows which paragraph of §3 they are in.
 */
const CATEGORY_RULE: Readonly<Record<string, DigestRule>> = {
  sexual_minor: "age",
  sexual_explicit: "age",
  self_harm: "age",
  hate: "age",
  violence_graphic: "age",
  illegal: "age",
  real_person: "original",
  prompt_injection: "vector",
};

const CATEGORY_CONCERN: Readonly<Record<string, string>> = {
  sexual_minor:
    "The premise screen's sexualised-minor rule matches this generated passage (§3.2, 13+). The premise itself passed; this is text the generator wrote.",
  sexual_explicit:
    "Sexual vocabulary in player-visible text of a 13+ world (§3.2). The premise passed the screen; this line did not come from it.",
  self_harm:
    "Self-harm treated as method or aesthetic rather than as something already in the past (§3.2).",
  hate: "Slur or dehumanising vocabulary in player-visible text (§3.2, assume a 13-year-old is reading it).",
  violence_graphic: "Graphic violence as the attraction rather than as drama (§3.2).",
  illegal: "Reads as real-world procedure rather than as fiction about it (§3.2).",
  real_person:
    "Names a real person, brand or existing franchise in the world's own text (§3.1). This is a literal entity match, not a resemblance.",
  prompt_injection:
    "This line is addressed to a model rather than to the characters (§3.5) — the generator wrote it into the world.",
};

/**
 * Scaffolding that means a stage echoed its own prompt into the world. Distinct from
 * `prompt_injection`: nobody is attacking anything, the world is simply carrying our plumbing,
 * and §3.5 is the rule a reviewer reads it under.
 */
const SCAFFOLD_MARKERS: readonly string[] = [
  "<<<PREMISE",
  "PREMISE>>>",
  "# TASK",
  "# ROLE",
  "## PARAMETERS",
  "untrusted data",
  "response schema",
  "[INST]",
  "```",
];

/**
 * Terms on the premise screen's `real_person` list that are **also ordinary English**, or that
 * appear in our own prompts.
 *
 * This is the one place where pointing a premise screen at 60,000 characters of prose behaves
 * differently from pointing it at a 200-character sentence, and it was measured rather than
 * guessed: on the eighteen blueprint worlds, every single one raised a `real_person` hit, from
 *
 *   - "twice"     — the K-pop group, and the ordinary adverb, in "this has gone badly twice";
 *   - "one piece" — the manga, and the ordinary noun phrase, in "the one piece of history that";
 *   - "real person" — the *world bible's own rule line*: "Never import a real person, brand or
 *     existing work", which G9 writes into every world it builds.
 *
 * A digest that raised an `original` point on every world would be exactly the noise this
 * generator exists not to be, so a `real_person` hit is confirmed by masking these and screening
 * again. Nothing is added to or removed from `screen.ts`: the premise screen is right to be broad
 * about a sentence somebody chose to write, and this is a different question asked of a different
 * length of text.
 */
export const AMBIGUOUS_ENTITY_TERMS: readonly string[] = [
  "twice",
  "one piece",
  "real person",
  "real people",
  "real celebrity",
  "real celebrities",
  "actual celebrity",
  "based on a real person",
  "\u5b9f\u5728\u306e\u4eba\u7269",
  "\u5b9f\u5728\u3059\u308b\u4eba\u7269",
  "\u5b9f\u5728\u306e\u6709\u540d\u4eba",
  "\u5b9f\u5728\u306e\u82b8\u80fd\u4eba",
  "\u672c\u7269\u306e\u82b8\u80fd\u4eba",
];

const LATIN_AMBIGUOUS = AMBIGUOUS_ENTITY_TERMS.filter((t) => /^[a-z ]+$/.test(t));
const AMBIGUOUS_RE = new RegExp(
  `(?<![a-z0-9])(?:${LATIN_AMBIGUOUS.map((t) => t.replace(/\s+/g, "[\\s-]+")).join("|")})(?![a-z0-9])`,
  "gi",
);

function maskAmbiguous(text: string): string {
  let out = text.replace(AMBIGUOUS_RE, " ");
  for (const term of AMBIGUOUS_ENTITY_TERMS) {
    if (LATIN_AMBIGUOUS.includes(term)) continue;
    out = out.split(term).join(" ");
  }
  return out;
}

/**
 * The premise screen, asked about generated prose instead of about a premise. Identical except
 * that a `real_person` verdict has to survive `maskAmbiguous`; every other category is taken as
 * it comes, and masking can legitimately reveal one that `real_person` was standing in front of.
 */
export function screenPassage(text: string, locale: Locale): { verdict: string; category: string | null } {
  const first = screenPremise(text, locale);
  if (first.category !== "real_person") return first;
  return screenPremise(maskAmbiguous(text), locale);
}

function screenedPoints(passages: readonly Passage[]): ReviewPoint[] {
  const out: ReviewPoint[] = [];
  // Cheap first pass: one screen per locale over everything. A clean world stops here.
  const suspect = new Set<Locale>();
  for (const locale of LOCALES) {
    const blob = passages
      .filter((p) => p.locale === locale)
      .map((p) => p.text)
      .join("\n");
    if (blob.length > 0 && screenPassage(blob, locale).verdict === "block") suspect.add(locale);
  }
  if (suspect.size === 0) return out;

  // Something fired somewhere. Only a passage that fires *on its own* can be cited, so descend.
  const seen = new Set<string>();
  for (const p of passages) {
    if (!suspect.has(p.locale)) continue;
    const hit = screenPassage(p.text, p.locale);
    if (hit.verdict !== "block" || hit.category === null) continue;
    const rule = CATEGORY_RULE[hit.category];
    const concern = CATEGORY_CONCERN[hit.category];
    if (rule === undefined || concern === undefined) continue;
    const key = `${rule}|${hit.category}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(point(rule, `${concern} [${p.field}]`, p.text, "high"));
  }
  return out;
}

function scaffoldPoints(passages: readonly Passage[]): ReviewPoint[] {
  for (const p of passages) {
    const marker = SCAFFOLD_MARKERS.find((m) => p.text.includes(m));
    if (marker === undefined) continue;
    return [
      point(
        "vector",
        `Generator scaffolding reached player-visible text ("${marker}") — the world is carrying a piece of its own prompt (§3.5) [${p.field}].`,
        p.text,
        "high",
      ),
    ];
  }
  return [];
}

/**
 * One odd line proves nothing; a column of them is the defect. Measured: a clean blueprint world
 * has zero once the furniture below is discounted, so this floor costs no recall and buys the
 * digest immunity to a single stray line.
 */
export const LOCALE_PROSE_MIN_HITS = 3;

/** A markdown heading is structure, not prose — the JA bible's cast headers are handle + name. */
const HEADING_RE = /^#{1,6}\s/;

/**
 * What is left of a passage once the parts that are *supposed* to be Latin are removed: handles,
 * list markers, punctuation and digits. A Japanese bible line that lists the eight handles is
 * 16% CJK by character count and 100% Japanese as a sentence, and only one of those two numbers
 * is about whether a Japanese player is reading Japanese.
 */
export function linguisticCore(text: string): string {
  return text
    .replace(/@[a-z0-9_]+/gi, " ")
    .replace(/[\][(){}<>|/\\#*_\u2014\u2013:\uff1a\u3001\u3002,.!?\uff01\uff1f"'`~+=%$&^\u2500-\u257f-]/g, " ")
    .replace(/\d+/g, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Is this Japanese-side passage actually written in Japanese? Undecidable — and therefore not a
 * point — for a heading or for anything too short to have a language.
 */
export function isJapaneseProse(p: Passage): boolean | null {
  if (HEADING_RE.test(p.text)) return null;
  const core = linguisticCore(p.text);
  if (core.length < 20) return null;
  return cjkDensity(core) >= DIGEST_MIN_JA_CJK;
}

function localePoints(world: WorldSeed, passages: readonly Passage[]): ReviewPoint[] {
  const out: ReviewPoint[] = [];

  // 1. A JA field that is byte-identical to its EN twin is English on the Japanese shelf.
  const twins: Array<{ field: string; en: string; ja: string }> = [
    { field: "title", en: world.title.en ?? "", ja: world.title.ja ?? "" },
    { field: "scenario", en: world.scenario.en ?? "", ja: world.scenario.ja ?? "" },
  ];
  for (const c of world.cast) {
    twins.push({ field: `cast.${c.handle}.card`, en: c.card.en ?? "", ja: c.card.ja ?? "" });
    twins.push({ field: `cast.${c.handle}.intro`, en: c.intro.en ?? "", ja: c.intro.ja ?? "" });
  }
  const echoed = twins.filter((t) => t.ja.trim().length >= MIN_PASSAGE && t.ja.trim() === t.en.trim());
  const firstEcho = echoed[0];
  if (firstEcho !== undefined) {
    out.push(
      point(
        "locales",
        `The Japanese column repeats the English text word for word in ${echoed.length} field(s) — a Japanese player would be reading English here (§3.4) [${firstEcho.field}].`,
        firstEcho.ja,
        "high",
      ),
    );
  }

  // 2. Japanese *prose* with no Japanese in it. Cite the longest, so the reviewer sees the worst.
  const notJapanese = passages
    .filter((p) => p.locale === "ja" && isJapaneseProse(p) === false)
    .sort((a, b) => b.text.length - a.text.length);
  const worst = notJapanese[0];
  if (notJapanese.length >= LOCALE_PROSE_MIN_HITS && worst !== undefined && firstEcho?.ja !== worst.text) {
    out.push(
      point(
        "locales",
        `${notJapanese.length} prose passages on the Japanese side are under ${Math.round(DIGEST_MIN_JA_CJK * 100)}% Japanese characters (§3.4) [${worst.field}].`,
        worst.text,
        "high",
      ),
    );
  }

  // 3. The role line specifically — the field a screenshot caught before any check did.
  const untranslatedRoles = world.cast.filter((c) => {
    const ja = (c.roleLocalized?.ja ?? c.role).trim();
    return ja.length > 0 && cjkDensity(ja) === 0;
  });
  const firstRole = untranslatedRoles[0];
  if (firstRole !== undefined) {
    out.push(
      point(
        "locales",
        `${untranslatedRoles.length} of ${world.cast.length} cast role lines are English on the Japanese cast list (§3.4) [cast.${firstRole.handle}.role].`,
        (firstRole.roleLocalized?.ja ?? firstRole.role).trim(),
        "high",
      ),
    );
  }
  return out;
}

/** Content words of a cast card, for the "would these two react identically" test. */
function cardTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4),
  );
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const v of a) if (b.has(v)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

function playablePoints(world: WorldSeed): ReviewPoint[] {
  const cards = world.cast.map((c) => ({ handle: c.handle, text: (c.card.en ?? "").trim(), tokens: cardTokens(c.card.en ?? "") }));
  for (let i = 0; i < cards.length; i += 1) {
    for (let j = i + 1; j < cards.length; j += 1) {
      const a = cards[i];
      const b = cards[j];
      if (a === undefined || b === undefined) continue;
      if (a.text.length < MIN_PASSAGE || b.text.length < MIN_PASSAGE) continue;
      const sim = jaccard(a.tokens, b.tokens);
      if (sim < DIGEST_CARD_COLLISION) continue;
      return [
        point(
          "playable",
          `@${a.handle} and @${b.handle} share ${Math.round(sim * 100)}% of their character card — eight accounts, fewer than eight people (§3.3) [cast.${a.handle}.card].`,
          a.text,
          "high",
        ),
      ];
    }
  }

  const byName = new Map<string, string[]>();
  for (const c of world.cast) {
    const key = c.displayName.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), c.handle]);
  }
  for (const [, handles] of [...byName].sort()) {
    if (handles.length < 2) continue;
    const member = world.cast.find((c) => c.handle === handles[0]);
    if (member === undefined) continue;
    return [
      point(
        "playable",
        `${handles.length} cast accounts share the display name "${member.displayName}" (${handles.map((h) => `@${h}`).join(", ")}) — the feed cannot tell them apart (§3.3).`,
        (member.card.en ?? "").trim(),
        "high",
      ),
    ];
  }
  return [];
}

/**
 * Everything the digest can establish without a model, for one world.
 *
 * Deterministic in the world alone: no clock, no randomness, no environment. Same world in, same
 * points out, which is what makes the replay digest and the E2E suite reproducible.
 */
export function measuredPoints(world: WorldSeed): ReviewPoint[] {
  const passages = worldPassages(world);
  return [
    ...screenedPoints(passages),
    ...localePoints(world, passages),
    ...playablePoints(world),
    ...scaffoldPoints(passages),
  ];
}
