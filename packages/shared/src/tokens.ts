/**
 * Design tokens — the only source of colour, type, spacing, motion and elevation.
 *
 * Direction: this is a game about fame, drama and being the main character, so the surface is a
 * neon-lit night rather than a generic dark-mode timeline. Near-black with a violet cast, real
 * elevation, one hot gradient for identity, and colour that *means* something (green = the world
 * likes you, orange = the world is turning). Every key from the first pass is kept so no screen
 * breaks; the new ones sit alongside.
 */

export const colors = {
  /* ---- ground ---- */
  bg: "#07070C",
  bgElevated: "#101019",
  card: "#14141F",
  cardHi: "#1B1B29",
  border: "#26263A",
  borderHi: "#35354F",
  overlay: "rgba(4,4,10,0.78)",
  scrim: "rgba(4,4,10,0.94)",

  /* ---- text ---- */
  text: "#F2F2F7",
  textDim: "#A8A8C0",
  textMuted: "#6E6E8A",
  textInverse: "#07070C",

  /* ---- brand / interactive ---- */
  accent: "#7C5CFF",
  accentHi: "#9B84FF",
  accentMuted: "#3A2C7A",
  accentInk: "#FFFFFF",
  hot: "#FF3D8B",
  hotMuted: "#7A1F45",

  /* ---- meaning ---- */
  positive: "#3DE08A",
  positiveMuted: "#164A31",
  negative: "#FF7A3D",
  negativeMuted: "#5C2A12",
  danger: "#FF4D5E",
  warning: "#FFC53D",
  verified: "#5CC8FF",

  /* ---- economy ---- */
  energy: "#FFD93D",
  energyDim: "#5C4E12",
  coffee: "#C98A4B",
  gem: "#5CC8FF",
} as const;

/** Two-stop gradients. Consumers pass these straight to a linear gradient. */
export const gradients = {
  brand: ["#7C5CFF", "#FF3D8B"] as const,
  hot: ["#FF3D8B", "#FF7A3D"] as const,
  cool: ["#5CC8FF", "#7C5CFF"] as const,
  gold: ["#FFD93D", "#FF7A3D"] as const,
  win: ["#3DE08A", "#5CC8FF"] as const,
  lose: ["#FF4D5E", "#7C1F2E"] as const,
  night: ["#14141F", "#07070C"] as const,
} as const;
export type GradientName = keyof typeof gradients;

/**
 * Per-character identity colours. A handle hashes to one entry, which drives its avatar, the
 * accent on its name and the left rail of its replies — so a character is recognisable at a glance
 * before you read the name.
 */
export const identityPalette: readonly (readonly [string, string])[] = [
  ["#FF3D8B", "#7C5CFF"],
  ["#5CC8FF", "#3DE08A"],
  ["#FFD93D", "#FF7A3D"],
  ["#7C5CFF", "#5CC8FF"],
  ["#3DE08A", "#FFD93D"],
  ["#FF7A3D", "#FF3D8B"],
  ["#9B84FF", "#FF3D8B"],
  ["#5CC8FF", "#9B84FF"],
  ["#FF4D5E", "#FFD93D"],
  ["#3DE08A", "#7C5CFF"],
  ["#FFC53D", "#3DE08A"],
  ["#FF3D8B", "#5CC8FF"],
];

/** Stable string hash (FNV-1a). Same handle → same colours on every device and both platforms. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function identityFor(handle: string): { from: string; to: string; index: number } {
  const key = handle.replace(/^@/, "").toLowerCase();
  const index = hashString(key) % identityPalette.length;
  const pair = identityPalette[index] ?? identityPalette[0]!;
  return { from: pair[0], to: pair[1], index };
}

export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radius = { xs: 6, sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;

/** Type scale. `display`/`hero` are for numbers and moments, the rest for reading. */
export const font = {
  xxs: 11,
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 26,
  xxl: 34,
  display: 46,
  hero: 60,
} as const;

export const weight = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
  heavy: "800",
  black: "900",
} as const;

export const tracking = { tight: -0.6, snug: -0.3, normal: 0, wide: 0.4, wider: 1.2 } as const;
export const leading = { tight: 1.15, snug: 1.3, normal: 1.45, relaxed: 1.6 } as const;

/** Elevation. On web these become box-shadows; on native, shadow/elevation props. */
export const elevation = {
  none: { shadowColor: "transparent", shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, elevation: 0 },
  low: { shadowColor: "#000000", shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  mid: { shadowColor: "#000000", shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  high: { shadowColor: "#000000", shadowOpacity: 0.6, shadowRadius: 32, shadowOffset: { width: 0, height: 16 }, elevation: 16 },
} as const;

/** Coloured glow for the things that should feel electric (level ups, viral moments, energy). */
export const glow = (
  color: string,
  radiusPx = 20,
): { shadowColor: string; shadowOpacity: number; shadowRadius: number; shadowOffset: { width: number; height: number }; elevation: number } => ({
  shadowColor: color,
  shadowOpacity: 0.55,
  shadowRadius: radiusPx,
  shadowOffset: { width: 0, height: 0 },
  elevation: 10,
});

/** Motion. Durations in ms; easings are cubic-bezier control points. */
export const motion = {
  instant: 90,
  fast: 160,
  base: 240,
  slow: 380,
  celebration: 900,
  easeOut: [0.16, 1, 0.3, 1] as const,
  easeInOut: [0.65, 0, 0.35, 1] as const,
  overshoot: [0.34, 1.56, 0.64, 1] as const,
  spring: { damping: 14, stiffness: 180, mass: 0.9 } as const,
} as const;

/** Layout constants shared by the feed and the cards. */
export const layout = {
  avatarXs: 22,
  avatarSm: 28,
  avatarMd: 44,
  avatarLg: 72,
  avatarXl: 96,
  maxContentWidth: 640,
  tabBarHeight: 56,
  headerHeight: 52,
} as const;

/** Relative time, e.g. "12m", "3h", "2d". Kept here so feed, DMs and notifications agree. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const s = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (s < 45) return "now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.round(d / 7)}w`;
}

/** Compact counts: 1200 → "1.2K". Used everywhere a follower/like number is shown. */
export function compactNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs < 1000) return String(n);
  if (abs < 1_000_000) {
    const v = n / 1000;
    return `${abs < 10_000 ? v.toFixed(1).replace(/\.0$/, "") : Math.round(v)}K`;
  }
  const v = n / 1_000_000;
  return `${abs < 10_000_000 ? v.toFixed(1).replace(/\.0$/, "") : Math.round(v)}M`;
}
