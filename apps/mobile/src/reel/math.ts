/** Colour, easing and randomness for the reel — all of it pure, none of it reading a clock. */


/** Token hex → rgba. Keeps every colour in the reel sourced from `packages/shared`. */
export function withAlpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? `${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}` : h;
  const n = Number.parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(n)) return hex;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}


export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** `motion.easeOut` — the token curve, evaluated rather than handed to a native driver. */
export const easeOut = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);
export const easeOutBack = (t: number): number => {
  const c = clamp01(t) - 1;
  return 1 + 2.2 * c * c * c + 1.4 * c * c;
};
export const easeInOut = (t: number): number => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

/** mulberry32, the same PRNG the generated world covers use, so one slug paints one backdrop. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
