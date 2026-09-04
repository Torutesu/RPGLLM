import React from "react";
import { Text, View } from "react-native";
import { T, colors, font, radius, spacing } from "@rpgllm/shared";

/** iMessage-like bubble. Character messages left, yours right. */
export function Bubble({ text, fromCharacter, footer }: { text: string; fromCharacter: boolean; footer?: React.ReactNode }) {
  return (
    <View style={{ alignItems: fromCharacter ? "flex-start" : "flex-end", marginBottom: spacing.sm }}>
      <View
        testID={T.dmBubble}
        accessibilityRole="text"
        accessibilityLabel={text}
        style={{
          maxWidth: "80%",
          backgroundColor: fromCharacter ? colors.bgElevated : colors.accent,
          borderRadius: radius.lg,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
        }}
      >
        <Text style={{ color: fromCharacter ? colors.text : colors.bg, fontSize: font.md }}>{text}</Text>
      </View>
      {footer}
    </View>
  );
}

export function TypingBubble() {
  return (
    <View style={{ alignItems: "flex-start", marginBottom: spacing.sm }}>
      {/* "• • •" is pure decoration; announcing it would interrupt the message being read. */}
      <View
        testID={T.dmTyping}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          backgroundColor: colors.bgElevated,
          borderRadius: radius.lg,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
        }}
      >
        <Text style={{ color: colors.textMuted, fontSize: font.md }}>• • •</Text>
      </View>
    </View>
  );
}
