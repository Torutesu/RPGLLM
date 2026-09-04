/** Deterministic seeded RNG so 演出 metrics are stable for a given post id. */
export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Metrics { likes: number; reposts: number; replies: number }

/**
 * 演出 metrics (spec/02-schema.md: the LLM never generates these).
 * likes = round(followers × U(0.05, 0.30)) seeded by post id; reposts = 15% of likes; replies = 3% (min 0).
 */
export function computeMetrics(postId: string, followers: number): Metrics {
  const rnd = seededRandom(hashString(postId));
  const likes = Math.max(0, Math.round(followers * (0.05 + rnd() * 0.25)));
  return { likes, reposts: Math.max(0, Math.round(likes * 0.15)), replies: Math.max(0, Math.round(likes * 0.03)) };
}

/** Stable 31-bit seed for generator calls. */
export const seedFrom = (s: string): number => hashString(s) % 2147483647;
