import { G7OutputZ, type G7Input, type G7Output } from "@rpgllm/shared";
import { GLOBAL_STYLE } from "../prompts/global.js";
import { clamp, joinSections, renderPersona, section, type RenderedPrompt } from "../prompts/render.js";
import type { GeneratorSpec } from "../types.js";

/**
 * AIF-012 — Memory Consolidator. The compressor that stops us re-sending history every turn.
 * Failure here is invisible to the player: the old summary simply stays.
 */

const TASK: Record<string, string> = {
  en: `# TASK — MEMORY CONSOLIDATION
Fold the loose notes into the durable summaries. As one JSON object:
1. \`relationships\`: for every handle listed below, one summary <= 600 characters that merges the
   old summary with the new notes. Write it as that character's working model of the player:
   what happened between them, what the character believes, what is unresolved. Facts over
   adjectives. Drop anything the notes contradict. Keep names, numbers and specifics; those are
   what make a later reply feel remembered.
2. \`worldSummary\`: <= 1600 characters. The player's story so far, third person, in the order it
   happened. This is the only history later prompts will see, so keep causes, not moods.
Never invent events that are not in the notes or the old summaries.`,
  ja: `# タスク — 記憶の統合
散らばったメモを恒久的な要約に畳み込む。1つのJSONで:
1. \`relationships\`: 下に挙げた各ハンドルについて、旧要約と新しいメモを統合した600文字以内の
   要約を1つ。そのキャラが持つ「プレイヤー像」として書く。二人の間に何があったか、
   そのキャラが何を信じているか、何が未解決か。形容詞より事実。メモと矛盾するものは落とす。
   名前・数字・固有の細部は残す。後の返信が「憶えている」と感じられるのはそこ。
2. \`worldSummary\`: 1600文字以内。プレイヤーのここまでの物語を、起きた順に三人称で。
   以後のプロンプトが見る唯一の履歴なので、気分ではなく因果を残す。
メモにも旧要約にもない出来事を作らない。`,
};

function renderUser(input: G7Input): string {
  return joinSections([
    TASK[input.locale] ?? TASK.en ?? "",
    section("PLAYER PERSONA", renderPersona(input.persona, 1200)),
    section(
      "RELATIONSHIPS TO CONSOLIDATE",
      input.relationships.length === 0
        ? "(none)"
        : input.relationships
            .map(
              (r) =>
                `- ${r.handle} | affinity ${r.affinity}\n  old summary: ${clamp(r.oldSummary, 600) || "(none)"}\n  new notes:\n${r.notes.length === 0 ? "    (none)" : r.notes.map((n) => `    * ${clamp(n, 200)}`).join("\n")}`,
            )
            .join("\n"),
    ),
  ]);
}

/** Deterministic compressor used by replay mode and as the fallback shape. */
export function foldNotes(oldSummary: string, notes: readonly string[], max: number): string {
  const seen = new Set<string>();
  const pieces: string[] = [];
  for (const piece of [oldSummary, ...notes]) {
    const t = piece.trim().replace(/\s+/g, " ");
    if (t.length === 0 || seen.has(t)) continue;
    seen.add(t);
    pieces.push(t.endsWith(".") || t.endsWith("。") ? t : `${t}.`);
  }
  return clamp(pieces.join(" "), max);
}

const g7Spec: GeneratorSpec<G7Input, G7Output> = {
  id: "G7",
  maxTokens: 900,
  defaultTier: "light",
  schema: G7OutputZ,

  render(input: G7Input): RenderedPrompt {
    return { system: [GLOBAL_STYLE[input.locale], input.worldBible], user: renderUser(input) };
  },

  /** Keep the old summaries verbatim; the notes stay unconsolidated for the next attempt. */
  fallback(input: G7Input): G7Output {
    return {
      relationships: input.relationships.map((r) => ({
        handle: r.handle,
        summary: clamp(r.oldSummary, 600),
      })),
      worldSummary: clamp(input.persona.worldSummary, 1600),
    };
  },

  postprocess(raw: G7Output, input: G7Input): G7Output | null {
    const known = new Set(input.relationships.map((r) => r.handle));
    const relationships = raw.relationships
      .filter((r) => known.size === 0 || known.has(r.handle))
      .map((r) => ({ handle: r.handle, summary: clamp(r.summary, 600) }));
    return { relationships, worldSummary: clamp(raw.worldSummary, 1600) };
  },
};

export const g7 = g7Spec;
