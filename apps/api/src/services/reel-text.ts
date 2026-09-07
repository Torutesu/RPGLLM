/**
 * The reel's typography clock — how long a line of text stays on screen (gtm.md §4, Phase 2).
 *
 * Two facts the timing has to respect, and one it deliberately does not:
 *
 *  1. **Reading time is not uniform.** A 200-character reply is not a 20-character one, so a beat's
 *     hold is a function of its text, never a constant.
 *  2. **Japanese is not English at the same character count.** 「炎上した」 is four characters and a
 *     whole sentence; "it blew up" is ten and the same sentence. So the unit of pacing is not the
 *     character, it is the **reading unit**: one latin character is 1, one CJK/kana/hangul
 *     character is 2. A JA line therefore gets roughly twice the time per character, which is what
 *     makes the same nine seconds work in both languages — and it works on a mixed line
 *     (`@handle が言った`) for free, because the measurement is per character, not per locale.
 *  3. **This is a trailer, not a reading exercise.** `MS_PER_UNIT` is a *skim* rate (~45 latin
 *     characters or ~22 kana per second), not a comprehension rate. Nine seconds cannot both hold
 *     six beats and let anyone read a full post; the reel's job is to make a stranger open the
 *     moment card, which is where the whole text is. That is also why `truncateToUnits` exists:
 *     when a post is too long for its beat we cut the text rather than the cut.
 *
 * Everything here is a pure function of the string — no clock, no locale, no randomness — because
 * the timing is a contract with a screen recording (see `reel.ts`).
 */

/**
 * Characters that carry about twice the reading effort of a latin one: CJK ideographs, kana,
 * hangul, and the full-width punctuation that comes with them.
 */
const WIDE =
  /[\u1100-\u115F\u2E80-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uA960-\uA97F\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/u;

/** How many reading units one character is worth. */
export const unitsOf = (char: string): number => (WIDE.test(char) ? 2 : 1);

/** The reading cost of a whole string, in units. */
export function textUnits(text: string): number {
  let units = 0;
  for (const char of text) units += unitsOf(char);
  return units;
}

/** The eye landing on a new card costs this much before it has read anything. */
export const BASE_MS = 480;
/** Per reading unit: ~45 latin characters, or ~22 kana, per second. A skim, not a read. */
export const MS_PER_UNIT = 22;

/** Unclamped reading time. Callers clamp per beat kind (`reel.ts`). */
export const readMs = (text: string): number => BASE_MS + textUnits(text) * MS_PER_UNIT;

/** Collapse whitespace so a multi-line post is one measurable line. */
export const flatten = (text: string): string => text.trim().replace(/\s+/g, " ");

/**
 * Cut to `maxUnits` reading units, on a character boundary, with an ellipsis that is itself paid
 * for. Truncating is the answer to a long post: the reel's duration is a contract, the text is not.
 */
export function truncateToUnits(text: string, maxUnits: number): string {
  const flat = flatten(text);
  if (textUnits(flat) <= maxUnits) return flat;
  // The ellipsis costs one unit, so the text may spend maxUnits - 1.
  const budget = Math.max(1, maxUnits - 1);
  let units = 0;
  let out = "";
  for (const char of flat) {
    const cost = unitsOf(char);
    if (units + cost > budget) break;
    units += cost;
    out += char;
  }
  return `${out.trimEnd()}…`;
}
