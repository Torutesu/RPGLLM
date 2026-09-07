/**
 * **Exit 3 — the five rules, extracted** (gtm.md §2, `docs/moderation.md` §3).
 *
 * The safety gate answers one question: block or not. A reviewer's twenty minutes go almost
 * entirely on the questions it does *not* answer — is this somebody else's IP with the serial
 * numbers filed off, is the JA written or translated at, is this 13+ in spirit rather than in
 * vocabulary, are these eight characters or one character eight times. This file asks those five
 * questions of the generated text and hands the answers over with the passage attached.
 *
 * Three properties it must never lose:
 *
 *  - **It is advice, not a verdict.** Nothing here returns "approve" or "reject", nothing here is
 *    read by any code path that decides anything, and `confidence` exists so a reviewer can tell a
 *    literal match from a guess. A world with ten points still goes to a person; a world with none
 *    still goes to a person. An empty digest is a fact about the extraction, not a pass.
 *  - **Every point cites its passage.** A summary a reviewer has to trust is worse than no summary:
 *    it moves the judgement from the person to the regex without telling them. `evidence` is the
 *    text it fired on, so the first thing the reviewer does is read the world.
 *  - **It is deterministic and free.** Same world in, same points out, no model, no network — so it
 *    can be computed once at submission and stored, and so it works today whether or not
 *    `packages/llm` ever ships a generator for it.
 *
 * The `original` rule is knowingly the weakest (a paraphrase defeats vocabulary matching, which
 * `docs/moderation.md` §3.1 says outright). It is here anyway because raising the question cheaply
 * on the lazy cases is worth something, and because a reviewer who sees `original` with a literal
 * franchise name in the evidence is thirty seconds from a decision rather than twenty minutes.
 */
import type { ReviewPointZ } from "@rpgllm/shared";
import type { z } from "zod";
import { localized, roleFor, type LocaleKey } from "./locale";

export type ReviewPoint = z.infer<typeof ReviewPointZ>;

/** How much of a passage a reviewer is shown per point. Enough to recognise, short enough to scan. */
export const EVIDENCE_CHARS = 200;
/** A digest longer than this is a wall of text, which is the thing this exists to replace. */
export const MAX_POINTS = 12;

export interface DigestWorld {
  premise: string;
  title: unknown;
  scenario: unknown;
  bible: unknown;
}
export interface DigestCharacter {
  handle: string;
  displayName: string;
  role: string;
  roleLocalized?: unknown;
  card: unknown;
}

const LOCALES: readonly LocaleKey[] = ["en", "ja"];

const trim = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > EVIDENCE_CHARS ? `${flat.slice(0, EVIDENCE_CHARS - 1)}…` : flat;
};

/** The passage around a match, so the evidence reads as prose rather than as a captured group. */
function around(text: string, at: number, length: number): string {
  const start = Math.max(0, at - 60);
  return trim(text.slice(start, at + length + 100));
}

const point = (
  rule: ReviewPoint["rule"],
  concern: string,
  evidence: string,
  confidence: ReviewPoint["confidence"],
): ReviewPoint => ({ rule, concern, evidence: trim(evidence), confidence });

/* ------------------------------------------------------------------ script ---- */

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/;

/** Share of non-space characters that are kana or kanji. The whole of the `locales` rule. */
export function cjkRatio(text: string): number {
  const chars = [...text.replace(/\s/g, "")];
  if (chars.length === 0) return 0;
  return chars.filter((ch) => CJK.test(ch)).length / chars.length;
}

/* ------------------------------------------------------------------- rules ---- */

/**
 * `original` — real people, real brands, and franchises with the names changed.
 *
 * Two kinds of signal. **Literal names** are high confidence because they are not a judgement: the
 * text says "Hogwarts". **Framing** ("based on", "in the style of", パロディ) is medium: it is a
 * legitimate thing to write and also exactly how a derivative announces itself.
 */
