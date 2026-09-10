/**
 * The reel — a moment as something that moves (gtm.md §4: the one big thing standing between this
 * product and Phase 2 distribution).
 *
 * Sharing is a still card today, and a still cannot carry a drama beat: the good part *is* the
 * turn, and a screenshot has already spoiled it. So `GET /v1/moments/:slug/reel` returns the same
 * moment as a timeline the client animates and records — **public**, like the card, because a reel
 * nobody can open without an account is not a growth surface.
 *
 * Four decisions, which are the actual work:
 *
 * **1. What earns a beat.** Not every reply. Six lukewarm reactions are worse than two sharp ones,
 * so candidates are *scored* and only the top of them get in (`scoreCandidate`): how loud the post
 * was (`Post.heat`, a stored column), whether that character's opinion of the player actually moved
 * in this snapshot (`StatSnapshot.relDeltas`), and — worth the most per point — whether it moved
 * *down*. The reply that disagrees is the sharpest thing in a nine-second cut. A relative floor
 * (`REEL.FLOOR_RATIO`) then drops anything much weaker than the best one, so a third lukewarm reply
 * is left out rather than padded in.
 *
 * **2. Pacing.** `reel-text.ts` owns the clock: a beat's hold is its text's reading time, in units
 * where a CJK character is worth two latin ones, clamped per beat kind. Long text is truncated
 * rather than allowed to break the cut.
 *
 * **3. The turn.** The stat movement is the punchline, so the order is not chronology: world →
 * what you posted → the reactions, **quietest first**, → the numbers moving → the line that names
 * what happened → the world's name. The sharpest reaction is the one that hands off to the number.
 *
 * **4. Determinism.** The same moment must produce the same reel forever, text included, because
 * the timing is a contract with a recording made from it. So: every input is a stored row, never
 * `now()` (heat is read from the column, not recomputed against the clock); the candidate set is
 * frozen at the snapshot's own timestamp, so replies fetched later by `more-replies` can never
 * change a published reel; every sort has a total order (score, then createdAt, then id); the
 * language is the one the drama happened in, not the reader's; and every duration is an integer
 * millisecond, accumulated so rounding cannot drift.
 */
import type { Moment, Post, PrismaClient, WorldCharacter } from "@prisma/client";
import { compactNumber, t, type Locale } from "@rpgllm/shared";
import { atHandle, normHandle } from "./handles";
import { localized, type LocaleKey } from "./locale";
import { metricsCausedBy, readRelDeltas } from "./serialize";
import { readMs, truncateToUnits } from "./reel-text";

export type ReelBeatKind = "setup" | "post" | "reply" | "stat" | "headline" | "outro";

export interface ReelBeat {
  kind: ReelBeatKind;
  at: number;
  holdMs: number;
  handle: string | null;
  displayName: string | null;
  text: string;
  delta: { followers: number; aura: number; humor: number } | null;
}

export interface MomentReel {
  slug: string;
  worldTitle: string;
  worldSlug: string;
  personaHandle: string;
  creatorHandle: string | null;
  durationMs: number;
  beats: ReelBeat[];
}

/**
 * The cut, in milliseconds and reading units.
 *
 * `MAX_MS` is the whole point: a reel has to be over before a scroll thumb moves. It holds **by
 * construction**, not by a compression pass — the widest possible skeleton (setup + post + stat +
 * headline + outro, every one of them at its ceiling) is 8,000 ms, and a reply is admitted only
 * while it fits in what is left, the first one trimmed down to the remaining room if it has to be.
 * Change one ceiling and check that sum.
 */
