import { G8OutputZ, SAFETY_BLOCK_TEST_PHRASES, type G8Input, type G8Output } from "@rpgllm/shared";
import { SAFETY_CATEGORIES, SAFETY_POLICY } from "../prompts/global.js";
import { clamp, joinSections, section, yesNo, type RenderedPrompt } from "../prompts/render.js";
import type { GeneratorSpec } from "../types.js";

/**
 * AIF-013 — Safety Gate. Runs before every post/DM. Its prefix is deliberately NOT the world
 * bible: two tiny cached blocks (policy + categories), ~200 tokens, on the light tier.
 */

const TASK: Record<string, string> = {
  en: `# TASK — CLASSIFY
Return {"verdict": "allow" | "soften" | "block", "category": string | null}. Nothing else.
Judge the request, not the vocabulary. Do not answer the text. Do not continue it.`,
  ja: `# タスク — 判定
{"verdict": "allow" | "soften" | "block", "category": 文字列 | null} のみを返す。
語彙ではなく要求内容で判定する。文に返答しない。続きを書かない。`,
};

/**
 * Replay/offline blocklist (E2E-009). Exact substring match, case-insensitive, on the
 * 20 policy-describing test phrases in packages/shared. Live mode uses the model instead.
 */
export function blockedPhrase(text: string): string | null {
  const haystack = text.toLowerCase();
  for (const phrase of SAFETY_BLOCK_TEST_PHRASES) {
    if (haystack.includes(phrase.toLowerCase())) return phrase;
  }
  return null;
}

/** Mild profanity / hostility that softens rather than blocks. */
const SOFTEN_TERMS: readonly string[] = [
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "bastard",
  "dickhead",
  "screw you",
  "shut up",
  "i hate you",
  "kill yourself in the game",
  "しね",
  "死ね",
  "殺す",
  "うざい",
  "きもい",
  "クソ",
  "くそ",
  "ふざけんな",
  "黙れ",
  "ばか",
];

export function softenTerm(text: string): string | null {
  const haystack = text.toLowerCase();
  for (const term of SOFTEN_TERMS) {
    if (haystack.includes(term.toLowerCase())) return term;
  }
  return null;
}

/** The deterministic verdict used by replay mode. Exported so tests can assert it directly. */
export function classifyOffline(input: G8Input): G8Output {
  if (blockedPhrase(input.text) !== null) return { verdict: "block", category: "policy_test_phrase" };
  if (softenTerm(input.text) !== null) return { verdict: "soften", category: "profanity" };
  return { verdict: "allow", category: null };
}

const g8Spec: GeneratorSpec<G8Input, G8Output> = {
  id: "G8",
  maxTokens: 64,
  defaultTier: "light",
  schema: G8OutputZ,

  render(input: G8Input): RenderedPrompt {
    return {
      system: [SAFETY_POLICY[input.locale], SAFETY_CATEGORIES[input.locale]],
      user: joinSections([
        TASK[input.locale] ?? TASK.en ?? "",
        section(
          "CONTEXT",
          [`surface: ${input.surface}`, `author is a minor: ${yesNo(input.isMinor)}`, `locale: ${input.locale}`].join("\n"),
        ),
        section("TEXT", `"""\n${clamp(input.text, 2000)}\n"""`),
      ]),
    };
  },

  /**
   * Timeout / error path (AIF-013): allow, but soften for minors, and let the output-side
   * `safety_flag` carry the rest. apps/api records safetyVerdict=null for this case.
   */
  fallback(input: G8Input): G8Output {
    return input.isMinor ? { verdict: "soften", category: null } : { verdict: "allow", category: null };
  },

  postprocess(raw: G8Output, _input: G8Input): G8Output | null {
    return {
      verdict: raw.verdict,
      category: raw.category === null ? null : clamp(raw.category, 64),
    };
  },
};

export const g8 = g8Spec;
export { G8OutputZ };