const FRANCHISE = /\b(?:hogwarts|jedi|sith|pok[eé]mon|pikachu|marvel|avengers|spider-?man|batman|superman|naruto|sasuke|goku|dragon ball|sailor moon|demon slayer|jujutsu kaisen|attack on titan|one piece|luffy|hatsune miku|studio ghibli|totoro|disney|pixar|nintendo|mario|zelda|minecraft|fortnite|roblox|taylor swift|beyonc[eé]|bts|blackpink|k-?pop demon hunters)\b|(?:ハリー・?ポッター|ポケモン|ナルト|ドラゴンボール|セーラームーン|鬼滅の刃|呪術廻戦|進撃の巨人|ワンピース|初音ミク|ジブリ|ディズニー|マリオ|ゼルダ)/i;
const HOMAGE = /\b(?:based on|inspired by|in the style of|reminiscent of|an? homage to|the same universe as|thinly veiled|serial numbers)\b|(?:をモデルに|パロディ|オマージュ|そっくり)/i;
const REAL_WORLD = /\b(?:real[\s-]?life|actual|the real)\s+(?:celebrit|person|people|politician|president|singer|actor|idol)|[™®]|(?:実在の(?:人物|有名人|芸能人|企業))/i;

/**
 * `age` — 13+ in spirit. The block gate already refused the explicit cases; what is left for a
 * person is the **borderline**, which is why every point here is medium at most. A school setting
 * with romance in it is most of the genre and is not by itself a problem; it is a thing a reviewer
 * should have their eye on, which is all a digest can honestly say.
 */
const SCHOOL = "student|schoolgirl|schoolboy|classmate|freshman|sophomore|pupil|高校生|中学生|生徒|同級生|後輩|先輩";
const ROMANCE = "romance|romantic|dating|date them|kiss|seduce|flirt|crush on|sleep with|恋愛|付き合|キス|口説|告白";
const AGE_NEAR = new RegExp(`(?:${SCHOOL})[^.。!?！？]{0,80}(?:${ROMANCE})|(?:${ROMANCE})[^.。!?！？]{0,80}(?:${SCHOOL})`, "i");
const AGE_NUMERAL = /\b1[0-7][\s-]?(?:year|yr)s?[\s-]?old\b|(?:1[0-7]|十[一-七])歳/i;
const SELF_HARM = /\b(?:self[\s-]?harm|suicid\w*|cutting herself|cutting himself|eating disorder|anorexi\w*)\b|(?:自殺|自傷|リストカット|摂食障害)/i;
const SUBSTANCE = /\b(?:getting drunk|binge drink\w*|cocaine|meth\b|pills to|overdose)\b|(?:泥酔|覚醒剤|オーバードーズ)/i;

/**
 * `vector` — the generated bible is a system prompt for every later generator, so an instruction
 * inside it is aimed at the model, not at the characters. This is the one rule where the machine is
 * better than the person and the person still has to sign it off.
 */
const VECTOR_TAG = /<\/?(?:system|assistant|human|instructions?)\b/i;
const VECTOR_TEXT = /(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+|the\s+|your\s+|previous\s+|above\s+|prior\s+)*(?:instruction|prompt|rule|guideline|system)|\bsystem\s*prompt\b|\bdeveloper\s*message\b|\bjailbreak\b|\bas an AI\b|\byou are (?:an? )?(?:AI|assistant|language model)\b|(?:これまでの指示|システムプロンプト|前の指示を無視)/i;

interface Match { index: number; length: number }

const firstMatch = (re: RegExp, text: string): Match | null => {
  const m = re.exec(text);
  return m ? { index: m.index, length: m[0].length } : null;
};

function scan(
  re: RegExp,
  haystacks: readonly { label: string; text: string }[],
): { label: string; text: string; at: Match } | null {
  for (const h of haystacks) {
    const at = firstMatch(re, h.text);
    if (at) return { ...h, at };
  }
  return null;
}

/* ------------------------------------------------------------- the extraction ---- */

