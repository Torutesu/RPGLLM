import type {
  G1Input,
  G1Output,
  G4Input,
  G4Output,
  G5Input,
  G5Output,
  G7Input,
  G7Output,
  G8Input,
  G8Output,
  Locale,
} from "@rpgllm/shared";
import { characterFixture, worldFixture, NEGATIVE_BUCKETS, POSITIVE_BUCKETS } from "../fixtures/index.js";
import { classifyOffline } from "../generators/g8.js";
import { foldNotes } from "../generators/g7.js";
import { presetToOutput } from "../generators/g5.js";
import { g1, replyCandidates } from "../generators/g1.js";
import { clamp } from "../prompts/render.js";
import { pick } from "../tokens.js";
import { worldSeed } from "../worlds/index.js";

/**
 * Replay mode (LLM_MODE=replay) — the default everywhere except production.
 *
 * Everything here is a pure function of (worldSlug, locale, seed, input text). Same input ->
 * byte-identical output; a different seed -> a different reply. No network, no clock, no random.
 * The gateway is what simulates `usage`, cost and latency on top of these outputs.
 */

const NEGATIVE_TERMS: readonly string[] = [
  "diss",
  "leak",
  "cancel",
  "beef",
  "drag",
  "flop",
  "ratio",
  "expose",
  "sue",
  "quit",
  "hate",
  "fight",
  "sorry",
  "over",
  "リーク",
  "流出",
  "炎上",
  "ディス",
  "終わった",
  "最悪",
  "嫌い",
  "叩か",
  "晒",
  "訴え",
  "辞め",
  "干さ",
  "謝罪",
];

/** Sentiment is a keyword heuristic on purpose: it must be explainable and stable in tests. */
export function isNegative(text: string): boolean {
  const haystack = text.toLowerCase();
  return NEGATIVE_TERMS.some((t) => haystack.includes(t.toLowerCase()));
}

function lineFor(
  slug: string,
  locale: Locale,
  handle: string,
  negative: boolean,
  seed: number,
  index: number,
  postText: string,
): string | null {
  const cf = characterFixture(slug, handle);
  if (cf === undefined) return null;
  const buckets = cf.replies[locale];
  const wanted = negative ? NEGATIVE_BUCKETS : POSITIVE_BUCKETS;
  const bucketIndex = wanted[pick(wanted.length, seed, postText, handle, index)] ?? 0;
  const lines = buckets[bucketIndex] ?? buckets[0] ?? [];
  if (lines.length === 0) return null;
  return lines[pick(lines.length, seed, postText, handle, index, "line")] ?? null;
}

export function replayG1(input: G1Input): G1Output {
  const fixture = worldFixture(input.worldSlug);
  const seedWorld = worldSeed(input.worldSlug);
  const press = input.cast.find((c) => c.isPressAccount)?.handle ?? null;
  const candidates = replyCandidates(input).filter((h) => h !== press);
  if (fixture === undefined || candidates.length === 0) return g1.fallback(input);

  const negative = isNegative(input.post.text);
  const k = Math.max(1, Math.min(input.k, 4, candidates.length));

  const replies: G1Output["replies"] = [];
  for (let i = 0; i < k; i += 1) {
    const handle = candidates[i];
    if (handle === undefined) break;
    const text =
      lineFor(input.worldSlug, input.locale, handle, negative, input.seed, i, input.post.text) ??
      seedWorld?.fallbackReplies[handle]?.[input.locale]?.[
        pick(5, input.seed, handle, i)
      ] ??
      "...";
    replies.push({ characterHandle: handle, text: clamp(text, 280) });
  }
  if (replies.length === 0) return g1.fallback(input);

  const magnitude = pick(4, input.seed, input.post.text, "mag");
  const stat_deltas = negative
    ? {
        followers: -(1 + magnitude),
        aura: -(1 + pick(3, input.seed, input.post.text, "aura")),
        humor: -pick(2, input.seed, input.post.text, "humor"),
      }
    : {
        followers: 1 + magnitude,
        aura: pick(4, input.seed, input.post.text, "aura"),
        humor: pick(4, input.seed, input.post.text, "humor"),
      };
  if (input.softened) stat_deltas.aura -= 1;

  const relationship_deltas: G1Output["relationship_deltas"] = {};
  for (const [i, r] of replies.entries()) {
    const roll = pick(3, input.seed, r.characterHandle, i, "rel");
    relationship_deltas[r.characterHandle] = roll === 0 ? 0 : negative ? -1 : 1;
  }

  const memory_notes: G1Output["memory_notes"] = [];
  for (const [i, r] of replies.slice(0, 2).entries()) {
    const notes = characterFixture(input.worldSlug, r.characterHandle)?.memory[input.locale] ?? [];
    const note = notes[pick(Math.max(notes.length, 1), input.seed, r.characterHandle, i, "mem")];
    if (note !== undefined) memory_notes.push({ handle: r.characterHandle, note: clamp(note, 200) });
  }

  const newsPool = fixture.news[input.locale];
  const news =
    input.includeNews && press !== null && newsPool.length > 0
      ? { text: clamp(newsPool[pick(newsPool.length, input.seed, input.post.text, "news")] ?? "", 280) }
      : null;

  const narrativePool = fixture.narratives[input.locale];
  const narrative =
    narrativePool[pick(Math.max(narrativePool.length, 1), input.seed, input.post.text, "narr")] ?? "";

  return {
    replies,
    stat_deltas,
    narrative: clamp(narrative, 240),
    relationship_deltas,
    memory_notes,
    news,
    safety_flag: input.softened,
  };
}

