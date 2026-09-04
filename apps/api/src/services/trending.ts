import type { Persona, PrismaClient } from "@prisma/client";
import type { z } from "zod";
import { hashString, type TrendingResZ } from "@rpgllm/shared";
import { atHandle } from "./handles";

export type ApiTrending = z.infer<typeof TrendingResZ>;
export type ApiTopic = ApiTrending["topics"][number];
export type ApiRising = ApiTrending["risingCharacters"][number];

/**
 * The heat curve from `services/heat.ts`, written once in SQL so trending never has to load rows
 * into JS to rank them. `$2` is the injectable clock's `now`, never `now()`, so `/__test/time-travel`
 * keeps working. Falls back to the computed value when the stored column was never stamped.
 */
const SQL_HEAT = `
  LEAST(100, GREATEST(0, ROUND(
    100 * ln(1
      + COALESCE(NULLIF(p."metrics"->>'likes', '')::numeric, 0)
      + 3 * COALESCE(NULLIF(p."metrics"->>'reposts', '')::numeric, 0)
      + 5 * COALESCE(NULLIF(p."metrics"->>'replies', '')::numeric, 0)
    ) / ln(5001)
    * (1 - LEAST(1, GREATEST(0, EXTRACT(EPOCH FROM ($2::timestamptz - p."createdAt")) / 3600) / 48) * 0.35)
    + CASE WHEN p."kind" = 'news' THEN 12 ELSE 0 END
  )))::int`;

/** How many recent posts feed the topic extractor. Bounded so the query cost never grows with a world. */
const TOPIC_WINDOW = 120;
const MAX_TOPICS = 8;
const MAX_RISING = 6;
/** Affinity movement inside this window counts as "rising". */
const RISING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

interface HotRow { id: string; text: string; kind: string; heat: number }

/**
 * Stop words. Deliberately small and hand-written: the extractor only has to stop the feed from
 * trending on "the" — anything cleverer would stop being deterministic.
 */
const STOP = new Set([
  "about", "after", "again", "against", "album", "also", "always", "and", "another", "any", "are",
  "aren", "back", "because", "been", "before", "being", "both", "but", "can", "cant", "come",
  "could", "did", "didn", "does", "doesn", "doing", "done", "dont", "down", "even", "ever",
  "every", "for", "from", "get", "gets", "getting", "going", "gonna", "good", "got", "has",
  "have", "having", "her", "here", "hers", "him", "his", "how", "into", "isn", "issue", "its",
  "just", "keep", "know", "last", "let", "like", "little", "look", "made", "make", "many", "may",
  "might", "more", "most", "much", "must", "need", "never", "new", "next", "not", "now", "off",
  "once", "one", "only", "onto", "other", "our", "out", "over", "own", "part", "put", "really",
  "right", "said", "same", "say", "says", "see", "she", "should", "since", "some", "someone",
  "something", "still", "such", "sure", "take", "than", "that", "thats", "the", "their", "them",
  "then", "there", "these", "they", "thing", "things", "think", "this", "those", "though",
  "through", "time", "too", "two", "under", "until", "upon", "used", "very", "want", "was",
  "wasn", "way", "well", "went", "were", "what", "when", "where", "which", "while", "who", "why",
  "will", "with", "won", "would", "yeah", "you", "your", "youre",
]);

