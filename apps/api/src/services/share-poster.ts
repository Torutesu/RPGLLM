/**
 * The image a shared link previews with (task 45).
 *
 * A link is only a distribution surface if the thing it unfurls into looks like something. Every
 * unfurler — X, Facebook, Slack, Discord, LINE, iMessage — asks for one raster image at a URL, and
 * *raster* is the constraint that decides this file: none of them render SVG, which is the only
 * kind of picture this product otherwise has (every cover, avatar and post image in the app is a
 * seeded SVG drawn on the client, `components/WorldCard.tsx`). So the server has to produce actual
 * pixels, and it does it here — a tiny painter over an RGB buffer plus a PNG encoder over
 * `node:zlib`, which is in the runtime already. No new dependency, no headless browser, no image
 * library: an og:image that needs Chromium to exist is an og:image that goes down on its own.
 *
 * **It is the same picture as the app's.** The composition, the palette, the PRNG and the seed are
 * the ones `WorldCover` uses, at 1200×630 instead of 320×180 — so the card someone sees on X is
 * the cover they then see at the top of the world, and a link preview that shows a *different*
 * artwork from the destination is a small broken promise made to every person who clicks.
 *
 * **What it does not do: text.** There is no font here, and rasterising one is not a small job —
 * for `ja` it is a 3 MB CJK face and a shaper. So the poster is the artwork alone and the words
 * ride in `og:title` / `og:description`, which every one of those platforms renders beside the
 * image. This is a real limitation, written down in `pipeline/status/gap-analysis.md`: the card is
 * weaker than one with the headline burned into it, and the fix is a font, not a workaround.
 */
import { deflateSync } from "node:zlib";
import { colors, hashString, identityFor, identityPalette } from "@rpgllm/shared";

/** The size every unfurler wants: 1.91:1, over their 300×157 minimum, under their 5 MB ceiling. */
export const POSTER_W = 1200;
export const POSTER_H = 630;

/** `WorldCover`'s viewBox. The art is authored in these units and scaled up, so it stays the same art. */
const VB_W = 320;
const VB_H = 180;
const SX = POSTER_W / VB_W;
const SY = POSTER_H / VB_H;

type RGB = readonly [number, number, number];

/** mulberry32 — the client's PRNG, byte for byte, so one seed paints one picture in both places. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (s: string): RGB => {
  const h = s.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Source-over onto an opaque buffer: no alpha channel to keep, so the blend is one lerp. */
function blend(buf: Uint8ClampedArray, i: number, c: RGB, a: number): void {
  if (a <= 0) return;
  const k = a > 1 ? 1 : a;
  buf[i] = (buf[i] as number) + (c[0] - (buf[i] as number)) * k;
  buf[i + 1] = (buf[i + 1] as number) + (c[1] - (buf[i + 1] as number)) * k;
  buf[i + 2] = (buf[i + 2] as number) + (c[2] - (buf[i + 2] as number)) * k;
}

const WHITE: RGB = [255, 255, 255];

