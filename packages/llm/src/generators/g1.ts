import { G1OutputZ, type G1Input, type G1Output } from "@rpgllm/shared";
import { GLOBAL_STYLE } from "../prompts/global.js";
import {
  clamp,
  joinSections,
  renderCastRoster,
  renderFeed,
  renderPersona,
  renderRelationships,
  section,
  yesNo,
  type RenderedPrompt,
} from "../prompts/render.js";
import { pick } from "../tokens.js";
import { worldSeed } from "../worlds/index.js";
import type { GeneratorSpec } from "../types.js";

/** AIF-009 — Reaction Fan-out. One call per player action; absorbs G3/G6 and most of G7. */

const TASK: Record<string, string> = {
  en: `# TASK — REACTION FAN-OUT
The player just posted. Produce, as one JSON object:
1. \`replies\`: exactly K in-character replies from DIFFERENT cast handles, newest social-feed
   energy, each <= 280 characters and <= 2 emoji. They react to THIS post, not to the player in
   general. At least one reply must quote or name something specific from the post text.
2. \`stat_deltas\`: how this post moved followers / aura / humor. Small numbers are correct
   (1-3 is typical). Follow the world's "HOW THE NUMBERS MOVE" section.
3. \`narrative\`: one or two sentences, <= 240 characters, third person, describing what the feed
   did. Never address the player as "you"... use the same register as the world's stat cards.
4. \`relationship_deltas\`: -1 / 0 / +1 for the handles that actually reacted. Omit everyone else.
5. \`memory_notes\`: 0-4 short notes (<= 200 chars), each attributed to a cast handle, recording
   what that character should remember about the player after this.
6. \`news\`: only when NEWS is requested below, and only ever in the press account's voice.
   Otherwise null.
7. \`safety_flag\`: true if the post pushed against the safety rules and the characters had to
   deflect.`,
  ja: `# タスク — リアクション・ファンアウト
プレイヤーが今投稿した。以下を1つのJSONオブジェクトとして出力する。
1. \`replies\`: 異なるキャストのハンドルから、キャラクターに忠実な返信をちょうどK件。
   SNSの速度で、各280文字以内、絵文字2個以内。プレイヤー一般ではなく「この投稿」に反応する。
   最低1件は投稿本文の具体的な語を引用するか名指しすること。
2. \`stat_deltas\`: この投稿が followers / aura / humor をどう動かしたか。小さい数字が正しい
   (1〜3が標準)。世界設定の「数値の動き方」に従う。
3. \`narrative\`: 1〜2文、240文字以内、三人称。フィードで何が起きたかを書く。
   プレイヤーに「あなた」と呼びかけない。世界設定のスタッツカードと同じ語り口で。
4. \`relationship_deltas\`: 実際に反応したハンドルについて -1 / 0 / +1。それ以外は含めない。
5. \`memory_notes\`: 0〜4件の短いメモ(200文字以内)。それぞれキャストのハンドルに紐づけ、
   そのキャラがこの件についてプレイヤーについて憶えておくべきことを書く。
6. \`news\`: 下で NEWS が要求されたときのみ、press アカウントの声で書く。それ以外は null。
7. \`safety_flag\`: 投稿が安全ルールに触れ、キャラがかわす必要があったときに true。`,
};

function renderUser(input: G1Input): string {
  const parts: Array<string | null> = [
    TASK[input.locale] ?? TASK.en ?? "",
    section("PLAYER PERSONA", renderPersona(input.persona)),
    section("CAST — ONLY THESE HANDLES MAY REPLY", renderCastRoster(input.cast)),
    section("RELATIONSHIPS IN PLAY", renderRelationships(input.involved)),
    section("RECENT FEED (oldest first)", renderFeed(input.recentFeed)),
    section(
      "THE POST",
      input.post.parentAuthorHandle === null
        ? `new post by ${input.persona.handle}:\n"""\n${clamp(input.post.text, 1000)}\n"""`
        : `reply by ${input.persona.handle} to ${input.post.parentAuthorHandle}:\nparent: "${clamp(input.post.parentText ?? "", 300)}"\n"""\n${clamp(input.post.text, 1000)}\n"""`,
    ),
    section(
      "PARAMETERS",
      [
        `k (number of replies): ${input.k}`,
        `seed (vary word choice deterministically): ${input.seed}`,
        `softened (safety gate asked for deflection): ${yesNo(input.softened)}`,
        `news requested: ${yesNo(input.includeNews)}`,
        `player is a minor: ${yesNo(input.isMinor)}`,
      ].join("\n"),
    ),
  ];
  return joinSections(parts);
}