const words = (text: string): string[] =>
  text
    .replace(/https?:\/\/\S+/g, " ")
    .split(/[^\p{L}\p{N}#’'-]+/u)
    .map((w) => w.replace(/^[’'-]+|[’'-]+$/g, ""))
    .filter((w) => w.length > 0);

/** Contractions ("that's", "don't", "we're") are grammar, not subjects. */
const isStop = (w: string): boolean =>
  STOP.has(w.toLowerCase()) || w.length < 4 || /['’]/.test(w);
const key = (label: string): string => label.toLowerCase().replace(/\s+/g, " ").trim();

interface Candidate { label: string; posts: Set<string>; heat: number; hottest: string | null }

function bump(map: Map<string, Candidate>, label: string, row: HotRow): void {
  const k = key(label);
  if (k.length === 0) return;
  const existing = map.get(k);
  if (existing) {
    existing.posts.add(row.id);
    if (row.heat > existing.heat) { existing.heat = row.heat; existing.hottest = row.id; }
    return;
  }
  map.set(k, { label, posts: new Set([row.id]), heat: row.heat, hottest: row.id });
}

/**
 * What the world is talking about, from the text of its recent posts alone: hashtags, capitalised
 * phrases (names, titles, places) and word pairs that show up in more than one post. No model call,
 * no state — the same rows always produce the same strip.
 */
export function extractTopics(rows: HotRow[], limit = MAX_TOPICS): ApiTopic[] {
  const tags = new Map<string, Candidate>();
  const phrases = new Map<string, Candidate>();
  const pairs = new Map<string, Candidate>();
  const singles = new Map<string, Candidate>();

  for (const row of rows) {
    const ws = words(row.text);
    let run: string[] = [];
    for (const [i, w] of ws.entries()) {
      if (w.startsWith("#") && w.length > 2) bump(tags, w, row);

      // A capitalised run that is not just the first word of the post reads as a name or a title.
      const capitalised = /^\p{Lu}/u.test(w) && !isStop(w);
      if (capitalised && i > 0) run.push(w);
      else {
        // Only multi-word runs count as a name or a title. A lone capitalised word mid-sentence is
        // usually an accident ("File", "Sunday"); if it matters it still surfaces as a bare word.
        if (run.length >= 2) bump(phrases, run.slice(0, 3).join(" "), row);
        run = [];
      }

      const next = ws[i + 1];
      if (next && !isStop(w) && !isStop(next) && !w.startsWith("#") && !next.startsWith("#")) {
        bump(pairs, `${w} ${next}`, row);
      }
      if (!isStop(w) && !w.startsWith("#")) bump(singles, w, row);
    }
    if (run.length >= 2) bump(phrases, run.slice(0, 3).join(" "), row);
  }

  // Tiers, most informative first: a hashtag beats a name, a name beats a word pair, a word pair
  // beats a bare word. Sorting happens inside a tier so "second chorus" always wins over "chorus".
  const pick = (map: Map<string, Candidate>, minPosts: number): Candidate[] =>
    [...map.values()]
      .filter((c) => c.posts.size >= minPosts)
      .sort((a, b) => b.posts.size - a.posts.size || b.heat - a.heat || key(a.label).localeCompare(key(b.label)));

  const ranked = [
    ...pick(tags, 1),
    ...pick(phrases, 2),
    ...pick(pairs, 2),
    ...pick(singles, 2),
  ];

  const seen = new Set<string>();
  const out: ApiTopic[] = [];
  for (const c of ranked) {
    const k = key(c.label);
    // "second chorus" already covers "chorus": a topic contained in one we kept adds no information.
    if (seen.has(k) || [...seen].some((s) => s.includes(k) || k.includes(s))) continue;
    seen.add(k);
    out.push({ label: c.label, posts: c.posts.size, heat: c.heat, postId: c.hottest });
    if (out.length >= limit) break;
  }
  return out;
}

/** The recent feed, hottest first, ready for the extractor. */
export async function hotPosts(
  prisma: PrismaClient,
  personaId: string,
  now: Date,
  blockedIds: readonly string[] = [],
  limit = TOPIC_WINDOW,
): Promise<HotRow[]> {
  return await prisma.$queryRawUnsafe<HotRow[]>(
    `SELECT p."id", p."text", p."kind"::text AS kind,
            GREATEST(COALESCE(p."heat", 0), ${SQL_HEAT}) AS heat
       FROM "Post" p
      WHERE p."personaId" = $1
        AND (p."authorCharacterId" IS NULL OR NOT (p."authorCharacterId" = ANY($3::text[])))
      ORDER BY p."createdAt" DESC
      LIMIT ${limit}`,
    personaId,
    now,
    [...blockedIds],
  );
}

interface DeltaRow { handle: string; delta: number }

/**
 * Who moved toward (or away from) you lately. `StatSnapshot.relDeltas` is
 * `{deltas: {handle: ±1}, after: {...}}` (see serialize.ts) — summed in SQL with `jsonb_each_text`
 * rather than by reading every snapshot into memory.
 */
export async function affinityDeltas(prisma: PrismaClient, personaId: string, since: Date): Promise<DeltaRow[]> {
  return await prisma.$queryRawUnsafe<DeltaRow[]>(
    `SELECT kv.key AS handle, SUM(kv.value::int)::int AS delta
       FROM "StatSnapshot" s,
            LATERAL jsonb_each_text(
              CASE WHEN jsonb_exists(s."relDeltas", 'deltas') THEN s."relDeltas"->'deltas' ELSE s."relDeltas" END
            ) AS kv(key, value)
      WHERE s."personaId" = $1
        AND s."createdAt" >= $2
        AND kv.value ~ '^-?[0-9]+$'
      GROUP BY kv.key`,
    personaId,
    since,
  );
}

export async function risingCharacters(
  prisma: PrismaClient,
  persona: Persona,
  now: Date,
  blockedIds: readonly string[] = [],
): Promise<ApiRising[]> {
  const [deltas, relationships] = await Promise.all([
    affinityDeltas(prisma, persona.id, new Date(now.getTime() - RISING_WINDOW_MS)),
    prisma.relationshipState.findMany({
      where: { personaId: persona.id, ...(blockedIds.length ? { characterId: { notIn: [...blockedIds] } } : {}) },
      include: { character: true },
    }),
  ]);
  const byHandle = new Map(deltas.map((d) => [atHandle(d.handle), d.delta]));
  return relationships
    .map((rel): ApiRising => ({
      handle: atHandle(rel.character.handle),
      displayName: rel.character.displayName,
      avatarUrl: rel.character.avatarUrl,
      affinity: rel.affinity,
      delta: byHandle.get(atHandle(rel.character.handle)) ?? 0,
    }))
    .sort((a, b) => b.delta - a.delta || b.affinity - a.affinity || a.handle.localeCompare(b.handle))
    .slice(0, MAX_RISING);
}

/**
 * The follower count a cast member is understood to have. Characters have no `followers` column and
 * no reason to: the number is flavour, and flavour that is a pure function of the handle is stable
 * on every device and free to compute. Press accounts are the loudest voices in any world.
 */
export function castFollowers(handle: string, isPressAccount: boolean): number {
  const h = hashString(atHandle(handle));
  const base = 4_000 + (h % 900_000);
  return Math.round(isPressAccount ? base * 2.5 + 250_000 : base);
}

export interface Rank { percentile: number; followers: number; trending: boolean }

/**
 * The crowd every world is assumed to contain: the unnamed accounts a real network is mostly made
 * of. Their follower counts follow a power law (`P(X > f) = (FLOOR/f)^ALPHA`), which is how account
 * sizes actually distribute — so "top 12%" means something and improves as you grow, instead of
 * reading "top 100%" forever because the eight named characters are all famous.
 */
const CROWD = 10_000;
const CROWD_FLOOR = 50;
const CROWD_ALPHA = 0.8;

export function crowdAbove(followers: number): number {
  if (followers <= CROWD_FLOOR) return Math.round(CROWD * 0.94);
  return Math.round(CROWD * Math.pow(CROWD_FLOOR / followers, CROWD_ALPHA));
}

/** At or above this percentile you are one of the loudest accounts in the world. */
const TRENDING_AT = 25;

/**
 * Where you sit in this world: the crowd above, plus the cast (whose flavour follower counts come
 * from `castFollowers`), plus every other player persona in the world (counted in SQL).
 * `percentile` is "top N%", so 1 is the biggest account in the world.
 */
export async function rankOf(prisma: PrismaClient, persona: Persona): Promise<Rank> {
  const [personas] = await prisma.$queryRawUnsafe<{ total: number; above: number }[]>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE p."followers" > $2)::int AS above
       FROM "Persona" p
      WHERE p."worldId" = $1 AND p."id" <> $3`,
    persona.worldId,
    persona.followers,
    persona.id,
  );
  const cast = await prisma.worldCharacter.findMany({
    where: { worldId: persona.worldId },
    select: { handle: true, isPressAccount: true },
  });
  const castAbove = cast.filter((c) => castFollowers(c.handle, c.isPressAccount) > persona.followers).length;

  const total = (personas?.total ?? 0) + cast.length + CROWD + 1;
  const above = (personas?.above ?? 0) + castAbove + crowdAbove(persona.followers);
  const percentile = Math.min(100, Math.max(1, Math.round((100 * (above + 1)) / total)));
  return { percentile, followers: persona.followers, trending: percentile <= TRENDING_AT };
}

export async function trendingFor(
  prisma: PrismaClient,
  persona: Persona,
  now: Date,
  blockedIds: readonly string[] = [],
): Promise<ApiTrending> {
  const [rows, rising, yourRank] = await Promise.all([
    hotPosts(prisma, persona.id, now, blockedIds),
    risingCharacters(prisma, persona, now, blockedIds),
    rankOf(prisma, persona),
  ]);
  return { topics: extractTopics(rows), risingCharacters: rising, yourRank };
}
