import { hashString, identityFor } from "@rpgllm/shared";
import type { MomentReel, ReelBeat } from "../api/client";
import { seeded } from "./math";
import { wrapText, type Align, type Face } from "./text";

export { withAlpha, clamp01, lerp, easeOut, easeOutBack, easeInOut } from "./math";
export { familyFor, measure, wrapText, FACE_FAMILY, type Align, type Face } from "./text";

/**
 * The reel, as geometry.
 *
 * One moment has to come out of two very different painters — a 2D canvas on the web (because that
 * is the only thing `MediaRecorder` can be pointed at) and React Native views on a phone — and the
 * recording must be frame-for-frame the thing the player watched. So neither painter is allowed to
 * decide anything: this module turns `(reel, t)` into a flat list of absolutely-placed primitives
 * in a fixed 1080×1920 space, and a painter's only job is to put them on the screen.
 *
 * Everything here is a pure function of the beats plus the moment's slug (through a seeded PRNG).
 * There is no `Math.random`, no `Date.now`, no measurement of the device: the same moment paints
 * the same 270 frames on a phone, in a browser, and inside the recorder.
 */

export const STAGE = { w: 1080, h: 1920 } as const;
export const PAD = 72;
export const COL_W = STAGE.w - PAD * 2;

export type ReelNode =
  | { k: "fill"; color: string }
  | { k: "rect"; x: number; y: number; w: number; h: number; r: number; fill: string | null; stroke: string | null; sw: number; alpha: number }
  | { k: "grad"; x: number; y: number; w: number; h: number; r: number; from: string; to: string; angle: number; alpha: number }
  | { k: "glow"; x: number; y: number; r: number; color: string; alpha: number }
  | { k: "dot"; x: number; y: number; r: number; color: string; alpha: number }
  | { k: "ring"; x: number; y: number; r: number; color: string; sw: number; alpha: number }
  | { k: "orb"; x: number; y: number; size: number; handle: string; ring: boolean; alpha: number }
  /** the wordmark; `x`/`y` are its centre, because only a painter knows how wide it sets */
  | { k: "mark"; x: number; y: number; size: number; alpha: number }
  | {
      k: "text";
      x: number;
      y: number;
      w: number;
      align: Align;
      text: string;
      size: number;
      bold: boolean;
      face: Face;
      color: string;
      alpha: number;
      track: number;
    };

/* -------------------------------------------------------------------- plan -- */

export interface Wrapped {
  lines: string[];
  size: number;
  face: Face;
  bold: boolean;
  lead: number;
}

export interface PostPanel {
  beat: ReelBeat;
  body: Wrapped;
  head: number;
  h: number;
}

export interface SceneLabels {
  followers: string;
  aura: string;
  humor: string;
}

export interface SceneQuality {
  /** how many drifting motes the backdrop carries */
  sparks: number;
  /** whether those motes twinkle per frame (off on native, where every frame is a re-render) */
  twinkle: boolean;
}

export const QUALITY_FULL: SceneQuality = { sparks: 34, twinkle: true };
export const QUALITY_LITE: SceneQuality = { sparks: 12, twinkle: false };

export interface ReelPlan {
  reel: MomentReel;
  labels: SceneLabels;
  quality: SceneQuality;
  identity: { from: string; to: string; index: number };
  /** the whole run reads as a win or a loss, and the colour of the frame says which */
  winning: boolean;
  durationMs: number;
  t: { setup: number; post: number; stat: number; headline: number; outro: number };
  setup: { name: string; sub: string; handle: string; caption: Wrapped };
  post: PostPanel | null;
  replies: PostPanel[];
  stat: { at: number; delta: { followers: number; aura: number; humor: number } } | null;
  headline: Wrapped;
  outro: { handle: string; credit: string };
  sparks: { x: number; y: number; r: number; o: number; drift: number; phase: number }[];
  bands: { x: number; w: number; o: number; c: string }[];
}

