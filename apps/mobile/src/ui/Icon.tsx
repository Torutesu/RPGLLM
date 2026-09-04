import React from "react";
import Svg, { Path } from "react-native-svg";
import { colors } from "@rpgllm/shared";

/**
 * The app's icon set.
 *
 * Every glyph is drawn on the same 24×24 grid with the same 1.8 stroke, round caps and round
 * joins, so a row of them reads as one family — which is the whole point of dropping the emoji
 * that used to stand in for icons (💬 🔁 ❤ ⚡ ☕ ⚙ 👍 👎). Emoji render differently on every
 * platform, carry their own colour, and cannot be tinted; these can.
 *
 * `s` holds stroked outlines, `f` an optional solid variant used when `filled` is set.
 */
type Glyph = { readonly s?: readonly string[]; readonly f?: readonly string[] };

const G = 24;
const STROKE = 1.8;

const paths = {
  home: {
    s: ["M3 10.6 12 3l9 7.6V20a1 1 0 0 1-1 1h-4.5v-6.2h-7V21H4a1 1 0 0 1-1-1z"],
  },
  bell: {
    s: [
      "M18 8.4a6 6 0 1 0-12 0c0 5.2-2.1 6.4-2.1 6.4h16.2S18 13.6 18 8.4",
      "M13.7 19a2 2 0 0 1-3.4 0",
    ],
  },
  message: {
    s: [
      "M21 11.6a8.3 8.3 0 0 1-8.9 8.4 9.5 9.5 0 0 1-3.9-.8L3.2 21l1.9-4.6A8.3 8.3 0 0 1 4.2 12 8.3 8.3 0 0 1 12.6 3.2 8.3 8.3 0 0 1 21 11.6z",
    ],
  },
  person: {
    s: ["M20 21v-1.8a4.2 4.2 0 0 0-4.2-4.2H8.2A4.2 4.2 0 0 0 4 19.2V21", "M16.2 7.2a4.2 4.2 0 1 1-8.4 0 4.2 4.2 0 0 1 8.4 0z"],
  },
  compass: {
    s: ["M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z", "m15.6 8.4-2.2 5-5 2.2 2.2-5z"],
  },
  gear: {
    s: [
      "M15.4 12a3.4 3.4 0 1 1-6.8 0 3.4 3.4 0 0 1 6.8 0z",
      "M19.2 14.8a1.6 1.6 0 0 0 .3 1.8l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a1.9 1.9 0 0 1-3.8 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1.6 1.6 0 0 0-1.1-2.7h-.3a1.9 1.9 0 0 1 0-3.8h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1a1.6 1.6 0 0 0 2.7-1.1v-.3a1.9 1.9 0 0 1 3.8 0v.2a1.6 1.6 0 0 0 2.8 1.1l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a1.9 1.9 0 0 1 0 3.8h-.2a1.6 1.6 0 0 0-1.4.9z",
    ],
  },
  plus: { s: ["M12 5.2v13.6", "M5.2 12h13.6"] },
  heart: {
    s: ["M20.6 5.1a5.3 5.3 0 0 0-7.5 0L12 6.2l-1.1-1.1a5.3 5.3 0 1 0-7.5 7.5l1.1 1.1L12 21.2l7.5-7.5 1.1-1.1a5.3 5.3 0 0 0 0-7.5z"],
  },
  heartFilled: {
    f: ["M20.6 5.1a5.3 5.3 0 0 0-7.5 0L12 6.2l-1.1-1.1a5.3 5.3 0 1 0-7.5 7.5l1.1 1.1L12 21.2l7.5-7.5 1.1-1.1a5.3 5.3 0 0 0 0-7.5z"],
  },
  repost: {
    s: ["M17 2.6 20.8 6.4 17 10.2", "M3.2 12.4V9.6a3.2 3.2 0 0 1 3.2-3.2h14.4", "M7 21.4 3.2 17.6 7 13.8", "M20.8 11.6v2.8a3.2 3.2 0 0 1-3.2 3.2H3.2"],
  },
  reply: {
    s: ["M9.4 14.6 4.4 9.6l5-5", "M20 20v-6.6a3.8 3.8 0 0 0-3.8-3.8H4.4"],
  },
  share: {
    s: ["M4.4 12.4V19a2 2 0 0 0 2 2h11.2a2 2 0 0 0 2-2v-6.6", "M16 6.6 12 2.6 8 6.6", "M12 2.6v12.6"],
  },
  bolt: { s: ["M13.4 2.4 4.6 13.8h6.4l-1.4 7.8 8.8-11.4H12z"] },
  coffee: {
    s: ["M18 8.6h1.2a3.6 3.6 0 0 1 0 7.2H18", "M2.8 8.6H18v8.2a4.2 4.2 0 0 1-4.2 4.2H7a4.2 4.2 0 0 1-4.2-4.2z", "M6.6 2.2v2.8", "M10.4 2.2v2.8", "M14.2 2.2v2.8"],
  },
  gem: {
    s: ["M6.2 3h11.6l3.8 5.8L12 21 2.4 8.8z", "M11 3 8.2 8.8 12 21l3.8-12.2L13 3", "M2.4 8.8h19.2"],
  },
  check: { s: ["m20 6.4-10.9 11L4 12.3"] },
  chevronLeft: { s: ["m14.8 18.4-6.4-6.4 6.4-6.4"] },
  chevronRight: { s: ["m9.2 5.6 6.4 6.4-6.4 6.4"] },
  close: { s: ["M18 6 6 18", "M6 6l12 12"] },
  more: {
    f: [
      "M6.6 12a1.7 1.7 0 1 1-3.4 0 1.7 1.7 0 0 1 3.4 0z",
      "M13.7 12a1.7 1.7 0 1 1-3.4 0 1.7 1.7 0 0 1 3.4 0z",
      "M20.8 12a1.7 1.7 0 1 1-3.4 0 1.7 1.7 0 0 1 3.4 0z",
    ],
  },
  flame: {
    s: [
      "M12 2.4c1.6 3.6 5 5.2 5 9.6A5 5 0 0 1 12 21.6a5 5 0 0 1-5-5c0-2 1-3.6 2.1-4.6 0 1.5.8 2.5 2 2.5 1.4 0 2.1-1.2 2.1-2.6 0-2.6-1.2-4-1.2-6.4z",
    ],
  },
  sparkle: {
    s: [
      "M11.4 2.8 13.2 8l5.2 1.8-5.2 1.8-1.8 5.2-1.8-5.2L4.4 9.8 9.6 8z",
      "M18.2 15 19 17.2l2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z",
    ],
  },
  trophy: {
    s: ["M8.4 21.2h7.2", "M12 17.4v3.8", "M7 3.2h10v5.4a5 5 0 0 1-10 0z", "M7 5.6H5.2a2.2 2.2 0 0 0 0 4.4H7", "M17 5.6h1.8a2.2 2.2 0 0 1 0 4.4H17"],
  },
  crown: {
    s: ["M3.4 7.4 6.8 12l5.2-6.4L17.2 12l3.4-4.6 -1.6 11H5z", "M5 20.6h14"],
  },
  lock: {
    s: ["M5.8 10.6h12.4v9.2a1.2 1.2 0 0 1-1.2 1.2H7a1.2 1.2 0 0 1-1.2-1.2z", "M8.8 10.6V7a3.2 3.2 0 0 1 6.4 0v3.6"],
  },
  eye: {
    s: ["M2.2 12s3.6-6.8 9.8-6.8S21.8 12 21.8 12s-3.6 6.8-9.8 6.8S2.2 12 2.2 12z", "M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"],
  },
  send: { s: ["M21.6 2.4 10.8 13.2", "M21.6 2.4 14.8 21.6l-4-8.4-8.4-4z"] },
  thumbUp: {
    s: ["M7 21.4H4.4a1.2 1.2 0 0 1-1.2-1.2v-7.6a1.2 1.2 0 0 1 1.2-1.2H7", "M7 11.4l3.9-8.8a2.9 2.9 0 0 1 2.9 2.9v3.9h5.4a2 2 0 0 1 2 2.3l-1.3 6.8a2 2 0 0 1-2 1.9H7z"],
  },
  thumbDown: {
    s: ["M17 2.6h2.6a1.2 1.2 0 0 1 1.2 1.2v7.6a1.2 1.2 0 0 1-1.2 1.2H17", "M17 12.6l-3.9 8.8a2.9 2.9 0 0 1-2.9-2.9v-3.9H4.8a2 2 0 0 1-2-2.3l1.3-6.8a2 2 0 0 1 2-1.9H17z"],
  },
  shield: { s: ["M12 2.6 4 5.6v6c0 5 3.4 8.8 8 10.8 4.6-2 8-5.8 8-10.8v-6z"] },
  refresh: { s: ["M20.4 4.4v5.2h-5.2", "M3.6 19.6v-5.2h5.2", "M19.1 9.6a7.6 7.6 0 0 0-13-2.9L3.6 9.6", "M4.9 14.4a7.6 7.6 0 0 0 13 2.9l2.5-2.9"] },
  clock: { s: ["M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z", "M12 6.8V12l3.4 2"] },
  search: { s: ["M18.6 11a7.6 7.6 0 1 1-15.2 0 7.6 7.6 0 0 1 15.2 0z", "M21 21l-4.4-4.4"] },
  arrowUp: { s: ["M12 19.4V4.6", "M5.4 11.2 12 4.6l6.6 6.6"] },
  arrowDown: { s: ["M12 4.6v14.8", "M18.6 12.8 12 19.4l-6.6-6.6"] },
  trendUp: { s: ["M3.4 16.6 9.4 10.6l4 4 7.2-7.2", "M15.4 7.4h5.2v5.2"] },
  trendDown: { s: ["M3.4 7.4 9.4 13.4l4-4 7.2 7.2", "M15.4 16.6h5.2v-5.2"] },
  minus: { s: ["M5.2 12h13.6"] },
} as const satisfies Record<string, Glyph>;

