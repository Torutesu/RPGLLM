import React from "react";
import { View } from "react-native";
import { colors, layout, radius, spacing } from "@rpgllm/shared";
import { Shimmer } from "../ui";

/**
 * Loading placeholders carry no information, so they are removed from the accessibility tree
 * entirely (iOS: `accessibilityElementsHidden`, Android/web: `importantForAccessibility`).
 * Without this a screen reader reads a wall of empty rows while the feed loads.
 */
const HIDDEN = {
  accessibilityElementsHidden: true,
  importantForAccessibility: "no-hide-descendants",
} as const;

export function Skeleton({
  height = 14,
  width = "100%",
  style,
}: {
  height?: number;
  width?: number | string;
  style?: object;
}) {
  const w = typeof width === "number" ? width : (width as `${number}%`);
  return <Shimmer height={height} width={w} style={style} />;
}

export function SkeletonPost() {
  return (
    <View
      {...HIDDEN}
      style={{
        flexDirection: "row",
        gap: spacing.md,
        padding: spacing.lg,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <Shimmer height={layout.avatarMd} width={layout.avatarMd} radius={radius.pill} />
      <View style={{ flex: 1, gap: spacing.sm, paddingTop: spacing.xxs }}>
        <Shimmer height={12} width={148} />
        <Shimmer height={12} />
        <Shimmer height={12} width={220} />
        <View style={{ flexDirection: "row", gap: spacing.xl, marginTop: spacing.xs }}>
          <Shimmer height={10} width={34} />
          <Shimmer height={10} width={34} />
          <Shimmer height={10} width={34} />
        </View>
      </View>
    </View>
  );
}

export function SkeletonList({ count = 5 }: { count?: number }) {
  return (
    <View {...HIDDEN}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonPost key={i} />
      ))}
    </View>
  );
}
