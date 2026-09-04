import React from "react";
import { View } from "react-native";
import { colors, radius, spacing } from "@rpgllm/shared";

export function Skeleton({ height = 14, width = "100%", style }: { height?: number; width?: number | string; style?: object }) {
  return (
    <View
      style={[
        { height, width: width as number, backgroundColor: colors.bgElevated, borderRadius: radius.sm, opacity: 0.6 },
        style,
      ]}
    />
  );
}

export function SkeletonPost() {
  return (
    <View style={{ flexDirection: "row", gap: spacing.md, padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Skeleton height={40} width={40} style={{ borderRadius: radius.pill }} />
      <View style={{ flex: 1, gap: spacing.sm }}>
        <Skeleton height={12} width={140} />
        <Skeleton height={12} />
        <Skeleton height={12} width={220} />
      </View>
    </View>
  );
}

export function SkeletonList({ count = 5 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonPost key={i} />
      ))}
    </View>
  );
}
