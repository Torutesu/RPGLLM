import React from "react";
import { Pressable, Text, View } from "react-native";
import { colors, radius, spacing } from "@rpgllm/shared";
import { FadeSlideIn, Icon, typo, type IconName } from "../ui";

type Tone = "neutral" | "warn" | "error" | "success";

const TONE: Record<Tone, { color: string; icon: IconName }> = {
  neutral: { color: colors.accent, icon: "sparkle" },
  warn: { color: colors.negative, icon: "flame" },
  error: { color: colors.danger, icon: "shield" },
  success: { color: colors.positive, icon: "check" },
};

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
  tone?: Tone;
  onPress?: () => void;
}) {
  const { color, icon } = TONE[tone];
  return (
    <FadeSlideIn distance={-10} style={{ marginHorizontal: spacing.lg, marginTop: spacing.md }}>
      <Pressable
        testID={testID}
        onPress={onPress}
        accessibilityRole={onPress ? "button" : "alert"}
        accessibilityLabel={text}
        accessibilityLiveRegion="polite"
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.md,
          backgroundColor: pressed ? colors.cardHi : colors.card,
          borderColor: `${color}66`,
          borderWidth: 1,
          borderLeftWidth: 3,
          borderLeftColor: color,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.md,
        })}
      >
        <Icon name={icon} size={17} color={color} />
        <Text importantForAccessibility="no" style={[typo.meta, { color: colors.text, flex: 1 }]} numberOfLines={3}>
          {text}
        </Text>
      </Pressable>
    </FadeSlideIn>
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
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        borderColor: `${colors.danger}77`,
        borderWidth: 1,
        borderRadius: radius.md,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.md,
        backgroundColor: `${colors.danger}14`,
      }}
    >
      <Icon name="shield" size={16} color={colors.danger} />
      <Text importantForAccessibility="no" style={[typo.meta, { color: colors.danger, flex: 1 }]}>
        {text}
      </Text>
    </View>
  );
}