export const REEL = {
  MAX_MS: 9_800,
  /** at most three reactions: a fourth is padding, and there is no room for it anyway */
  MAX_REPLIES: 3,
  /** a candidate scoring below this share of the best one is not sharp enough to spend a beat on */
  FLOOR_RATIO: 0.45,
  /** how many reply rows are scored — a cap on the read, not on the drama */
  CANDIDATE_SCAN: 12,
  HOLD: {
    setup: { min: 900, max: 1_600, units: 80 },
    post: { min: 1_100, max: 2_200, units: 120 },
    reply: { min: 900, max: 1_800, units: 90 },
    headline: { min: 1_100, max: 1_800, units: 80 },
    /** a number counting up, not a line to read */
    stat: { min: 1_400, max: 1_400, units: 60 },
    outro: { min: 1_000, max: 1_000, units: 40 },
  },
  SCORE: {
    /**
     * Heat is 0..100 and everything else here is worth tens, so it is halved: how loud a reply was
     * is real evidence, but at full weight it swamps *what the reply did*, and a reel of the three
     * most-liked replies is exactly the lukewarm cut this scoring exists to avoid. Halved, a
     * genuinely viral reaction still outranks a quiet hostile one; an ordinary loudness gap does not.
     */
    HEAT_WEIGHT: 0.5,
    /** the reply moved this character's opinion of you at all */
    REL_MOVED: 40,
    /** …and it moved *down*. The reply that disagrees is the reel */
    REL_AGAINST: 35,
    /** the press account reporting it is the world talking, not one character */
    NEWS: 10,
  },
} as const;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Text and hold for one beat kind, both derived from the same reading model. */
function shape(kind: keyof typeof REEL.HOLD, raw: string): { text: string; holdMs: number } {
  const spec = REEL.HOLD[kind];
  const text = truncateToUnits(raw, spec.units);
  return { text, holdMs: clamp(Math.round(readMs(text)), spec.min, spec.max) };
}

/* ------------------------------------------------------------------ the payload ---- */

/** What `services/moment.ts` froze into `Moment.payload` when the card was minted. */
interface FrozenPayload {
  cause: string;
  persona: { handle: string; displayName: string };
  deltas: { followers: number; aura: number; humor: number };
  reactions: { handle: string; displayName: string; text: string }[];
  createdAt: string | null;
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0);

export function readPayload(value: unknown): FrozenPayload {
  const obj = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const persona = (obj["persona"] && typeof obj["persona"] === "object" ? obj["persona"] : {}) as Record<
    string,
    unknown
  >;
  const deltas = (obj["deltas"] && typeof obj["deltas"] === "object" ? obj["deltas"] : {}) as Record<string, unknown>;
  const reactions = Array.isArray(obj["reactions"]) ? obj["reactions"] : [];
  return {
    cause: str(obj["cause"]),
    persona: { handle: str(persona["handle"]), displayName: str(persona["displayName"]) },
    deltas: { followers: num(deltas["followers"]), aura: num(deltas["aura"]), humor: num(deltas["humor"]) },
    reactions: reactions.flatMap((r) => {
      if (!r || typeof r !== "object") return [];
      const row = r as Record<string, unknown>;
      const text = str(row["text"]);
      return text ? [{ handle: str(row["handle"]), displayName: str(row["displayName"]), text }] : [];
    }),
    createdAt: typeof obj["createdAt"] === "string" ? obj["createdAt"] : null,
  };
}

/* ---------------------------------------------------------------- the candidates ---- */

interface Candidate {
  handle: string;
  displayName: string;
  text: string;
  score: number;
  /** tie-breakers, in this order, so the ranking is a total order */
  at: number;
  id: string;
}

type PostRow = Post & { authorCharacter: WorldCharacter | null };

/**
 * Why this reply, and not that one.
 *
 * `heat` is the post's own loudness, already computed and stored when the row was written — read,
 * never recomputed, because recomputing it would decay with the clock and the reel would change
 * under a recording. On top of it: the character whose feelings about the player actually moved in
 * this snapshot is, by definition, part of the turn — and the one who moved *against* the player is
 * the beat worth keeping when only two fit.
 */
export function scoreCandidate(row: { heat: number; kind: string }, relDelta: number): number {
  const moved = relDelta !== 0 ? REEL.SCORE.REL_MOVED * Math.min(1, Math.abs(relDelta)) : 0;
  const against = relDelta < 0 ? REEL.SCORE.REL_AGAINST : 0;
  const news = row.kind === "news" ? REEL.SCORE.NEWS : 0;
  return Math.max(0, row.heat) * REEL.SCORE.HEAT_WEIGHT + moved + against + news;
}