export function extractPoints(world: DigestWorld, characters: readonly DigestCharacter[]): ReviewPoint[] {
  const points: ReviewPoint[] = [];
  const bible: Record<LocaleKey, string> = { en: localized(world.bible, "en"), ja: localized(world.bible, "ja") };
  const prose = [
    { label: "premise", text: world.premise },
    { label: "scenario", text: `${localized(world.scenario, "en")}\n${localized(world.scenario, "ja")}` },
    { label: "bible (en)", text: bible.en },
    { label: "bible (ja)", text: bible.ja },
    ...characters.map((ch) => ({
      label: `@${ch.handle}`,
      text: `${localized(ch.card, "en")}\n${localized(ch.card, "ja")}`,
    })),
  ];

  /* ---- 1. original ---- */
  const franchise = scan(FRANCHISE, prose);
  if (franchise) {
    points.push(point(
      "original",
      `A named franchise appears verbatim in the ${franchise.label}. Rule 1 is about serial numbers filed off an existing property — this one is not even filed.`,
      around(franchise.text, franchise.at.index, franchise.at.length),
      "high",
    ));
  }
  const real = scan(REAL_WORLD, prose);
  if (real) {
    points.push(point(
      "original",
      `The ${real.label} points at the real world — a real person, a real company, or a trademark symbol.`,
      around(real.text, real.at.index, real.at.length),
      "high",
    ));
  }
  const homage = scan(HOMAGE, prose);
  if (homage) {
    points.push(point(
      "original",
      `The ${homage.label} says out loud that it is derived from something. Read what it is derived from before rule 1.`,
      around(homage.text, homage.at.index, homage.at.length),
      "medium",
    ));
  }

  /* ---- 2. age ---- */
  const near = scan(AGE_NEAR, prose);
  if (near) {
    points.push(point(
      "age",
      `School vocabulary and romance vocabulary sit in one sentence in the ${near.label}. Most of the genre does this innocently; rule 2 is about whether the *premise* is the romance.`,
      around(near.text, near.at.index, near.at.length),
      "medium",
    ));
  }
  const numeral = scan(AGE_NUMERAL, prose);
  if (numeral) {
    points.push(point(
      "age",
      `An age under 18 is stated in the ${numeral.label}. Worth knowing which character it belongs to and who they are written opposite.`,
      around(numeral.text, numeral.at.index, numeral.at.length),
      "medium",
    ));
  }
  const harm = scan(SELF_HARM, prose);
  if (harm) {
    points.push(point(
      "age",
      `Self-harm appears as subject matter in the ${harm.label}. The gate blocks instructions; rule 2 is about it being something a player participates in.`,
      around(harm.text, harm.at.index, harm.at.length),
      "medium",
    ));
  }
  const substance = scan(SUBSTANCE, prose);
  if (substance) {
    points.push(point(
      "age",
      `Substance use appears in the ${substance.label}.`,
      around(substance.text, substance.at.index, substance.at.length),
      "low",
    ));
  }

  /* ---- 3. playable ---- */
  points.push(...playablePoints(world, characters, bible));

  /* ---- 4. locales ---- */
  points.push(...localePoints(characters, bible));

  /* ---- 5. vector ---- */
  const tag = scan(VECTOR_TAG, prose);
  if (tag) {
    points.push(point(
      "vector",
      `A role tag is embedded in the ${tag.label}. The bible is the cached prompt prefix every later generator reads, so a tag in it is aimed at the model.`,
      around(tag.text, tag.at.index, tag.at.length),
      "high",
    ));
  }
  const vector = scan(VECTOR_TEXT, prose);
  if (vector) {
    points.push(point(
      "vector",
      `The ${vector.label} contains text addressed to a model rather than to a character.`,
      around(vector.text, vector.at.index, vector.at.length),
      "high",
    ));
  }

  return points.slice(0, MAX_POINTS);
}

/**
 * Rule 3, which is the one a machine is genuinely good at: "eight distinguishable characters" is
 * countable, and a beautiful bible with eight interchangeable voices reads to a player as a broken
 * app rather than as a bad world.
 */
