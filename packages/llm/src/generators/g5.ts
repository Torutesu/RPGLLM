import { G5OutputZ, type G5Input, type G5Output, type Locale } from "@rpgllm/shared";
import { GLOBAL_STYLE } from "../prompts/global.js";
import {
  clamp,
  joinSections,
  renderPersona,
  renderRelationships,
  section,
  type RenderedPrompt,
} from "../prompts/render.js";
import { pick } from "../tokens.js";
import { worldSeed } from "../worlds/index.js";
import type { GeneratorSpec } from "../types.js";

/** AIF-011 — Drama Director. Low frequency, high quality: Opus 5 at effort "medium". */

const TASK: Record<string, string> = {
  en: `# TASK — DRAMA DIRECTOR
Write the next story beat for this player: one event with exactly three choices. As one JSON:
1. \`title\`: <= 80 characters. A name the feed would use for this, not a chapter heading.
2. \`prompt\`: <= 240 characters. The situation, in the present tense, ending on the decision the
   player has to make. Name at least one cast handle. Never address the player as "you" more
   than once.
3. \`choices\`: exactly three, each with:
   - \`id\`: a short stable slug, lowercase, no spaces.
   - \`label\`: <= 60 characters, an action, phrased the way the player would think it.
   - \`outcomeText\`: <= 240 characters. What actually happens. Concrete, in-world, and it should
     cost something. No choice is purely good.
   - \`statDeltas\`: followers -50..50, aura -10..10, humor -10..10. The three choices must not
     have the same shape: one bold, one careful, one sideways.
   - \`relationshipDeltas\`: -1 / 0 / +1 keyed by cast handle, only for characters involved.
   - \`newsText\`: <= 280 characters in the press account's voice, or null.
Do not repeat any past event title listed below, in wording or in premise.`,
  ja: `# タスク — ドラマ・ディレクター
このプレイヤーの次の物語の一節を書く。イベント1つと、ちょうど3つの選択肢。1つのJSONで:
1. \`title\`: 80文字以内。章題ではなく、フィードがこの件を呼ぶときの名前。
2. \`prompt\`: 240文字以内。現在形で状況を書き、プレイヤーが下すべき決断で終わる。
   キャストのハンドルを最低1つ名指しする。「あなた」は多くても1回。
3. \`choices\`: ちょうど3つ。各要素は:
   - \`id\`: 短く安定した英小文字のスラッグ、空白なし。
   - \`label\`: 60文字以内。行動。プレイヤーが心の中で思う言い方で。
   - \`outcomeText\`: 240文字以内。実際に起きること。具体的で、世界内で、必ず何かを失う。
     純粋に良いだけの選択肢は作らない。
   - \`statDeltas\`: followers -50〜50、aura -10〜10、humor -10〜10。3つの選択肢の形を
     揃えない。1つは大胆、1つは慎重、1つは斜め。
   - \`relationshipDeltas\`: キャストのハンドルをキーに -1 / 0 / +1。関与したキャラのみ。
   - \`newsText\`: press アカウントの声で280文字以内、または null。
下に列挙された既出イベントのタイトルを、文言でも筋でも繰り返さない。`,
};

function renderUser(input: G5Input): string {
  return joinSections([
    TASK[input.locale] ?? TASK.en ?? "",
    section("PLAYER PERSONA", renderPersona(input.persona)),
    section("ALL RELATIONSHIPS", renderRelationships(input.relationships, 150)),
    section(
      "RECENT BEATS (oldest first)",
      input.recentSnapshots.length === 0
        ? "(nothing yet)"
        : input.recentSnapshots
            .map(
              (s) =>
                `- ${clamp(s.narrative, 160)} [followers ${s.followersDelta >= 0 ? "+" : ""}${s.followersDelta}, aura ${s.auraDelta >= 0 ? "+" : ""}${s.auraDelta}, humor ${s.humorDelta >= 0 ? "+" : ""}${s.humorDelta}]`,
            )
            .join("\n"),
    ),
    section(
      "ALREADY USED — DO NOT REPEAT",
      input.pastEventTitles.length === 0 ? "(none)" : input.pastEventTitles.map((t) => `- ${t}`).join("\n"),
    ),
    section("PARAMETERS", `seed (vary the beat deterministically): ${input.seed}`),
  ]);
}

