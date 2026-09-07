import { colors, gradients, hashString, identityFor } from "@rpgllm/shared";
import { familyFor, STAGE, withAlpha, type Align, type Face, type ReelNode } from "./scene";

/**
 * The canvas painter — web only.
 *
 * This exists because of what a recording actually is. `MediaRecorder` records a `MediaStream`, and
 * the only stream a page can make out of its own pixels is `HTMLCanvasElement.captureStream()`: a
 * DOM animation, however pretty, is not recordable without a screen-capture permission prompt and a
 * user picking the right window. So the reel is *drawn on a canvas in the first place*, at full
 * 1080×1920, and the preview the player watches is that same canvas — which is why the file and the
 * animation cannot drift: they are the same pixels.
 *
 * Everything is drawn from `packages/shared` tokens and the app's own generated art. Nothing is
 * fetched, so a frame never depends on a network round trip landing in time.
 */

const FALLBACK = '-apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

export function fontSpec(face: Face, size: number, bold: boolean): string {
  return `${bold ? 700 : 400} ${size}px "${familyFor(face, bold)}", ${FALLBACK}`;
}

/**
 * Canvas silently falls back to a system face for a font the document has not loaded yet, and a
 * recording made in that window is a recording of the wrong typeface. `expo-font` injects the
 * `@font-face` rules at import time, so this only ever waits for the bytes.
 */
export async function ensureFaces(): Promise<void> {
  const d = typeof document !== "undefined" ? (document as Document & { fonts?: FontFaceSet }) : undefined;
  const set = d?.fonts;
  if (!set) return;
  const wanted = [
    fontSpec("display", 84, true),
    fontSpec("display", 40, false),
    fontSpec("text", 40, true),
    fontSpec("text", 40, false),
  ];
  try {
    await Promise.all(wanted.map((spec) => set.load(spec)));
    await set.ready;
  } catch {
    /* a face that will not load is a fallback face, not a broken reel */
  }
}