export const CARD_PAD = 34;
/** the space a card gives its author row before the body starts */
const HEAD_LEAD = 88;
const HEAD_REPLY = 76;

/** One block of copy, wrapped once at plan time and never measured again. */
function wrap(text: string, size: number, face: Face, bold: boolean, maxW: number, maxLines: number, lead: number): Wrapped {
  return { lines: wrapText(text, size, face, bold, maxW, maxLines), size, face, bold, lead };
}

function panelFor(beat: ReelBeat, w: number, size: number, maxLines: number, head: number): PostPanel {
  const body = wrap(beat.text, size, "text", false, w - CARD_PAD * 2, maxLines, 1.35);
  const h = CARD_PAD + head + Math.max(1, body.lines.length) * Math.round(size * 1.35) + CARD_PAD;
  return { beat, body, head, h };
}

const firstOf = (beats: readonly ReelBeat[], kind: ReelBeat["kind"]): ReelBeat | null =>
  beats.find((b) => b.kind === kind) ?? null;

/**
 * Everything expensive — wrapping, seeding, the timeline — happens once. `frameAt` after this is
 * arithmetic only, which is what lets the recorder run 30 real frames a second without drifting.
 */
export function planReel(reel: MomentReel, labels: SceneLabels, quality: SceneQuality): ReelPlan {
  const identity = identityFor(reel.personaHandle);
  const rnd = seeded(hashString(reel.slug));

  const setupBeat = firstOf(reel.beats, "setup");
  const postBeat = firstOf(reel.beats, "post");
  const statBeat = firstOf(reel.beats, "stat");
  const headBeat = firstOf(reel.beats, "headline");
  const outroBeat = firstOf(reel.beats, "outro");
  const replyBeats = reel.beats.filter((b) => b.kind === "reply").slice(0, 3);

  const duration = Math.max(3000, reel.durationMs);
  const t = {
    setup: setupBeat?.at ?? 0,
    post: postBeat?.at ?? Math.round(duration * 0.13),
    stat: statBeat?.at ?? Math.round(duration * 0.58),
    headline: headBeat?.at ?? Math.round(duration * 0.76),
    outro: outroBeat?.at ?? Math.round(duration * 0.93),
  };

  const delta = statBeat?.delta ?? null;
  const winning = delta === null ? true : delta.followers + delta.aura >= 0;

  const post = postBeat ? panelFor(postBeat, COL_W, 44, 4, HEAD_LEAD) : null;
  const replies = replyBeats.map((b) => panelFor(b, COL_W - 56, 33, 3, HEAD_REPLY));

  return {
    reel,
    labels,
    quality,
    identity,
    winning,
    durationMs: duration,
    t,
    setup: {
      name: setupBeat?.displayName ?? postBeat?.displayName ?? reel.personaHandle,
      sub: reel.worldTitle,
      handle: reel.personaHandle,
      caption: wrap(setupBeat?.text ?? "", 34, "text", false, COL_W - 40, 2, 1.35),
    },
    post,
    replies,
    stat: statBeat && delta ? { at: statBeat.at, delta } : null,
    headline: wrap(headBeat?.text ?? "", 84, "display", true, COL_W, 4, 1.16),
    outro: { handle: reel.personaHandle, credit: reel.creatorHandle ? `@${reel.creatorHandle}` : reel.worldTitle },
    sparks: Array.from({ length: quality.sparks }, () => ({
      x: rnd() * STAGE.w,
      y: rnd() * STAGE.h,
      r: 1.6 + rnd() * 5.2,
      o: 0.14 + rnd() * 0.5,
      drift: 24 + rnd() * 90,
      phase: rnd() * Math.PI * 2,
    })),
    bands: Array.from({ length: 5 }, (_, i) => ({
      x: rnd() * STAGE.w,
      w: 70 + rnd() * 210,
      o: 0.02 + rnd() * 0.05,
      c: i % 2 === 0 ? identityFor(reel.worldSlug).from : identityFor(reel.personaHandle).to,
    })),
  };
}
