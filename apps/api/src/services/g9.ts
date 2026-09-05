/**
 * The G9 surface, feature-detected.
 *
 * Agent G9 is adding `gateway.g9()` and `screenPremise()` to `@rpgllm/llm` in parallel with this
 * work, exactly like `createGateway` was still landing when `llm-loader.ts` was written. So nothing
 * here imports those symbols by name: the gateway is probed for a callable `g9`, and the module for
 * a callable `screenPremise`. Both have a local stand-in, so the studio is testable today and picks
 * up the real generator the moment it exists — with no edit to a call site.
 */
import type { Gateway, RunOptions } from "@rpgllm/llm";
import type { GenerationResult, Locale, WorldGenre, WorldSeed } from "@rpgllm/shared";
import { WORLD_PREMISE_BLOCKED } from "@rpgllm/shared";

/** What `gateway.g9()` takes (packages/llm). Declared here so the API compiles before it ships. */
export interface G9Input {
  slug: string;
  premise: string;
  genre: WorldGenre;
  locale: Locale;
  seed: number;
}

export type G9Fn = (input: G9Input, opts?: RunOptions) => Promise<GenerationResult<WorldSeed>>;

/** The gateway's `g9`, or null while `@rpgllm/llm` has not shipped one. */
export function g9Of(gateway: Gateway): G9Fn | null {
  const fn = (gateway as unknown as { g9?: unknown }).g9;
  return typeof fn === "function" ? (fn as G9Fn) : null;
}

/* ------------------------------------------------------- the premise screen ---- */

export type BlockedCategory = (typeof WORLD_PREMISE_BLOCKED)[number];
export interface PremiseVerdict { verdict: "allow" | "block"; category: string | null }
export type PremiseScreen = (premise: string, locale: Locale) => PremiseVerdict;

/**
 * The local screen. It runs *before* a single token is spent, so it is deliberately cheap and
 * deliberately conservative: a premise becomes a system prompt, and a 13+ app cannot afford to
 * discover that at generation time. It is a floor, not a replacement — `packages/llm`'s
 * `screenPremise` supersedes it as soon as that export exists, and the generated bible is checked
 * again by G8 before anything can be published.
 */
const PATTERNS: ReadonlyArray<readonly [BlockedCategory, RegExp]> = [
  ["sexual_minor", /\b(?:minor|child|kid|teen|schoolgirl|schoolboy|underage|(?:1[0-7]|[1-9])[\s-]?(?:year|yr)s?[\s-]?old)\b[^.]{0,40}\b(?:sex|sexual|nude|naked|erotic|seduc\w*|lewd)\b|\b(?:sex|sexual|nude|naked|erotic|seduc\w*|lewd)\b[^.]{0,40}\b(?:minor|child|kid|teen|schoolgirl|schoolboy|underage)\b|(?:未成年|小学生|中学生|児童|ロリ|ショタ)[^。]{0,20}(?:性|エロ|裸|セックス)/i],
  ["sexual_explicit", /\b(?:explicit sex|graphic sex|porn\w*|hardcore|genitals?|masturbat\w*|orgasm|nsfw|smut|hentai|incest)\b|(?:性行為を描写|露骨な性|ポルノ|性器|近親相姦)/i],
  ["hate", /\b(?:hate speech|ethnic cleansing|racial slur|white power|kill all (?:jews|muslims|blacks|gays)|gas the)\b|(?:ヘイトスピーチ|民族浄化)/i],
  ["self_harm", /\b(?:self[\s-]?harm|suicide method|how to (?:kill myself|cut myself)|pro[\s-]?ana|thinspo|starve myself)\b|(?:自殺の方法|リストカットのやり方|拒食)/i],
  ["violence_graphic", /\b(?:torture|dismember\w*|mutilat\w*|gore|behead\w*|snuff)\b|(?:拷問|切断|グロ)/i],
  ["illegal", /\b(?:how to (?:make|build|synthesi[sz]e) (?:a )?(?:bomb|meth|explosive)|child (?:porn|abuse)|traffick\w*)\b|(?:爆弾の作り方|覚醒剤の作り方)/i],
  /**
   * The premise reaches the generator as data, but a premise that *reads* as an instruction is a
   * social-engineering attempt on the reviewer as much as on the model, and there is no legitimate
   * world that needs this phrasing.
   */
  ["prompt_injection", /(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+|the\s+|your\s+|previous\s+|above\s+|prior\s+)*(?:instruction|prompt|rule|guideline|system|direction)|\b(?:system\s*prompt|developer\s*message|jailbreak|DAN mode)\b|<\/?(?:system|assistant|human)\b|(?:これまでの指示を無視|システムプロンプト)/i],
];

