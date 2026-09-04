/** Design tokens — dark, X-like. Only source of colors/fonts/spacing. */
export const colors = {
  bg: "#000000",
  bgElevated: "#121417",
  border: "#2F3336",
  text: "#E7E9EA",
  textMuted: "#71767B",
  accent: "#1D9BF0",
  accentMuted: "#0F5A8C",
  positive: "#7CFF4A",
  negative: "#FF7A1A",
  danger: "#F4212E",
  verified: "#1D9BF0",
  energy: "#FFD60A",
  coffee: "#C68642",
  card: "#16181C",
  overlay: "rgba(0,0,0,0.6)",
} as const;
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
export const font = { xs: 12, sm: 14, md: 16, lg: 20, xl: 28, xxl: 36 } as const;
