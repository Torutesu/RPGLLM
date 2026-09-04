import type { TextStyle } from "react-native";
import { font, leading, tracking, weight } from "@rpgllm/shared";
import { fontsLoaded } from "./fonts";

/**
 * The type ramp. Every piece of text in the app comes from here so that size, weight, tracking and
 * line height move together instead of being guessed per screen.
 *
 * `fontFamily` is always emitted: on web the browser falls back until the face loads and then
 * reflows, on native an unknown family degrades to the system face. `fontWeight` is emitted too so
 * the fallback still has hierarchy before the real face arrives.
 */
type Face = "display" | "text";

const FAMILY: Record<Face, Record<string, string>> = {
  display: { "500": "SpaceGrotesk_500Medium", "700": "SpaceGrotesk_700Bold" },
  text: {
    "400": "Inter_400Regular",
    "500": "Inter_500Medium",
    "600": "Inter_600SemiBold",
    "700": "Inter_700Bold",
  },
};

function familyFor(face: Face, w: TextStyle["fontWeight"]): string | undefined {
  const table = FAMILY[face];
  const key = String(w ?? "400");
  // Display only ships two weights; anything heavier maps to bold.
  const resolved = table[key] ?? (face === "display" ? table["700"] : table["600"]);
  return resolved;
}

function style(
  face: Face,
  size: number,
  w: TextStyle["fontWeight"],
  line: number,
  track: number,
  extra?: TextStyle,
): TextStyle {
  return {
    fontFamily: familyFor(face, w),
    fontSize: size,
    fontWeight: w,
    lineHeight: Math.round(size * line),
    letterSpacing: track,
    ...extra,
  };
}

const TABULAR: TextStyle = { fontVariant: ["tabular-nums"] };

/** Named text styles. Spread them, then override colour at the call site. */
export const typo = {
  /** Celebration numbers — level ups, follower milestones. */
  hero: style("display", font.hero, weight.bold, leading.tight, tracking.tight, TABULAR),
  /** The big number on a stat card. */
  display: style("display", font.display, weight.bold, leading.tight, tracking.tight, TABULAR),
  /** Screen titles that own the page. */
  title: style("display", font.xxl, weight.bold, leading.tight, tracking.tight),
  /** Section heroes and modal headlines. */
  h1: style("display", font.xl, weight.bold, leading.tight, tracking.snug),
  /** Card headlines, nav bar titles. */
  h2: style("text", font.lg, weight.bold, leading.snug, tracking.snug),
  /** Reading size for post bodies and messages. */
  body: style("text", font.md, weight.regular, leading.normal, tracking.normal),
  bodyStrong: style("text", font.md, weight.semibold, leading.normal, tracking.normal),
  /** A person's display name in a row. */
  name: style("text", font.md, weight.semibold, leading.snug, tracking.snug),
  /** Handles, timestamps, "3 replies". */
  meta: style("text", font.sm, weight.regular, leading.snug, tracking.normal),
  metaStrong: style("text", font.sm, weight.semibold, leading.snug, tracking.normal),
  /** Buttons and tab labels. */
  label: style("text", font.sm, weight.semibold, leading.snug, tracking.normal),
  caption: style("text", font.xs, weight.medium, leading.snug, tracking.normal),
  /** All-caps eyebrows: NEWS, TRENDING, WHILE YOU WERE AWAY. */
  micro: style("text", font.xxs, weight.bold, leading.snug, tracking.wider),
  /** Counts next to an icon. */
  count: style("text", font.xs, weight.semibold, leading.snug, tracking.normal, TABULAR),
  /** Any number that animates. */
  number: style("display", font.lg, weight.bold, leading.tight, tracking.snug, TABULAR),
} as const;

export type TypeRole = keyof typeof typo;

/** True once the bundled faces are live; used to re-render native roots. See `fonts.ts`. */
export { useFontsLoaded, fontsLoaded } from "./fonts";

/** Uppercase eyebrow text, with the tracking the ramp expects. */
export function eyebrow(text: string): string {
  return text.toUpperCase();
}

/** `true` while the app is still painting with the fallback stack. */
export function usingFallbackFaces(): boolean {
  return !fontsLoaded();
}
