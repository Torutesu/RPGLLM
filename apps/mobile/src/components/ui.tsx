import React from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View, type TextInputProps } from "react-native";
import { colors, font, radius, spacing } from "@rpgllm/shared";
import { useT } from "../state/store";

export function Screen({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[{ flex: 1, backgroundColor: colors.bg }, style]}>{children}</View>;
}

export function Button({
  label,
  onPress,
  testID,
  variant = "primary",
  disabled = false,
  loading = false,
  style,
}: {
  label: string;
  onPress: () => void;
  testID?: string;
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
  loading?: boolean;
  style?: object;
}) {
  const bg = variant === "primary" ? colors.accent : variant === "secondary" ? colors.bgElevated : "transparent";
  const fg = variant === "primary" ? colors.bg : colors.text;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      style={[
        {
          backgroundColor: bg,
          opacity: disabled || loading ? 0.5 : 1,
          borderRadius: radius.pill,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.xl,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: variant === "ghost" ? 1 : 0,
          borderColor: colors.border,
          flexDirection: "row",
          gap: spacing.sm,
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} size="small" /> : null}
      <Text style={{ color: fg, fontSize: font.md, fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}

export function Field({
  label,
  testID,
  hint,
  error,
  ...props
}: TextInputProps & { label?: string; testID?: string; hint?: string; error?: string }) {
  return (
    <View style={{ gap: spacing.xs }}>
      {label ? <Text style={{ color: colors.textMuted, fontSize: font.xs }}>{label}</Text> : null}
      {/*
        No `accessibilityRole` on the input: RN's role list has no "textbox", and forcing one of the
        allowed values would override the implicit textbox role a native <input> already exposes on
        web. The visible label (or the placeholder) is the accessible name instead.
      */}
      <TextInput
        testID={testID}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={label ?? props.placeholder}
        accessibilityState={{ disabled: props.editable === false }}
        {...props}
        style={[
          {
            backgroundColor: colors.bgElevated,
            borderColor: error ? colors.danger : colors.border,
            borderWidth: 1,
            borderRadius: radius.md,
            color: colors.text,
            fontSize: font.md,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md,
          },
          props.style as object,
        ]}
      />
      {error ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={{ color: colors.danger, fontSize: font.xs }}
        >
          {error}
        </Text>
      ) : null}
      {!error && hint ? <Text style={{ color: colors.textMuted, fontSize: font.xs }}>{hint}</Text> : null}
    </View>
  );
}

export function HeaderBar({ title, right, onBack }: { title: string; right?: React.ReactNode; onBack?: () => void }) {
  const { t } = useT();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        gap: spacing.md,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, flexShrink: 1 }}>
        {onBack ? (
          <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel={t("close")}>
            <Text importantForAccessibility="no" style={{ color: colors.accent, fontSize: font.lg }}>
              ‹
            </Text>
          </Pressable>
        ) : null}
        <Text
          numberOfLines={1}
          accessibilityRole="header"
          accessibilityLabel={title}
          style={{ color: colors.text, fontSize: font.lg, fontWeight: "700" }}
        >
          {title}
        </Text>
      </View>
      {right}
    </View>
  );
}

export function Wordmark() {
  return (
    <Text accessibilityRole="header" style={{ color: colors.text, fontSize: font.xl, fontWeight: "800", letterSpacing: -1 }}>
      status
    </Text>
  );
}

export function Centered({ children }: { children: React.ReactNode }) {
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.lg }}>{children}</View>;
}