function knownHandles(input: G1Input): Set<string> {
  return new Set(input.cast.map((c) => c.handle));
}

function pressHandle(input: G1Input): string | null {
  return input.cast.find((c) => c.isPressAccount)?.handle ?? null;
}

/** Reply candidates in a stable order: involved first, then the rest of the cast, press last. */
export function replyCandidates(input: G1Input): string[] {
  const known = knownHandles(input);
  const involved = input.involved.map((r) => r.handle).filter((h) => known.has(h));
  const press = pressHandle(input);
  const rest = input.cast
    .filter((c) => !c.isPressAccount && !involved.includes(c.handle))
    .map((c) => c.handle);
  const ordered = [...involved, ...rest];
  return press !== null && input.includeNews ? [...ordered, press] : ordered;
}

function clampStat(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

const g1Spec: GeneratorSpec<G1Input, G1Output> = {
  id: "G1",
  maxTokens: 1200,
  defaultTier: "mid",
  schema: G1OutputZ,

  render(input: G1Input): RenderedPrompt {
    return { system: [GLOBAL_STYLE[input.locale], input.worldBible], user: renderUser(input) };
  },

  /** Deterministic canned replies, zero deltas. The API refunds energy when this is used. */
  fallback(input: G1Input): G1Output {
    const seed = worldSeed(input.worldSlug);
    const candidates = replyCandidates(input).filter(
      (h) => !input.cast.find((c) => c.handle === h)?.isPressAccount,
    );
    const chosen = candidates.slice(0, Math.max(1, Math.min(input.k, candidates.length)));
    const replies = chosen.map((handle, i) => {
      const lines = seed?.fallbackReplies[handle]?.[input.locale] ?? [];
      const text = lines[pick(Math.max(lines.length, 1), input.seed, handle, i)] ?? "...";
      return { characterHandle: handle, text: clamp(text, 280) };
    });
    return {
      replies: replies.length > 0 ? replies : [{ characterHandle: candidates[0] ?? "@unknown", text: "..." }],
      stat_deltas: { followers: 0, aura: 0, humor: 0 },
      narrative: input.locale === "ja" ? "フィードは静かなままだった。" : "The feed stayed quiet.",
      relationship_deltas: {},
      memory_notes: [],
      news: null,
      safety_flag: false,
    };
  },

  /** Drop unknown handles, clamp every length, guarantee at least one reply. */
  postprocess(raw: G1Output, input: G1Input): G1Output | null {
    const known = knownHandles(input);
    const seen = new Set<string>();
    const replies = raw.replies
      .filter((r) => known.has(r.characterHandle))
      .filter((r) => {
        if (seen.has(r.characterHandle)) return false;
        seen.add(r.characterHandle);
        return true;
      })
      .map((r) => ({ characterHandle: r.characterHandle, text: clamp(r.text, 280) }))
      .filter((r) => r.text.length > 0)
      .slice(0, 4);
    if (replies.length === 0) return null;

    const relationship_deltas: G1Output["relationship_deltas"] = {};
    for (const handle of Object.keys(raw.relationship_deltas).sort()) {
      if (!known.has(handle)) continue;
      const v = raw.relationship_deltas[handle];
      if (v === -1 || v === 0 || v === 1) relationship_deltas[handle] = v;
    }

    return {
      replies,
      stat_deltas: {
        followers: clampStat(raw.stat_deltas.followers, -50, 50),
        aura: clampStat(raw.stat_deltas.aura, -10, 10),
        humor: clampStat(raw.stat_deltas.humor, -10, 10),
      },
      narrative: clamp(raw.narrative, 240),
      relationship_deltas,
      memory_notes: raw.memory_notes
        .filter((n) => known.has(n.handle))
        .map((n) => ({ handle: n.handle, note: clamp(n.note, 200) }))
        .slice(0, 4),
      news: raw.news === null ? null : { text: clamp(raw.news.text, 280) },
      safety_flag: raw.safety_flag === true,
    };
  },
};

export const g1 = g1Spec;
