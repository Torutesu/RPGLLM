/**
 * How the reel sets type.
 *
 * Both painters wrap with the estimator below rather than with their own metrics, because a canvas
 * can measure the real face and a React Native `<Text>` cannot — and two painters that disagree
 * about where a line breaks are two different reels.
 */

export type Face = "display" | "text";
export type Align = "left" | "center" | "right";

/**
 * The two bundled faces, by role. Both painters read this table so a line of type is set in the
 * same face on a canvas and in a `<Text>`; nothing else in the reel is allowed to name a font.
 */
export const FACE_FAMILY: Record<Face, { bold: string; regular: string }> = {
  display: { bold: "SpaceGrotesk_700Bold", regular: "SpaceGrotesk_500Medium" },
  text: { bold: "Inter_600SemiBold", regular: "Inter_400Regular" },
};
export const familyFor = (face: Face, bold: boolean): string =>
  bold ? FACE_FAMILY[face].bold : FACE_FAMILY[face].regular;


const CJK = /[\u2E80-\u9FFF\uAC00-\uD7AF\u3000-\u303F\uFF00-\uFF60]/;
const CJK_BREAK_AFTER = "、。，．！？：；」』）】";

/**
 * A deterministic advance-width estimate.
 *
 * The canvas could measure the real face, and React Native could not — and two painters that
 * disagree about where a line breaks are two different reels. So both wrap with this instead, and
 * it deliberately runs ~4% wide: over-estimating breaks a line early, which is invisible;
 * under-estimating overflows the frame, which is not.
 */
function advance(ch: string, size: number, face: Face, bold: boolean): number {
  if (CJK.test(ch)) return size * 1.0;
  if (ch === " ") return size * 0.27;
  if (".,:;'!ilI|`".includes(ch)) return size * 0.3;
  if ("fjrt()[]{}-".includes(ch)) return size * 0.37;
  if ("MW@mw".includes(ch)) return size * (face === "display" ? 0.94 : 0.9);
  if (ch >= "0" && ch <= "9") return size * 0.58;
  return size * (face === "display" ? (bold ? 0.63 : 0.6) : bold ? 0.57 : 0.55);
}

export function measure(text: string, size: number, face: Face, bold: boolean, track = 0): number {
  let w = 0;
  for (const ch of text) w += advance(ch, size, face, bold) + track;
  return w * 1.04;
}

/** Greedy wrap that understands both spaces and CJK, then ellipsises at `maxLines`. */
export function wrapText(
  text: string,
  size: number,
  face: Face,
  bold: boolean,
  maxW: number,
  maxLines: number,
): string[] {
  // by code point, not by UTF-16 unit: a surrogate pair split in half is a broken glyph
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  if (chars.length === 0) return [];
  const lines: string[] = [];
  let line: string[] = [];
  let width = 0;
  let breakAt = -1;
  let cut = false;

  const widthOf = (arr: readonly string[]): number => {
    let w = 0;
    for (const c of arr) w += advance(c, size, face, bold) * 1.04;
    return w;
  };

  for (const ch of chars) {
    const a = advance(ch, size, face, bold) * 1.04;
    if (width + a > maxW && line.length > 0) {
      let rest: string[] = [];
      if (breakAt > 0) {
        rest = line.slice(breakAt);
        line = line.slice(0, breakAt);
      }
      lines.push(line.join("").trim());
      if (lines.length >= maxLines) {
        cut = true;
        break;
      }
      line = rest.length > 0 && rest[0] === " " ? rest.slice(1) : rest;
      width = widthOf(line);
      breakAt = -1;
    }
    line.push(ch);
    width += a;
    if (ch === " " || CJK_BREAK_AFTER.includes(ch) || CJK.test(ch)) breakAt = line.length;
  }

  if (!cut && line.join("").trim().length > 0) lines.push(line.join("").trim());
  if (cut) {
    const last = lines[lines.length - 1] ?? "";
    lines[lines.length - 1] = `${last.replace(/[ ,.\u3001\u3002]+$/, "")}\u2026`;
  }
  return lines;
}
