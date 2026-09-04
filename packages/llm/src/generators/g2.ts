import { z } from "zod";
import { BaseCtxZ, CharacterCardZ, type Locale } from "@rpgllm/shared";
import { GLOBAL_STYLE } from "../prompts/global.js";
import { clamp, joinSections, renderCastRoster, section, type RenderedPrompt } from "../prompts/render.js";
import { pick } from "../tokens.js";
import { worldSeed } from "../worlds/index.js";
import type { GeneratorSpec } from "../types.js";

/**
 * G2 — Ambient Feed (cost-architecture §3, §5.4).
 *
 * The world talking to itself: chatter that has nothing to do with the player. Nobody is waiting
 * on it, the pool is shared by every player of a public world, and it is refilled at night — which
 * is exactly the profile the Batch tier is for. `packages/shared` predates this generator, so its
 * schemas live here (they are additive; nothing in shared changed).
 */

export const G2InputZ = BaseCtxZ.extend({
  cast: z.array(CharacterCardZ),
  /** how many ambient posts this call should produce */
  n: z.number().int().min(1).max(12),
  /** texts already in the pool — the model must not repeat them */
  avoid: z.array(z.string()).max(40).default([]),
  seed: z.number().int(),
});
export type G2Input = z.infer<typeof G2InputZ>;

export const G2OutputZ = z.object({
  posts: z.array(z.object({ characterHandle: z.string(), text: z.string().max(280) })).min(1).max(12),
});
export type G2Output = z.infer<typeof G2OutputZ>;

const TASK: Record<string, string> = {
  en: `# TASK — AMBIENT CHATTER
Write N short posts from DIFFERENT cast handles about the world itself: rehearsals, weather,
rumours, food, sleep, the group chat. As one JSON object with \`posts\`.
Rules: the player does not exist in these posts — never address, name or imply them. Each post
<= 280 characters, <= 2 emoji, in that character's voice. No two posts may open the same way.
Never repeat anything under ALREADY IN THE POOL.`,
  ja: `# タスク — 環境ノイズ(雑談)
異なるキャストのハンドルから、世界そのものについての短い投稿を N 件書く。稽古、天気、噂、
食事、睡眠、グループチャット。\`posts\` を持つ1つのJSONで出力する。
規則: これらの投稿にプレイヤーは存在しない。呼びかけない、名指ししない、匂わせない。
各投稿280文字以内、絵文字2個以内、そのキャラの声で。書き出しが同じ投稿を2つ作らない。
「既にプールにあるもの」と同じ内容は書かない。`,
};

function renderUser(input: G2Input): string {
  return joinSections([
    TASK[input.locale] ?? TASK.en ?? "",
    section("CAST — ONLY THESE HANDLES MAY POST", renderCastRoster(input.cast)),
    section(
      "ALREADY IN THE POOL (do not repeat)",
      input.avoid.length === 0 ? "(empty)" : input.avoid.map((t) => `- ${clamp(t, 120)}`).join("\n"),
    ),
    section("PARAMETERS", [`n (number of posts): ${input.n}`, `seed: ${input.seed}`].join("\n")),
  ]);
}

/** The world's own seeded ambient pool, in a deterministic order for a given seed. */
export function ambientPoolFor(slug: string, locale: Locale): Array<{ handle: string; text: string }> {
  return [...(worldSeed(slug)?.ambientPool[locale] ?? [])];
}

const g2Spec: GeneratorSpec<G2Input, G2Output> = {
  id: "G2",
  maxTokens: 900,
  defaultTier: "light",
  schema: G2OutputZ,

  render(input: G2Input): RenderedPrompt {
    return { system: [GLOBAL_STYLE[input.locale], input.worldBible], user: renderUser(input) };
  },

  /** The pool the world shipped with. A failed refill degrades to "the world repeats itself". */
  fallback(input: G2Input): G2Output {
    const pool = ambientPoolFor(input.worldSlug, input.locale);
    const known = new Set(input.cast.map((c) => c.handle));
    const posts: G2Output["posts"] = [];
    for (let i = 0; i < input.n && pool.length > 0; i += 1) {
      const item = pool[pick(pool.length, input.seed, "fallback", i)];
      if (item === undefined) break;
      if (known.size > 0 && !known.has(item.handle)) continue;
      posts.push({ characterHandle: item.handle, text: clamp(item.text, 280) });
    }
    if (posts.length === 0) {
      const first = input.cast[0];
      posts.push({
        characterHandle: first?.handle ?? "unknown",
        text: input.locale === "ja" ? "今日はとくに何もない日。" : "nothing much happening today.",
      });
    }
    return { posts };
  },

  postprocess(raw: G2Output, input: G2Input): G2Output | null {
    const known = new Set(input.cast.map((c) => c.handle));
    const avoid = new Set(input.avoid.map((t) => t.trim()));
    const seen = new Set<string>();
    const posts = raw.posts
      .filter((p) => known.size === 0 || known.has(p.characterHandle))
      .map((p) => ({ characterHandle: p.characterHandle, text: clamp(p.text, 280) }))
      .filter((p) => p.text.length > 0 && !avoid.has(p.text))
      .filter((p) => {
        if (seen.has(p.text)) return false;
        seen.add(p.text);
        return true;
      })
      .slice(0, Math.max(1, input.n));
    if (posts.length === 0) return null;
    return { posts };
  },
};

export const g2 = g2Spec;