/** Turn a WorldSeed preset event into a G5 output for the given locale. */
export function presetToOutput(
  preset: {
    title: Record<Locale, string>;
    prompt: Record<Locale, string>;
    choices: Array<{
      label: Record<Locale, string>;
      outcomeText: Record<Locale, string>;
      statDeltas: { followers: number; aura: number; humor: number };
    }>;
  },
  locale: Locale,
): G5Output {
  return {
    title: clamp(preset.title[locale], 80),
    prompt: clamp(preset.prompt[locale], 240),
    choices: [0, 1, 2].map((i) => {
      const c = preset.choices[i] ?? preset.choices[0];
      return {
        id: `c${i + 1}`,
        label: clamp(c?.label[locale] ?? "", 60),
        outcomeText: clamp(c?.outcomeText[locale] ?? "", 240),
        statDeltas: c?.statDeltas ?? { followers: 0, aura: 0, humor: 0 },
        relationshipDeltas: {},
        newsText: null,
      };
    }) as G5Output["choices"],
  };
}

const g5Spec: GeneratorSpec<G5Input, G5Output> = {
  id: "G5",
  maxTokens: 2000,
  defaultTier: "high",
  schema: G5OutputZ,

  render(input: G5Input): RenderedPrompt {
    return { system: [GLOBAL_STYLE[input.locale], input.worldBible], user: renderUser(input) };
  },

  /** Draw an unused preset event; if all are used, reuse the least-recently-listed one. */
  fallback(input: G5Input): G5Output {
    const seed = worldSeed(input.worldSlug);
    const presets = seed?.presetEvents ?? [];
    if (presets.length === 0) {
      return {
        title: input.locale === "ja" ? "静かな一日" : "A quiet day",
        prompt:
          input.locale === "ja"
            ? "何も起きない日がある。次に何をするかは、あなたが決める。"
            : "Some days nothing arrives. What happens next is still up to you.",
        choices: [0, 1, 2].map((i) => ({
          id: `c${i + 1}`,
          label: input.locale === "ja" ? ["投稿する", "様子を見る", "誰かに連絡する"][i] ?? "" : ["Post something", "Wait and watch", "Message someone"][i] ?? "",
          outcomeText:
            input.locale === "ja" ? "小さな一日が過ぎた。" : "It was a small day, and it passed.",
          statDeltas: { followers: 0, aura: 0, humor: 0 },
          relationshipDeltas: {},
          newsText: null,
        })) as G5Output["choices"],
      };
    }
    const used = new Set(input.pastEventTitles);
    const unused = presets.filter((p) => !used.has(p.title[input.locale]) && !used.has(p.title.en));
    const pool = unused.length > 0 ? unused : presets;
    const chosen = pool[pick(pool.length, input.seed, input.worldSlug, input.persona.handle)];
    return presetToOutput(chosen ?? pool[0]!, input.locale);
  },

  postprocess(raw: G5Output, input: G5Input): G5Output | null {
    if (raw.choices.length !== 3) return null;
    const known = new Set(input.relationships.map((r) => r.handle));
    const choices = raw.choices.map((c, i) => {
      const rel: G5Output["choices"][number]["relationshipDeltas"] = {};
      for (const handle of Object.keys(c.relationshipDeltas).sort()) {
        if (known.size > 0 && !known.has(handle)) continue;
        const v = c.relationshipDeltas[handle];
        if (v === -1 || v === 0 || v === 1) rel[handle] = v;
      }
      return {
        id: c.id.trim().length > 0 ? c.id.trim() : `c${i + 1}`,
        label: clamp(c.label, 60),
        outcomeText: clamp(c.outcomeText, 240),
        statDeltas: {
          followers: Math.max(-50, Math.min(50, Math.round(c.statDeltas.followers))),
          aura: Math.max(-10, Math.min(10, Math.round(c.statDeltas.aura))),
          humor: Math.max(-10, Math.min(10, Math.round(c.statDeltas.humor))),
        },
        relationshipDeltas: rel,
        newsText: c.newsText === null ? null : clamp(c.newsText, 280),
      };
    }) as G5Output["choices"];
    const title = clamp(raw.title, 80);
    if (title.length === 0) return null;
    return { title, prompt: clamp(raw.prompt, 240), choices };
  },
};

export const g5 = g5Spec;