export type IconName = keyof typeof paths;

export const iconNames = Object.keys(paths) as readonly IconName[];

export interface IconProps {
  name: IconName;
  /** Rendered box, in px. Stroke weight scales with it so 14px and 32px look like siblings. */
  size?: number;
  color?: string;
  /** Solid version where the glyph has one; falls back to filling the outline. */
  filled?: boolean;
  opacity?: number;
}

/**
 * Icons are decoration: the control around them carries the accessible name. They are hidden from
 * the accessibility tree so a screen reader never reads a shape.
 */
export function Icon({ name, size = 20, color = colors.text, filled = false, opacity }: IconProps) {
  const glyph: Glyph = paths[name];
  const solid = filled ? (glyph.f ?? glyph.s ?? []) : (glyph.f && !glyph.s ? glyph.f : []);
  const outline = filled ? [] : (glyph.s ?? []);
  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${G} ${G}`}
      fill="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      {...(opacity === undefined ? {} : { opacity })}
    >
      {solid.map((d, i) => (
        <Path key={`f${i}`} d={d} fill={color} stroke={color} strokeWidth={filled ? STROKE * 0.5 : 0} strokeLinejoin="round" />
      ))}
      {outline.map((d, i) => (
        <Path
          key={`s${i}`}
          d={d}
          stroke={color}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ))}
    </Svg>
  );
}
