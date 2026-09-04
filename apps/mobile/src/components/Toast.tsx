import React from "react";
import { Pressable, Text, View } from "react-native";
import { colors, radius, spacing, font } from "@rpgllm/shared";

/**
 * Inline banner (never overlays the feed, so it can't intercept taps in E2E).
 * `accessibilityLiveRegion="polite"` makes a screen reader announce it when it appears — the
 * fallback/safety toasts are the app's only channel for "that action did not land".
 */
export function Toast({
  text,
  testID,
  tone = "neutral",
  onPress,
}: {
  text: string;
  testID?: string;
  tone?: "neutral" | "warn" | "error";
  onPress?: () => void;
}) {
  const border = tone === "error" ? colors.danger : tone === "warn" ? colors.negative : colors.border;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole={onPress ? "button" : "alert"}
      accessibilityLabel={text}
      accessibilityLiveRegion="polite"
      style={{
        marginHorizontal: spacing.lg,
        marginTop: spacing.md,
        backgroundColor: colors.card,
        borderColor: border,
        borderWidth: 1,
        borderRadius: radius.md,
        padding: spacing.md,
      }}
    >
      <Text importantForAccessibility="no" style={{ color: colors.text, fontSize: font.sm }} numberOfLines={3}>
        {text}
      </Text>
    </Pressable>
  );
}

export function InlineError({ text, testID }: { text: string; testID?: string }) {
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      accessibilityLabel={text}
      accessibilityLiveRegion="polite"
      style={{
        borderColor: colors.danger,
        borderWidth: 1,
        borderRadius: radius.sm,
        padding: spacing.md,
        backgroundColor: colors.bgElevated,
      }}
    >
      <Text importantForAccessibility="no" style={{ color: colors.danger, fontSize: font.sm }}>
        {text}
      </Text>
    </View>
  );
}
