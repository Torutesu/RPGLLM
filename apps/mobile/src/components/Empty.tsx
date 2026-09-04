import React from "react";
import { Text, View } from "react-native";
import { colors, radius, spacing } from "@rpgllm/shared";
import { Button } from "./ui";
import { Gradient, Icon, Pulse, typo, type IconName } from "../ui";

/**
 * The reusable empty state.
 *
 * An empty screen with nothing on it reads as a broken screen. Every list in the app that can come
 * back with nothing renders one of these instead: an icon in a glowing disc, a headline that says
 * what would be here, an optional line of explanation, and — where there is something to do about
 * it — one button.
 */
export function Empty({
  icon = "sparkle",
  title,
  body,
  actionLabel,
  onAction,
  testID,
  tint = colors.accent,
  compact = false,
}: {
  icon?: IconName;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
  tint?: string;
  compact?: boolean;
}) {
  const disc = compact ? 56 : 84;
  return (
    <View
      testID={testID}
      accessibilityRole="summary"
      accessibilityLabel={body ? `${title}. ${body}` : title}
      style={{
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: spacing.xl,
        paddingVertical: compact ? spacing.xl : spacing.xxxl,
        gap: spacing.md,
      }}
    >
      <Pulse scaleTo={1.04}>
        <View
          style={{
            width: disc,
            height: disc,
            borderRadius: radius.pill,
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            borderWidth: 1,
            borderColor: `${tint}44`,
          }}
        >
          <Gradient
            colors={[`${tint}33`, "rgba(7,7,12,0)"]}
            angle={160}
            pointerEvents="none"
            style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
          />
          <Icon name={icon} size={disc * 0.4} color={tint} />
        </View>
      </Pulse>
      <Text importantForAccessibility="no" style={[compact ? typo.h2 : typo.h1, { color: colors.text, textAlign: "center" }]}>
        {title}
      </Text>
      {body ? (
        <Text
          importantForAccessibility="no"
          style={[typo.meta, { color: colors.textMuted, textAlign: "center", maxWidth: 320 }]}
        >
          {body}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} style={{ marginTop: spacing.sm, minWidth: 180 }} />
      ) : null}
    </View>
  );
}

/** A one-line variant for inside a card or a section that came back empty. */
export function EmptyLine({ icon = "sparkle", text }: { icon?: IconName; text: string }) {
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={text}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.lg,
      }}
    >
      <Icon name={icon} size={15} color={colors.textMuted} />
      <Text importantForAccessibility="no" style={[typo.meta, { color: colors.textMuted, flex: 1 }]}>
        {text}
      </Text>
    </View>
  );
}