/* ------------------------------------------------------------- primitives -- */

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, rr);
    return;
  }
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** CSS gradient angles (0° up, 90° right, 180° down) — the same convention as `<Gradient>`. */
function linear(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  angle: number,
  from: string,
  to: string,
): CanvasGradient {
  const rad = ((angle - 90) * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const g = ctx.createLinearGradient(
    x + w * (0.5 - dx / 2),
    y + h * (0.5 - dy / 2),
    x + w * (0.5 + dx / 2),
    y + h * (0.5 + dy / 2),
  );
  g.addColorStop(0, from);
  g.addColorStop(1, to);
  return g;
}

function anchor(align: Align, x: number, w: number): number {
  return align === "left" ? x : align === "right" ? x + w : x + w / 2;
}

/* ----------------------------------------------------------------- avatar -- */

const LIGHT = withAlpha(colors.text, 0.92);
const LIGHT_SOFT = withAlpha(colors.text, 0.55);
const INK = withAlpha(colors.bg, 0.45);
const INK_SOFT = withAlpha(colors.bg, 0.26);

function dashedCircle(ctx: CanvasRenderingContext2D, r: number, fraction: number, stroke: string, width: number): void {
  const c = 2 * Math.PI * r;
  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.setLineDash([c * fraction, c]);
  ctx.beginPath();
  ctx.arc(50, 50, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

const disc = (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string): void => {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
};

/**
 * The ten motifs of `src/ui/Avatar.tsx`, in canvas terms. Ported rather than rasterised: the reel
 * has to carry the app's own faces, and a `<Svg>` cannot be drawn into a recordable canvas without
 * serialising it through an image every frame.
 */
function motif(ctx: CanvasRenderingContext2D, variant: number, seed: number, light: string, ink: string): void {
  const spin = (seed % 8) * 45;
  const soft = light === LIGHT ? LIGHT_SOFT : INK_SOFT;
  const spun = (deg: number, draw: () => void): void => {
    ctx.save();
    ctx.translate(50, 50);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.translate(-50, -50);
    draw();
    ctx.restore();
  };
  const stroke = (path: () => void, color: string, width: number): void => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    path();
    ctx.stroke();
    ctx.restore();
  };

  switch (variant) {
    case 0:
      spun(spin, () => {
        dashedCircle(ctx, 37, 0.34, light, 9);
        dashedCircle(ctx, 22, 0.26, ink, 7);
        disc(ctx, 50, 50, 8, light);
      });
      return;
    case 1:
      stroke(() => {
        ctx.arc(50, 50, 38, 0, Math.PI * 2);
      }, soft, 3);
      stroke(() => {
        ctx.arc(50, 50, 27, 0, Math.PI * 2);
      }, light, 8);
      disc(ctx, 50, 50, 11, ink);
      return;
    case 2:
      spun(spin, () => {
        disc(ctx, 31, 33, 9, light);
        disc(ctx, 63, 26, 5, soft);
        disc(ctx, 73, 51, 11, ink);
        disc(ctx, 42, 62, 14, light);
        disc(ctx, 24, 68, 5, soft);
        disc(ctx, 64, 77, 7, ink);
      });
      return;
    case 3: {
      const bars = [34, 62, 44, 74, 52];
      bars.forEach((v, i) => {
        const h = 16 + ((v + seed * 11) % 52);
        ctx.fillStyle = i % 2 === 0 ? light : ink;
        roundRectPath(ctx, 17 + i * 14, 80 - h, 9, h, 4.5);
        ctx.fill();
      });
      return;
    }
    case 4:
      disc(ctx, 35, 43, 7.5, ink);
      disc(ctx, 65, 43, 7.5, ink);
      disc(ctx, 38, 40, 2.4, light);
      disc(ctx, 68, 40, 2.4, light);
      stroke(() => {
        ctx.moveTo(31, 62);
        ctx.quadraticCurveTo(50, 78, 69, 62);
      }, ink, 6);
      return;
    case 5:
      ctx.fillStyle = ink;
      roundRectPath(ctx, 4, 38, 92, 22, 11);
      ctx.fill();
      stroke(() => {
        ctx.moveTo(20, 58);
        ctx.lineTo(40, 40);
      }, light, 5);
      stroke(() => {
        ctx.moveTo(50, 58);
        ctx.lineTo(62, 46);
      }, soft, 4);
      return;
    case 6:
      spun(spin / 2, () => {
        ctx.fillStyle = light;
        ctx.beginPath();
        ctx.moveTo(4, 84);
        ctx.lineTo(52, 8);
        ctx.lineTo(96, 84);
        ctx.closePath();
        ctx.fill();
        disc(ctx, 52, 62, 17, ink);
      });
      return;
    case 7:
      [30, 50, 70].forEach((y, i) => {
        stroke(() => {
          ctx.moveTo(26, y - 9);
          ctx.lineTo(50, y + 8);
          ctx.lineTo(74, y - 9);
        }, i === 1 ? ink : light, 7);
      });
      return;
    case 8:
      spun(-28 - spin / 4, () => {
        ctx.save();
        ctx.strokeStyle = soft;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.ellipse(50, 50, 44, 17, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      });
      disc(ctx, 50, 50, 18, light);
      disc(ctx, 50, 50, 7, ink);
      disc(ctx, 84, 34, 7, light);
      return;
    default:
      disc(ctx, 50, 26, 10, light);
      stroke(() => {
        ctx.moveTo(2, 58);
        ctx.quadraticCurveTo(26, 32, 50, 58);
        ctx.quadraticCurveTo(74, 84, 98, 58);
      }, light, 8);
      stroke(() => {
        ctx.moveTo(2, 76);
        ctx.quadraticCurveTo(26, 50, 50, 76);
        ctx.quadraticCurveTo(74, 102, 98, 76);
      }, ink, 8);
  }
}

function drawOrb(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, handle: string, ring: boolean): void {
  const clean = handle.replace(/^@/, "").toLowerCase();
  const identity = identityFor(clean);
  const seed = hashString(clean);
  const motifSeed = hashString(`${clean}~motif`);
  const variant = motifSeed % 10;
  const inverted = ((motifSeed >> 7) & 1) === 1;
  const zoom = [0.86, 1, 1.14][(motifSeed >> 13) % 3] ?? 1;
  const angleIdx = (seed >> 3) % 4;
  const coords =
    angleIdx === 0
      ? [0, 0, 1, 1]
      : angleIdx === 1
        ? [0, 1, 1, 0]
        : angleIdx === 2
          ? [0, 0, 0, 1]
          : [1, 0, 0, 1];
  const orbR = ring ? 43 : 49;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 100, size / 100);

  if (ring) {
    ctx.strokeStyle = identity.from;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(50, 50, 48, 0, Math.PI * 2);
    ctx.stroke();
  }

  const g = ctx.createLinearGradient(
    (coords[0] ?? 0) * 100,
    (coords[1] ?? 0) * 100,
    (coords[2] ?? 1) * 100,
    (coords[3] ?? 1) * 100,
  );
  g.addColorStop(0, identity.from);
  g.addColorStop(1, identity.to);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(50, 50, orbR, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(50, 50, orbR, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalAlpha *= 0.9;
  ctx.translate(50, 50);
  ctx.scale(zoom, zoom);
  ctx.translate(-50, -50);
  motif(ctx, variant, motifSeed, inverted ? INK : LIGHT, inverted ? LIGHT : INK);
  ctx.restore();

  const shine = ctx.createRadialGradient(32, 26, 0, 32, 26, 75);
  shine.addColorStop(0, withAlpha(colors.text, 0.3));
  shine.addColorStop(1, withAlpha(colors.text, 0));
  ctx.fillStyle = shine;
  ctx.beginPath();
  ctx.arc(50, 50, orbR, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = withAlpha(colors.text, 0.16);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(50, 50, orbR - 0.7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** The brand, set the way `<Wordmark>` sets it: display face, brand gradient poured through it. */
function drawMark(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  const label = "status";
  ctx.save();
  ctx.font = fontSpec("display", size, true);
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const w = ctx.measureText(label).width;
  ctx.fillStyle = linear(ctx, cx - w / 2, cy - size / 2, w, size, 118, gradients.brand[0], gradients.brand[1]);
  ctx.fillText(label, cx, cy);
  ctx.restore();
}

/* ------------------------------------------------------------------ frame -- */

export function paintFrame(ctx: CanvasRenderingContext2D, nodes: readonly ReelNode[]): void {
  ctx.save();
  ctx.clearRect(0, 0, STAGE.w, STAGE.h);
  for (const n of nodes) {
    if ("alpha" in n && n.alpha <= 0.004) continue;
    ctx.save();
    if ("alpha" in n) ctx.globalAlpha = Math.min(1, n.alpha);
    switch (n.k) {
      case "fill":
        ctx.fillStyle = n.color;
        ctx.fillRect(0, 0, STAGE.w, STAGE.h);
        break;
      case "rect":
        roundRectPath(ctx, n.x, n.y, n.w, n.h, n.r);
        if (n.fill) {
          ctx.fillStyle = n.fill;
          ctx.fill();
        }
        if (n.stroke && n.sw > 0) {
          ctx.strokeStyle = n.stroke;
          ctx.lineWidth = n.sw;
          ctx.stroke();
        }
        break;
      case "grad":
        roundRectPath(ctx, n.x, n.y, n.w, n.h, n.r);
        ctx.fillStyle = linear(ctx, n.x, n.y, n.w, n.h, n.angle, n.from, n.to);
        ctx.fill();
        break;
      case "glow": {
        const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
        g.addColorStop(0, withAlpha(n.color, 0.9));
        g.addColorStop(1, withAlpha(n.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "dot":
        disc(ctx, n.x, n.y, n.r, n.color);
        break;
      case "ring":
        ctx.strokeStyle = n.color;
        ctx.lineWidth = Math.max(0.5, n.sw);
        ctx.beginPath();
        ctx.arc(n.x, n.y, Math.max(0, n.r), 0, Math.PI * 2);
        ctx.stroke();
        break;
      case "orb":
        drawOrb(ctx, n.x, n.y, n.size, n.handle, n.ring);
        break;
      case "mark":
        drawMark(ctx, n.x, n.y, n.size);
        break;
      case "text": {
        ctx.font = fontSpec(n.face, n.size, n.bold);
        ctx.textBaseline = "middle";
        ctx.textAlign = n.align === "left" ? "left" : n.align === "right" ? "right" : "center";
        const spaced = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
        if (typeof spaced.letterSpacing === "string") spaced.letterSpacing = `${n.track}px`;
        ctx.fillStyle = n.color;
        ctx.fillText(n.text, anchor(n.align, n.x, n.w), n.y, n.w);
        if (typeof spaced.letterSpacing === "string") spaced.letterSpacing = "0px";
        break;
      }
      default:
        break;
    }
    ctx.restore();
  }
  ctx.restore();
}
