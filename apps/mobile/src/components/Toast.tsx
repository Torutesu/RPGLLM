import React from "react";
import { Pressable, Text, View } from "react-native";
import { colors, radius, spacing, font } from "@rpgllm/shared";

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
      style={{
        position: "absolute",
        left: spacing.lg,
        right: spacing.lg,
        top: spacing.xxl * 2,
        backgroundColor: colors.card,
        borderColor: border,
        borderWidth: 1,
        borderRadius: radius.md,
        padding: spacing.md,
        zIndex: 40,
      }}
    >
      <Text style={{ color: colors.text, fontSize: font.sm }} numberOfLines={3}>
        {text}
      </Text>
    </Pressable>
  );
}

export function InlineError({ text, testID }: { text: string; testID?: string }) {
  return (
    <View
      testID={testID}
      style={{
        borderColor: colors.danger,
        borderWidth: 1,
        borderRadius: radius.sm,
        padding: spacing.md,
        backgroundColor: colors.bgElevated,
      }}
    >
      <Text style={{ color: colors.danger, fontSize: font.sm }}>{text}</Text>
    </View>
  );
}
