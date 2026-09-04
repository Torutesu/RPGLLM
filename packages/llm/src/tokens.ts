/**
 * Token estimation + deterministic hashing helpers.
 *
 * We never call `messages.count_tokens` at runtime (network call, latency, cost).
 * The estimate is used for (a) asserting the world bibles clear Haiku 4.5's 4,096-token
 * cache-prefix minimum (cost-architecture 3.1) and (b) simulating `usage` in replay mode so
 * the cost dashboards keep working without an API key.
 *
 * Heuristic: EN ~ chars / 4, JA/CJK ~ chars / 1.7. Mixed text is split per code point.
 */

const CJK_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x3000, 0x303f], // CJK punctuation
  [0x3040, 0x309f], // Hiragana
  [0x30a0, 0x30ff], // Katakana
  [0x3400, 0x4dbf], // CJK ext A
  [0x4e00, 0x9fff], // CJK unified ideographs
  [0xac00, 0xd7af], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xff00, 0xffef], // Halfwidth / fullwidth forms
];

function isCjkCodePoint(cp: number): boolean {
  for (const range of CJK_RANGES) {
    if (cp >= range[0] && cp <= range[1]) return true;
  }
  return false;
}

/** Rough token count. Deterministic, no network. */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && isCjkCodePoint(cp)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk / 1.7 + other / 4);
}

/** 32-bit FNV-1a. Used for user-sticky experiment assignment and replay bucket selection. */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // hash *= 16777619, kept inside uint32 space
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

/** Non-negative index into a pool of `size`, derived from any number of string/number parts. */
export function pick(size: number, ...parts: Array<string | number>): number {
  if (size <= 0) return 0;
  return fnv1a(parts.join("|")) % size;
}

/** Choose one element deterministically; returns `undefined` only for empty pools. */
export function pickFrom<T>(pool: readonly T[], ...parts: Array<string | number>): T | undefined {
  if (pool.length === 0) return undefined;
  return pool[pick(pool.length, ...parts)];
}