/**
 * Real people. A world "about" a named public figure is the single most likely way this feature
 * produces a defamation problem, so the marker is the framing, not the name: we cannot hold a list
 * of every celebrity, and a name alone is a perfectly good character name.
 */
const REAL_PERSON =
  /\b(?:real[\s-]?life|actual|the real)\s+(?:celebrit|person|people|politician|president|singer|actor)|\b(?:based on|starring|featuring)\s+(?:the\s+)?real\b|(?:実在の(?:人物|有名人|芸能人))/i;

export function localPremiseScreen(premise: string, _locale: Locale): PremiseVerdict {
  const text = premise.normalize("NFKC");
  for (const [category, re] of PATTERNS) if (re.test(text)) return { verdict: "block", category };
  if (REAL_PERSON.test(text)) return { verdict: "block", category: "real_person" };
  return { verdict: "allow", category: null };
}

/**
 * The deep screen: the deterministic verdict, then — in live mode only — a model classifier, ANDed.
 *
 * `packages/llm`'s `screenPremiseDeep` already owns the policy (it never calls the model when the
 * deterministic layer blocks, never lets a model turn a block into an allow, and degrades to the
 * deterministic verdict on an infrastructure failure rather than taking the studio offline). All
 * this adds is the local floor, which stays ANDed on top, and a guarantee that the call cannot
 * throw into the route.
 */
export type DeepPremiseScreen = (premise: string, locale: Locale) => Promise<PremiseVerdict & { layer: string }>;

type DeepFn = (
  gateway: unknown,
  premise: string,
  locale: Locale,
) => Promise<{ verdict: "allow" | "block"; category: string | null; layer?: string }>;

export function deepPremiseScreenFrom(mod: unknown, gateway: Gateway, sync: PremiseScreen): DeepPremiseScreen {
  const deep = (mod as { screenPremiseDeep?: unknown } | null | undefined)?.screenPremiseDeep;
  const hasG9Screen = typeof (gateway as unknown as { g9Screen?: unknown }).g9Screen === "function";
  if (typeof deep !== "function" || !hasG9Screen) {
    return async (premise, locale) => ({ ...sync(premise, locale), layer: "deterministic" });
  }
  const run = deep as DeepFn;
  return async (premise, locale) => {
    // The local floor first: it is free, and nothing downstream may unblock it.
    const local = localPremiseScreen(premise, locale);
    if (local.verdict === "block") return { ...local, layer: "local" };
    try {
      const out = await run(gateway, premise, locale);
      if (out && (out.verdict === "allow" || out.verdict === "block")) {
        return { verdict: out.verdict, category: out.category ?? null, layer: out.layer ?? "deep" };
      }
    } catch {
      /* a screen that throws must not take the studio down — fall back to the sync verdict */
    }
    return { ...sync(premise, locale), layer: "deterministic" };
  };
}

/** `screenPremise` from `@rpgllm/llm` when it exists, else the local floor. Never throws. */
export function premiseScreenFrom(mod: unknown): PremiseScreen {
  const fn = (mod as { screenPremise?: unknown } | null | undefined)?.screenPremise;
  if (typeof fn !== "function") return localPremiseScreen;
  const screen = fn as PremiseScreen;
  return (premise, locale) => {
    try {
      const out = screen(premise, locale);
      if (out && (out.verdict === "allow" || out.verdict === "block")) {
        // Never *unblock* what the local floor rejects: the two screens are ANDed, not replaced.
        const local = localPremiseScreen(premise, locale);
        return local.verdict === "block" ? local : out;
      }
    } catch {
      /* a screen that throws is a screen that failed open — fall through to the local one */
    }
    return localPremiseScreen(premise, locale);
  };
}
