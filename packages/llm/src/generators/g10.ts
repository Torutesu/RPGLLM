import { z } from "zod";
import { BaseCtxZ, CharacterCardZ, PersonaStateZ, RelationshipCtxZ } from "@rpgllm/shared";
import { GLOBAL_STYLE } from "../prompts/global.js";
import {
  clamp,
  joinSections,
  renderCastRoster,
  renderPersona,
  renderRelationships,
  section,
  type RenderedPrompt,
} from "../prompts/render.js";
import { pick } from "../tokens.js";
import { worldSeed } from "../worlds/index.js";
import type { GeneratorSpec } from "../types.js";

/**
 * G10 — Offline World Director (AIF-001, cost-architecture §3 / §5.4).
 *
 * "While you were away": what the world did in the player's absence, plus one DM and the digest
 * line the app shows on return. Nobody is waiting on it (the player is, by definition, away), so
 * it belongs on the Batch tier. Schemas live here — `packages/shared` is frozen.
 */

export const G10InputZ = BaseCtxZ.extend({
  persona: PersonaStateZ,
  cast: z.array(CharacterCardZ),
  relationships: z.array(RelationshipCtxZ).max(8),
  /** how long the player has been gone; the story should be proportional to it */
  hoursAway: z.number().int().min(1).max(720),
  seed: z.number().int(),
});
export type G10Input = z.infer<typeof G10InputZ>;

export const G10OutputZ = z.object({
  posts: z.array(z.object({ characterHandle: z.string(), text: z.string().max(280) })).min(1).max(5),
  dm: z
    .object({ characterHandle: z.string(), bubbles: z.array(z.string().max(160)).min(1).max(3) })
    .nullable(),
  digest: z.string().max(400),
});
export type G10Output = z.infer<typeof G10OutputZ>;

const TASK: Record<string, string> = {
  en: `# TASK — WHILE YOU WERE AWAY
The player has been offline. Move the world on without them. As one JSON object:
1. \`posts\`: 3-5 posts from different cast handles, in the order they happened, each <= 280
   characters. Something must actually change: a plan, a rumour, an alliance, a mistake.
2. \`dm\`: one direct message (1-3 bubbles, <= 160 characters each) from the character with the
   strongest relationship, written as if they noticed the silence. null if nobody would write.
3. \`digest\`: <= 400 characters, third person, the catch-up the player reads on return. Say what
   happened and what it means for them. No "you".`,
  ja: `# タスク — 不在中の世界
プレイヤーはオフラインだった。彼ら抜きで世界を進める。1つのJSONで:
1. \`posts\`: 異なるキャストのハンドルから3〜5件、起きた順に、各280文字以内。
   実際に何かが変わること: 計画、噂、同盟、失敗。
2. \`dm\`: 最も関係の強いキャラから、沈黙に気づいたようなDMを1通(バブル1〜3個、各160文字以内)。
   誰も書かないなら null。
3. \`digest\`: 400文字以内、三人称。復帰したプレイヤーが読む要約。何が起きて、それが本人に
   とって何を意味するか。「あなた」とは書かない。`,
};

function renderUser(input: G10Input): string {
  return joinSections([
    TASK[input.locale] ?? TASK.en ?? "",
    section("PLAYER PERSONA (absent)", renderPersona(input.persona)),
    section("CAST — ONLY THESE HANDLES MAY POST", renderCastRoster(input.cast)),
    section("RELATIONSHIPS", renderRelationships(input.relationships)),
    section(
      "PARAMETERS",
      [`hours away: ${input.hoursAway}`, `seed: ${input.seed}`].join("\n"),
    ),
  ]);
}

const g10Spec: GeneratorSpec<G10Input, G10Output> = {
  id: "G10",
  maxTokens: 1200,
  defaultTier: "mid",
  schema: G10OutputZ,

  render(input: G10Input): RenderedPrompt {
    return { system: [GLOBAL_STYLE[input.locale], input.worldBible], user: renderUser(input) };
  },

  /** A quiet-but-truthful digest: the world's own ambient lines, no invented events. */
  fallback(input: G10Input): G10Output {
    const pool = worldSeed(input.worldSlug)?.ambientPool[input.locale] ?? [];
    const posts: G10Output["posts"] = [];
    for (let i = 0; i < 3 && pool.length > 0; i += 1) {
      const item = pool[pick(pool.length, input.seed, "g10", i)];
      if (item === undefined) continue;
      posts.push({ characterHandle: item.handle, text: clamp(item.text, 280) });
    }
    if (posts.length === 0) {
      posts.push({
        characterHandle: input.cast[0]?.handle ?? "unknown",
        text: input.locale === "ja" ? "静かな数日だった。" : "it was a quiet couple of days.",
      });
    }
    return {
      posts,
      dm: null,
      digest:
        input.locale === "ja"
          ? "世界は静かに進んだ。大きな出来事はない。"
          : "The world moved on quietly. Nothing major happened.",
    };
  },

  postprocess(raw: G10Output, input: G10Input): G10Output | null {
    const known = new Set(input.cast.map((c) => c.handle));
    const posts = raw.posts
      .filter((p) => known.size === 0 || known.has(p.characterHandle))
      .map((p) => ({ characterHandle: p.characterHandle, text: clamp(p.text, 280) }))
      .filter((p) => p.text.length > 0)
      .slice(0, 5);
    if (posts.length === 0) return null;
    const dmHandle = raw.dm?.characterHandle;
    const bubbles = (raw.dm?.bubbles ?? []).map((b) => clamp(b, 160)).filter((b) => b.length > 0).slice(0, 3);
    const dm =
      dmHandle !== undefined && (known.size === 0 || known.has(dmHandle)) && bubbles.length > 0
        ? { characterHandle: dmHandle, bubbles }
        : null;
    return { posts, dm, digest: clamp(raw.digest, 400) };
  },
};

export const g10 = g10Spec;