export function replayG4(input: G4Input): G4Output {
  const cf = characterFixture(input.worldSlug, input.character.handle);
  const sets = cf?.dm[input.locale] ?? [];
  if (sets.length === 0) return { ...g4Fallback(input) };

  const set = sets[pick(sets.length, input.seed, input.message, input.character.handle)] ?? [];
  const bubbles = set.map((b) => clamp(b, 160)).filter((b) => b.length > 0).slice(0, 3);
  if (bubbles.length === 0) return { ...g4Fallback(input) };

  const negative = isNegative(input.message);
  const roll = pick(4, input.seed, input.message, "aff");
  const affinity_delta = negative ? -1 : roll === 0 ? 2 : 1; // never 0: every exchange moves the relationship (E2E-006)

  const notes = cf?.memory[input.locale] ?? [];
  const memory_note =
    notes.length > 0
      ? clamp(notes[pick(notes.length, input.seed, input.message, "mem")] ?? "", 200)
      : null;

  return { bubbles, affinity_delta, memory_note, safety_flag: input.softened };
}

function g4Fallback(input: G4Input): G4Output {
  const seed = worldSeed(input.worldSlug);
  const lines = seed?.fallbackReplies[input.character.handle]?.[input.locale] ?? [];
  const text = lines[pick(Math.max(lines.length, 1), input.seed, input.character.handle)] ?? "...";
  return { bubbles: [clamp(text, 160)], affinity_delta: 0, memory_note: null, safety_flag: input.softened };
}

export function replayG5(input: G5Input): G5Output {
  const seed = worldSeed(input.worldSlug);
  const fixture = worldFixture(input.worldSlug);
  const pool = [...(seed?.presetEvents ?? []), ...(fixture?.extraEvents ?? [])];
  if (pool.length === 0) return g5Fallback(input);

  const used = new Set(input.pastEventTitles);
  const unused = pool.filter((p) => !used.has(p.title[input.locale]) && !used.has(p.title.en));
  const usable = unused.length > 0 ? unused : pool;
  const chosen = usable[pick(usable.length, input.seed, input.worldSlug, input.persona.handle)];
  if (chosen === undefined) return g5Fallback(input);

  const out = presetToOutput(chosen, input.locale);
  // Attach a relationship delta to the boldest choice so the event moves something.
  const rels = input.relationships.map((r) => r.handle);
  const target = rels[pick(Math.max(rels.length, 1), input.seed, out.title)];
  if (target !== undefined) {
    const first = out.choices[0];
    if (first !== undefined) first.relationshipDeltas[target] = 1;
    const last = out.choices[2];
    if (last !== undefined) last.relationshipDeltas[target] = -1;
  }
  return out;
}

function g5Fallback(input: G5Input): G5Output {
  // Delegates to the generator's own preset draw (which handles the empty-world case).
  // Imported lazily to keep this module free of a cycle at load time.
  const seed = worldSeed(input.worldSlug);
  const presets = seed?.presetEvents ?? [];
  const chosen = presets[pick(Math.max(presets.length, 1), input.seed)];
  if (chosen === undefined) {
    return {
      title: input.locale === "ja" ? "静かな一日" : "A quiet day",
      prompt:
        input.locale === "ja"
          ? "何も起きない日がある。次に何をするかは、あなたが決める。"
          : "Some days nothing arrives. What happens next is still up to you.",
      choices: [0, 1, 2].map((i) => ({
        id: `c${i + 1}`,
        label:
          input.locale === "ja"
            ? (["投稿する", "様子を見る", "誰かに連絡する"][i] ?? "")
            : (["Post something", "Wait and watch", "Message someone"][i] ?? ""),
        outcomeText: input.locale === "ja" ? "小さな一日が過ぎた。" : "It was a small day, and it passed.",
        statDeltas: { followers: 0, aura: 0, humor: 0 },
        relationshipDeltas: {},
        newsText: null,
      })) as G5Output["choices"],
    };
  }
  return presetToOutput(chosen, input.locale);
}

export function replayG7(input: G7Input): G7Output {
  const relationships = input.relationships.map((r) => ({
    handle: r.handle,
    summary: foldNotes(r.oldSummary, r.notes, 600),
  }));
  const allNotes = input.relationships.flatMap((r) =>
    r.notes.map((n) => `${r.handle}: ${n}`),
  );
  return {
    relationships,
    worldSummary: foldNotes(input.persona.worldSummary, allNotes, 1600),
  };
}

export function replayG8(input: G8Input): G8Output {
  return classifyOffline(input);
}
