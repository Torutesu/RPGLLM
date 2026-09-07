import type { MomentReel, Moment, ReelBeat } from "../api/client";

/**
 * The reel's timeline, when the server has not sent one.
 *
 * `GET /v1/moments/:slug/reel` is the source of truth — the server owns the clock so that every
 * viewer of a shared reel sees the same cut. But the endpoint is landing separately, and a moment
 * page that shows nothing until it does would be worse than one that cuts its own reel from the
 * card payload it already has. So this builds the same shape from `MomentResZ`, on the same fixed
 * nine-second clock, deterministically: no timers, no randomness, no clock reads.
 *
 * Two things are honestly missing here and arrive with the endpoint: the *world* a moment happened
 * in (the payload has no world), and the player's actual post (the payload keeps the narrative, not
 * the text that caused it). The fallback uses the narrative for the post beat and leaves the world
 * title blank rather than inventing either.
 */

const DURATION = 9000;
const REPLY_AT = [2900, 3660, 4420];

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

function beat(
  kind: ReelBeat["kind"],
  at: number,
  holdMs: number,
  text: string,
  handle: string | null = null,
  displayName: string | null = null,
  delta: ReelBeat["delta"] = null,
): ReelBeat {
  return { kind, at, holdMs, handle, displayName, text, delta };
}

/** The narrative minus the sentence the headline already used — so the reel never says it twice. */
export function bodyAfterHeadline(body: string, headline: string): string {
  const clean = body.trim().replace(/\s+/g, " ");
  const head = headline.trim().replace(/\s+/g, " ").replace(/…$/, "");
  if (head.length > 0 && clean.startsWith(head)) {
    const rest = clean.slice(head.length).trim();
    if (rest.length > 0) return rest;
  }
  return clean;
}

export function reelFromMoment(moment: Moment): MomentReel {
  const payload = moment.payload;
  const persona = obj(payload["persona"]);
  const deltas = obj(payload["deltas"]);
  const handle = str(persona["handle"]).replace(/^@/, "");
  const displayName = str(persona["displayName"]) || handle;

  const reactionsRaw = payload["reactions"];
  const replies = (Array.isArray(reactionsRaw) ? reactionsRaw : [])
    .flatMap((entry): { handle: string; displayName: string; text: string }[] => {
      const o = obj(entry);
      const text = str(o["text"]);
      return text.length === 0
        ? []
        : [{ handle: str(o["handle"]).replace(/^@/, ""), displayName: str(o["displayName"]), text }];
    })
    .slice(0, REPLY_AT.length)
    .map((r, i) => beat("reply", REPLY_AT[i] ?? 2900, 700, r.text, r.handle, r.displayName));

  const beats: ReelBeat[] = [
    beat("setup", 0, 1100, "", handle, displayName),
    beat("post", 1150, 1650, bodyAfterHeadline(moment.body, moment.headline), handle, displayName),
    ...replies,
    beat("stat", 5300, 1500, "", handle, displayName, {
      followers: num(deltas["followers"]),
      aura: num(deltas["aura"]),
      humor: num(deltas["humor"]),
    }),
    beat("headline", 6900, 1450, moment.headline, handle, displayName),
    beat("outro", 8400, 600, "", handle, displayName),
  ];

  return {
    slug: moment.shareSlug,
    worldTitle: "",
    worldSlug: moment.shareSlug,
    personaHandle: handle,
    creatorHandle: null,
    durationMs: DURATION,
    beats,
  };
}

/**
 * A server reel, made safe to animate: beats in time order, nothing past the end, and at least the
 * beats the composition needs. A 400-beat response or one with `at` beyond `durationMs` must not be
 * able to produce a frame that never resolves.
 */
export function normalizeReel(reel: MomentReel): MomentReel {
  const duration = Math.max(3000, Math.min(30000, reel.durationMs));
  const beats = [...reel.beats]
    .filter((b) => b.at >= 0 && b.at <= duration)
    .sort((a, b) => a.at - b.at)
    .slice(0, 24);
  return { ...reel, durationMs: duration, beats };
}
