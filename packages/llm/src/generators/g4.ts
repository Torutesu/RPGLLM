import { G4OutputZ, type G4Input, type G4Output } from "@rpgllm/shared";
import { GLOBAL_STYLE } from "../prompts/global.js";
import {
  clamp,
  joinSections,
  renderCharacterCard,
  renderPersona,
  renderRelationships,
  section,
  yesNo,
  type RenderedPrompt,
} from "../prompts/render.js";
import { pick } from "../tokens.js";
import { worldSeed } from "../worlds/index.js";
import type { GeneratorSpec } from "../types.js";

/** AIF-010 — DM Turn. One character, one private thread. Quality matters more than G1 here. */

const TASK: Record<string, string> = {
  en: `# TASK — DIRECT MESSAGE TURN
You are exactly one character, replying privately to the player. Produce, as one JSON object:
1. \`bubbles\`: 1-3 message bubbles, each <= 160 characters, in the order they would arrive.
   A DM is not a post: it is quieter, more specific, and it can refer to things that would never
   be said on the public feed. Two short bubbles beat one long one. Do not open with a greeting
   unless the thread is empty.
2. \`affinity_delta\`: -2..2. How this exchange moved the relationship. 0 is the common case.
3. \`memory_note\`: <= 200 characters, or null. What this character will remember from this.
4. \`safety_flag\`: true if the message pushed against the safety rules and you deflected.
Never break character, never mention the app, never speak for the player.`,
  ja: `# タスク — DMのターン
あなたはただ一人のキャラクターとして、プレイヤーに私的に返信する。以下を1つのJSONで出力する。
1. \`bubbles\`: メッセージのバブルを1〜3個、各160文字以内、届く順に。
   DMは投稿ではない。もっと静かで、もっと具体的で、公開フィードでは絶対に言わないことを
   言える場所。短い2通は長い1通に勝る。スレッドが空でない限り挨拶から始めない。
2. \`affinity_delta\`: -2〜2。このやり取りで関係がどう動いたか。0が通常。
3. \`memory_note\`: 200文字以内、または null。このキャラが憶えておくこと。
4. \`safety_flag\`: メッセージが安全ルールに触れ、かわしたときに true。
キャラを崩さない。アプリに言及しない。プレイヤーの言葉を代弁しない。`,
};

function renderHistory(history: G4Input["history"], handle: string, playerHandle: string): string {
  if (history.length === 0) return "(no messages yet — this is the first exchange)";
  return history
    .map((m) => `${m.fromCharacter ? handle : playerHandle}: ${clamp(m.text, 200)}`)
    .join("\n");
}

function renderUser(input: G4Input): string {
  return joinSections([
    TASK[input.locale] ?? TASK.en ?? "",
    section("YOU ARE", renderCharacterCard(input.character)),
    section("THE PLAYER", renderPersona(input.persona, 300)),
    section("RELATIONSHIP", renderRelationships([input.relationship])),
    section(
      "THREAD (oldest first)",
      renderHistory(input.history, input.character.handle, input.persona.handle),
    ),
    section("NEW MESSAGE FROM THE PLAYER", `"""\n${clamp(input.message, 800)}\n"""`),
    section(
      "PARAMETERS",
      [
        `seed (vary word choice deterministically): ${input.seed}`,
        `softened (safety gate asked for deflection): ${yesNo(input.softened)}`,
        `player is a minor: ${yesNo(input.isMinor)}`,
      ].join("\n"),
    ),
  ]);
}

const g4Spec: GeneratorSpec<G4Input, G4Output> = {
  id: "G4",
  maxTokens: 400,
  defaultTier: "mid",
  schema: G4OutputZ,

  render(input: G4Input): RenderedPrompt {
    return { system: [GLOBAL_STYLE[input.locale], input.worldBible], user: renderUser(input) };
  },

  fallback(input: G4Input): G4Output {
    const seed = worldSeed(input.worldSlug);
    const lines = seed?.fallbackReplies[input.character.handle]?.[input.locale] ?? [];
    const text = lines[pick(Math.max(lines.length, 1), input.seed, input.character.handle)] ?? "...";
    return {
      bubbles: [clamp(text, 160)],
      affinity_delta: 0,
      memory_note: null,
      safety_flag: false,
    };
  },

  postprocess(raw: G4Output, _input: G4Input): G4Output | null {
    const bubbles = raw.bubbles
      .map((b) => clamp(b, 160))
      .filter((b) => b.length > 0)
      .slice(0, 3);
    if (bubbles.length === 0) return null;
    const delta = Number.isFinite(raw.affinity_delta) ? Math.round(raw.affinity_delta) : 0;
    return {
      bubbles,
      affinity_delta: Math.max(-2, Math.min(2, delta)),
      memory_note: raw.memory_note === null ? null : clamp(raw.memory_note, 200),
      safety_flag: raw.safety_flag === true,
    };
  },
};

export const g4 = g4Spec;
