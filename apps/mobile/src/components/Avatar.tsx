import React from "react";
import { Text, View } from "react-native";
import { colors, radius } from "@rpgllm/shared";

const PALETTE = [colors.accent, colors.positive, colors.negative, colors.coffee, colors.energy, colors.accentMuted, colors.verified];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Deterministic initials avatar — no network images anywhere in the app.
 *
 * An avatar always sits next to the handle it belongs to, so by default it is decorative and is
 * taken out of the accessibility tree; a caller that renders one on its own passes `label` to get
 * an image role with a name instead.
 */
export function Avatar({ handle, size = 40, label }: { handle: string; size?: number; label?: string }) {
  const clean = handle.replace(/^@/, "");
  const bg = PALETTE[hash(clean) % PALETTE.length] ?? colors.accent;
  const initials = clean.slice(0, 2).toUpperCase();
  const a11y = label === undefined
    ? ({ accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" } as const)
    : ({ accessibilityRole: "image", accessibilityLabel: label } as const);
  return (
    <View
      {...a11y}
      style={{
        width: size,
        height: size,
        borderRadius: radius.pill,
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: colors.bg, fontSize: size * 0.38, fontWeight: "700" }}>{initials}</Text>
    </View>
  );
}