/** Rank, apply the relative floor, and keep at most `MAX_REPLIES`. */
export function rank(candidates: Candidate[]): Candidate[] {
  const sorted = [...candidates].sort(
    (a, b) => b.score - a.score || a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const best = sorted[0]?.score ?? 0;
  const floor = best * REEL.FLOOR_RATIO;
  return sorted.filter((c) => c.score >= floor).slice(0, REEL.MAX_REPLIES);
}

/* ---------------------------------------------------------------------- the stat ---- */

const signed = (n: number): string => (n > 0 ? `+${compactNumber(n)}` : compactNumber(n));

/**
 * The punchline, as a line of text: `+412 Followers · +6 Aura`, in the moment's language.
 *
 * Followers is always there even at zero — the reel needs its number, and "nothing moved" is
 * itself the turn for a moment that came from a drama event. `delta` on the beat carries the raw
 * numbers so the client can count rather than cut.
 */
export function statLine(locale: LocaleKey, deltas: { followers: number; aura: number; humor: number }): string {
  const l = locale as Locale;
  const parts = [`${signed(deltas.followers)} ${t(l, "followers")}`];
  if (deltas.aura !== 0) parts.push(`${signed(deltas.aura)} ${t(l, "aura")}`);
  if (deltas.humor !== 0) parts.push(`${signed(deltas.humor)} ${t(l, "humor")}`);
  return parts.join(" · ");
}

/* ------------------------------------------------------------------- the assembly ---- */

interface Draft {
  kind: ReelBeatKind;
  text: string;
  holdMs: number;
  handle: string | null;
  displayName: string | null;
  delta: ReelBeat["delta"];
}

/** Lay the drafts on a timeline. `at` accumulates the *rounded* holds, so nothing can drift. */
function layout(drafts: Draft[]): { beats: ReelBeat[]; durationMs: number } {
  let at = 0;
  const beats = drafts.map((d) => {
    const beat: ReelBeat = {
      kind: d.kind,
      at,
      holdMs: d.holdMs,
      handle: d.handle,
      displayName: d.displayName,
      text: d.text,
      delta: d.delta,
    };
    at += d.holdMs;
    return beat;
  });
  return { beats, durationMs: at };
}

/**
 * Build the reel for a moment, or `null` when the moment's persona is gone.
 *
 * One read per thing the cut needs: the persona (with its world and its owner's locale), the
 * snapshot that caused the moment, the player's post and the replies to it, and the press post
 * that reported it.
 */
export async function buildReel(prisma: PrismaClient, moment: Moment): Promise<MomentReel | null> {
  const persona = await prisma.persona.findUnique({
    where: { id: moment.personaId },
    include: { world: true, user: { select: { locale: true } } },
  });
  if (!persona) return null;

  /**
   * The reel's language is **the language the drama happened in** — the owner's locale, which is
   * what the posts in it were generated in. Not the viewer's: a reel translated for the reader
   * would contradict the rows it is built from, and a per-viewer reel is not a recording.
   */
  const locale = persona.user.locale as LocaleKey;
  const payload = readPayload(moment.payload);

  /**
   * The freeze line. Everything the reel is made of existed by the time the swing was recorded;
   * anything written after it (a `more-replies` pass, a later ambient post) is not what made this a
   * moment and must never change a reel somebody already recorded.
   */
  const frozenAt = payload.createdAt ? new Date(payload.createdAt) : moment.createdAt;
  const cutoff = Number.isNaN(frozenAt.getTime()) ? moment.createdAt : frozenAt;

  const snapshotId = moment.cause.startsWith("snapshot:") ? moment.cause.slice("snapshot:".length) : null;
  const snapshot = snapshotId ? await prisma.statSnapshot.findUnique({ where: { id: snapshotId } }) : null;
  const relDeltas = readRelDeltas(snapshot?.relDeltas ?? null).deltas;
  const relFor = (handle: string): number => relDeltas[normHandle(handle)] ?? 0;

  const postId = payload.cause.startsWith("post:") ? payload.cause.slice("post:".length) : null;
  const playerPost = postId ? await prisma.post.findUnique({ where: { id: postId } }) : null;

  const [replyRows, newsRows] = await Promise.all([
    postId
      ? prisma.post.findMany({
          where: { parentId: postId, kind: "character", createdAt: { lte: cutoff } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: REEL.CANDIDATE_SCAN,
          include: { authorCharacter: true },
        })
      : Promise.resolve([] as PostRow[]),
    prisma.post.findMany({
      where: { personaId: persona.id, kind: "news", createdAt: { lte: cutoff } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: REEL.CANDIDATE_SCAN,
      include: { authorCharacter: true },
    }),
  ]);

  const rows: PostRow[] = [
    ...replyRows,
    // The press only earns a beat when it is reporting *this* moment (`metrics.causedBy`).
    ...newsRows.filter((r) => metricsCausedBy(r.metrics) === payload.cause),
  ];

  const candidates: Candidate[] = rows.flatMap((r) => {
    if (!r.authorCharacter) return [];
    const text = truncateToUnits(r.text, REEL.HOLD.reply.units);
    if (text.length === 0) return [];
    return [
      {
        handle: atHandle(r.authorCharacter.handle),
        displayName: r.authorCharacter.displayName,
        text,
        score: scoreCandidate(r, relFor(r.authorCharacter.handle)),
        at: r.createdAt.getTime(),
        id: r.id,
      },
    ];
  });

  /**
   * A moment that did not come from a post (a drama event) has no reply rows to score, but the card
   * froze the voices that were around it — so the reel falls back to those rather than to silence.
   */
  const fallback: Candidate[] =
    candidates.length > 0
      ? []
      : payload.reactions.map((r, i) => ({
          handle: r.handle,
          displayName: r.displayName,
          text: truncateToUnits(r.text, REEL.HOLD.reply.units),
          score: payload.reactions.length - i,
          at: i,
          id: String(i),
        }));

  const chosen = rank(candidates.length > 0 ? candidates : fallback);

  /* ---- the skeleton, in the order that puts the turn last ---- */

  const personaHandle = payload.persona.handle || atHandle(persona.handle);
  const personaName = payload.persona.displayName || persona.displayName;
  const worldTitle = localized(persona.world.title, locale);

  const drafts: Draft[] = [];
  const push = (kind: keyof typeof REEL.HOLD, raw: string, extra: Partial<Draft> = {}): void => {
    const s = shape(kind, raw);
    if (s.text.length === 0) return;
    drafts.push({ kind, text: s.text, holdMs: s.holdMs, handle: null, displayName: null, delta: null, ...extra });
  };

  // 1. Where are we. A stranger on TikTok has never heard of this world.
  push("setup", localized(persona.world.scenario, locale) || worldTitle);
  // 2. What the player did. For an event moment there is no post, and the reel skips straight to
  //    the reactions rather than inventing one.
  if (playerPost) push("post", playerPost.text, { handle: personaHandle, displayName: personaName });
  // 3. The reactions, quietest first: the sharpest one hands off to the number.
  const ascending = [...chosen].reverse();
  const skeletonMs =
    drafts.reduce((sum, d) => sum + d.holdMs, 0) +
    REEL.HOLD.stat.min +
    REEL.HOLD.outro.min +
    shape("headline", moment.headline).holdMs;
  let spent = skeletonMs;
  for (const c of ascending) {
    const hold = clamp(Math.round(readMs(c.text)), REEL.HOLD.reply.min, REEL.HOLD.reply.max);
    const room = REEL.MAX_MS - spent;
    if (room < REEL.HOLD.reply.min) break;
    const fitted = Math.min(hold, room);
    drafts.push({
      kind: "reply",
      text: c.text,
      holdMs: fitted,
      handle: c.handle,
      displayName: c.displayName,
      delta: null,
    });
    spent += fitted;
  }
  // 4. The punchline.
  drafts.push({
    kind: "stat",
    text: statLine(locale, payload.deltas),
    holdMs: REEL.HOLD.stat.min,
    handle: personaHandle,
    displayName: personaName,
    delta: payload.deltas,
  });
  // 5. What it meant, and 6. whose world it was.
  push("headline", moment.headline);
  push("outro", worldTitle);

  const { beats, durationMs } = layout(drafts);
  const creator = persona.world.createdBy
    ? await prisma.user.findUnique({ where: { id: persona.world.createdBy }, select: { creatorHandle: true } })
    : null;

  return {
    slug: moment.shareSlug,
    worldTitle,
    worldSlug: persona.world.slug,
    personaHandle,
    creatorHandle: creator?.creatorHandle ?? null,
    durationMs,
    beats,
  };
}