/** The cover, in pixels. Deterministic in `seedKey` and nothing else — no clock, no request. */
export function paintPoster(seedKey: string): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(POSTER_W * POSTER_H * 3);
  const seed = hashString(seedKey);
  const rnd = seeded(seed);
  const id = identityFor(seedKey);
  const alt = identityPalette[(id.index + 4) % identityPalette.length] ?? (identityPalette[0] as readonly [string, string]);

  // Drawn in the client's order, and the client's `rnd` order matters: bands are pulled before
  // sparks before the horizon, so the sequence has to be consumed in exactly that order.
  const bands = Array.from({ length: 5 }, (_, i) => ({
    x: rnd() * VB_W,
    w: 14 + rnd() * 46,
    o: 0.06 + rnd() * 0.18,
    c: i % 2 === 0 ? alt[0] : id.to,
  }));
  const sparks = Array.from({ length: 28 }, () => ({
    cx: rnd() * VB_W,
    cy: rnd() * VB_H,
    r: 0.7 + rnd() * 2.3,
    o: 0.18 + rnd() * 0.6,
  }));
  const horizon = 92 + rnd() * 48;
  const lift = 26 + rnd() * 46;

  const from = hex(id.from);
  const to = hex(id.to);
  const ground = hex(colors.bg);

  // 1. The sky. The client's gradient runs (0,0)→(0.9,1) in bounding-box units, i.e. diagonal.
  for (let y = 0; y < POSTER_H; y += 1) {
    const fy = y / POSTER_H;
    for (let x = 0; x < POSTER_W; x += 1) {
      const t = clamp01((0.9 * (x / POSTER_W) + fy) / 1.9);
      const c = t < 0.55 ? mix(from, to, t / 0.55) : mix(to, ground, (t - 0.55) / 0.45);
      const i = (y * POSTER_W + x) * 3;
      buf[i] = c[0];
      buf[i + 1] = c[1];
      buf[i + 2] = c[2];
    }
  }

  // 2. Light beams: white, 0.5 alpha at the top falling to 0 at the bottom, times the band's own.
  for (const b of bands) {
    const x0 = Math.max(0, Math.round(b.x * SX));
    const x1 = Math.min(POSTER_W, Math.round((b.x + b.w) * SX));
    for (let y = 0; y < POSTER_H; y += 1) {
      const a = b.o * 0.5 * (1 - y / POSTER_H);
      for (let x = x0; x < x1; x += 1) blend(buf, (y * POSTER_W + x) * 3, WHITE, a);
    }
  }

  // 3. Scattered light. Coverage is the disc's area over the pixel, so the edges are not stairs.
  for (const s of sparks) {
    const cx = s.cx * SX;
    const cy = s.cy * SY;
    const r = s.r * ((SX + SY) / 2);
    const x0 = Math.max(0, Math.floor(cx - r - 1));
    const x1 = Math.min(POSTER_W - 1, Math.ceil(cx + r + 1));
    const y0 = Math.max(0, Math.floor(cy - r - 1));
    const y1 = Math.min(POSTER_H - 1, Math.ceil(cy + r + 1));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const cover = clamp01(r + 0.5 - d);
        if (cover > 0) blend(buf, (y * POSTER_W + x) * 3, WHITE, s.o * cover);
      }
    }
  }

  // 4. The glow the horizon sits on: an ellipse centred below the frame, so only its cap shows.
  {
    const cx = (VB_W / 2) * SX;
    const cy = (VB_H + lift) * SY;
    const rx = VB_W * 0.88 * SX;
    const ry = (lift + 36) * SY;
    const c0 = hex(alt[0]);
    const c1 = hex(alt[1]);
    const top = cy - ry;
    const y1 = Math.min(POSTER_H - 1, Math.ceil(cy + ry));
    for (let y = Math.max(0, Math.floor(top)); y <= y1; y += 1) {
      const dy = (y + 0.5 - cy) / ry;
      const inner = 1 - dy * dy;
      if (inner <= 0) continue;
      const halfW = rx * Math.sqrt(inner);
      // Bounding-box units: 0 at the ellipse's bottom, 1 at its top — the client's `y1=1 → y2=0`.
      const u = clamp01((cy + ry - (y + 0.5)) / (2 * ry));
      const c = mix(c0, c1, u);
      const a = 0.85 * (1 - u);
      const xs = Math.max(0, Math.floor(cx - halfW));
      const xe = Math.min(POSTER_W - 1, Math.ceil(cx + halfW));
      for (let x = xs; x <= xe; x += 1) blend(buf, (y * POSTER_W + x) * 3, c, a);
    }
  }

  // 5. The horizon itself. Coverage is accumulated first and composited once, so the samples
  //    along the curve cannot blend over each other into a rope.
  {
    const cover = new Float32Array(POSTER_W * POSTER_H);
    const w = (1.4 * SY) / 2;
    const p0 = { x: 0, y: horizon * SY };
    const p1 = { x: (VB_W / 2) * SX, y: (horizon - lift) * SY };
    const p2 = { x: VB_W * SX, y: horizon * SY };
    const steps = POSTER_W * 2;
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const mt = 1 - t;
      const px = mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x;
      const py = mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y;
      const x0 = Math.max(0, Math.floor(px - w - 1));
      const x1 = Math.min(POSTER_W - 1, Math.ceil(px + w + 1));
      const y0 = Math.max(0, Math.floor(py - w - 1));
      const y1 = Math.min(POSTER_H - 1, Math.ceil(py + w + 1));
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const d = Math.hypot(x + 0.5 - px, y + 0.5 - py);
          const c = clamp01(w + 0.5 - d);
          const i = y * POSTER_W + x;
          if (c > (cover[i] as number)) cover[i] = c;
        }
      }
    }
    for (let i = 0; i < cover.length; i += 1) {
      const c = cover[i] as number;
      if (c > 0) blend(buf, i * 3, WHITE, 0.26 * c);
    }
  }

  // 6. The fade the title would sit in. Kept even without text: it is what stops the artwork
  //    fighting whatever chrome the platform draws under the image.
  for (let y = 0; y < POSTER_H; y += 1) {
    const t = y / POSTER_H;
    const a = t < 0.55 ? (0.4 * t) / 0.55 : 0.4 + (0.48 * (t - 0.55)) / 0.45;
    for (let x = 0; x < POSTER_W; x += 1) blend(buf, (y * POSTER_W + x) * 3, ground, a);
  }

  return buf;
}

/* ---------------- PNG ---------------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = (CRC_TABLE[(c ^ (buf[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/**
 * 8-bit truecolour PNG. Every row after the first uses the `Up` filter, which is the right one for
 * this picture by a wide margin — the art is a mostly-vertical gradient, so the difference against
 * the row above is nearly zero and deflate has almost nothing left to store.
 */
export function encodePng(rgb: Uint8ClampedArray, w: number, h: number): Buffer {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y += 1) {
    const o = y * (stride + 1);
    raw[o] = y === 0 ? 0 : 2;
    if (y === 0) {
      for (let i = 0; i < stride; i += 1) raw[o + 1 + i] = rgb[i] as number;
    } else {
      const cur = y * stride;
      const prev = cur - stride;
      for (let i = 0; i < stride; i += 1) {
        raw[o + 1 + i] = ((rgb[cur + i] as number) - (rgb[prev + i] as number)) & 0xff;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Posters are pure functions of a seed, so they are cached in process and served with a long
 * `max-age`: a link that goes viral is one crawler fetch per platform and then a cache hit for
 * every human. The map is bounded because a poster is ~100 kB and an unbounded one is a memory
 * leak with a public trigger — anyone can ask for a world id that does not repeat.
 */
const CACHE = new Map<string, Buffer>();
const CACHE_MAX = 64;

export function posterPng(seedKey: string): Buffer {
  const hit = CACHE.get(seedKey);
  if (hit) return hit;
  const png = encodePng(paintPoster(seedKey), POSTER_W, POSTER_H);
  if (CACHE.size >= CACHE_MAX) {
    const oldest = CACHE.keys().next();
    if (!oldest.done) CACHE.delete(oldest.value);
  }
  CACHE.set(seedKey, png);
  return png;
}