function playablePoints(
  world: DigestWorld,
  characters: readonly DigestCharacter[],
  bible: Record<LocaleKey, string>,
): ReviewPoint[] {
  const out: ReviewPoint[] = [];
  const names = new Set(characters.map((ch) => ch.displayName.trim().toLowerCase()));
  const roles = new Set(characters.map((ch) => roleFor(ch, "en").trim().toLowerCase()).filter(Boolean));
  if (characters.length < 8) {
    out.push(point(
      "playable",
      `The cast is ${characters.length}, not eight. Rule 3 asks for eight distinguishable characters.`,
      characters.map((ch) => `@${ch.handle}`).join(", ") || "(no cast rows)",
      "high",
    ));
  } else if (names.size < characters.length) {
    out.push(point(
      "playable",
      `${characters.length} cast members share ${names.size} distinct display names.`,
      characters.map((ch) => ch.displayName).join(", "),
      "high",
    ));
  }
  if (characters.length >= 4 && roles.size <= 2) {
    out.push(point(
      "playable",
      `${characters.length} characters between ${roles.size} distinct roles — check they are people rather than one person repeated.`,
      [...roles].join(", ") || "(no roles)",
      "medium",
    ));
  }
  const thin = characters.filter((ch) => localized(ch.card, "en").trim().length < 80);
  if (thin.length > 0) {
    out.push(point(
      "playable",
      `${thin.length} cast card${thin.length === 1 ? "" : "s"} under 80 characters — there may not be enough there to play against.`,
      thin.map((ch) => `@${ch.handle}: ${localized(ch.card, "en").trim()}`).join(" | "),
      "medium",
    ));
  }
  for (const locale of LOCALES) {
    const text = bible[locale];
    if (text.trim().length > 0 && text.trim().length < 1200) {
      out.push(point(
        "playable",
        `The ${locale.toUpperCase()} bible is ${text.trim().length} characters. Short bibles read as thin worlds.`,
        `${localized(world.title, locale)} — ${trim(text)}`,
        "low",
      ));
    }
  }
  return out;
}

/**
 * Rule 4 — "the JA is written in Japanese, not translated at it".
 *
 * This is the strongest deterministic check in the file and the one worth the most, because it is
 * the rule an English-speaking reviewer cannot apply by reading: a JA bible that is 3% kana is
 * English left in the Japanese slot, and no amount of language skill is needed to see the number.
 * It is the operational half of 世界は言語を超える — a world on the shelf whose JA is machine
 * flattened means a Japanese player is playing a worse game than an English one, on the same shelf.
 */
function localePoints(
  characters: readonly DigestCharacter[],
  bible: Record<LocaleKey, string>,
): ReviewPoint[] {
  const out: ReviewPoint[] = [];
  const ja = bible.ja.trim();
  const en = bible.en.trim();
  if (ja.length > 0 && en.length > 0 && ja === en) {
    out.push(point(
      "locales",
      "The JA and EN bibles are identical text. One of the two locales was never written.",
      ja,
      "high",
    ));
  } else if (ja.length > 200 && cjkRatio(ja) < 0.15) {
    out.push(point(
      "locales",
      `The JA bible is ${Math.round(cjkRatio(ja) * 100)}% kana or kanji — it is Latin script sitting in the Japanese slot.`,
      ja,
      "high",
    ));
  }
  if (en.length > 200 && cjkRatio(en) > 0.5) {
    out.push(point(
      "locales",
      `The EN bible is ${Math.round(cjkRatio(en) * 100)}% kana or kanji — the two locales may be swapped.`,
      en,
      "high",
    ));
  }
  const flat = characters.filter((ch) => {
    const card = localized(ch.card, "ja").trim();
    return card.length > 40 && cjkRatio(card) < 0.15;
  });
  if (flat.length > 0) {
    out.push(point(
      "locales",
      `${flat.length} of ${characters.length} JA cast cards are not written in Japanese.`,
      flat.map((ch) => `@${ch.handle}: ${localized(ch.card, "ja").trim()}`).join(" | "),
      flat.length > characters.length / 2 ? "high" : "medium",
    ));
  }
  return out;
}
