import React, { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import Svg, { Defs, LinearGradient, Stop, Text as SvgText } from "react-native-svg";
import { colors, elevation, font, gradients, layout, radius, spacing } from "@rpgllm/shared";
import { useT } from "../state/store";
import { Gradient, Icon, typo, useFontsLoaded, useHaptic, type IconName } from "../ui";

/* ---------------------------------------------------------------- screen ---- */

/**
 * Every screen sits on the same near-black ground with one soft violet wash at the top, which is
 * what stops a dark app reading as a flat void. The wash is decorative and never intercepts taps.
 */
export function Screen({
  children,
  style,
  wash = true,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  wash?: boolean;
}) {
  // Re-render once the real faces land so native picks them up (no-op on web).
  useFontsLoaded();
  return (
    <View style={[{ flex: 1, backgroundColor: colors.bg }, style]}>
      {wash ? (
        <Gradient
          colors={[
            "rgba(124,92,255,0.16)",
            "rgba(124,92,255,0.07)",
            "rgba(255,61,139,0.03)",
            "rgba(124,92,255,0)",
          ]}
          locations={[0, 0.4, 0.72, 1]}
          angle={168}
          pointerEvents="none"
          style={{ position: "absolute", left: 0, right: 0, top: 0, height: 460 }}
        />
      ) : null}
      {children}
    </View>
  );
}

export function Centered({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.lg }}>
      {children}
    </View>
  );
}

/* ---------------------------------------------------------------- button ---- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const FOCUS_RING = Platform.OS === "web";

/**
 * The browser's own focus ring is a white rectangle that ignores the field's radius. Fields draw
 * their own (the border turns accent on focus), so the default one is suppressed on web only.
 */
const NO_UA_OUTLINE =
  Platform.OS === "web" ? ({ outlineStyle: "none", outlineWidth: 0 } as unknown as TextStyle) : null;

export function Button({
  label,
  onPress,
  testID,
  variant = "primary",
  disabled = false,
  loading = false,
  style,
  icon,
  compact = false,
}: {
  label: string;
  onPress: () => void;
  testID?: string;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Optional leading icon from the SVG set. */
  icon?: IconName;
  compact?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const haptic = useHaptic();
  const off = disabled || loading;
  const fg =
    variant === "primary" ? colors.accentInk : variant === "danger" ? colors.danger : colors.text;
  const padV = compact ? spacing.sm : spacing.md;
  const padH = compact ? spacing.lg : spacing.xl;

  const body = (
    <>
      {loading ? <ActivityIndicator color={fg} size="small" /> : null}
      {icon && !loading ? <Icon name={icon} size={compact ? 15 : 17} color={fg} /> : null}
      <Text importantForAccessibility="no" numberOfLines={1} style={[typo.label, { color: fg, fontSize: compact ? font.sm : font.md }]}>
        {label}
      </Text>
    </>
  );

  const inner = { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm } as const;

  return (
    <Pressable
      testID={testID}
      onPress={() => {
        haptic("light");
        onPress();
      }}
      disabled={off}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off, busy: loading }}
      style={({ pressed }) => [
        {
          borderRadius: radius.pill,
          opacity: off ? 0.42 : 1,
          transform: [{ scale: pressed && !off ? 0.975 : 1 }],
          overflow: "hidden",
        },
        variant === "primary" && !off ? elevation.low : null,
        style,
      ]}
    >
      {({ pressed }) => (
        <View style={{ borderRadius: radius.pill, overflow: "hidden" }}>
          {variant === "primary" ? (
            <Gradient colors={gradients.brand} angle={115} style={[inner, { paddingVertical: padV, paddingHorizontal: padH }]}>
              {body}
            </Gradient>
          ) : (
            <View
              style={[
                inner,
                {
                  paddingVertical: padV,
                  paddingHorizontal: padH,
                  backgroundColor:
                    variant === "secondary" ? (pressed ? colors.cardHi : colors.card) : "transparent",
                  borderWidth: variant === "ghost" || variant === "danger" ? 1 : 1,
                  borderColor:
                    variant === "danger" ? colors.danger : variant === "ghost" ? colors.border : colors.borderHi,
                },
              ]}
            >
              {body}
            </View>
          )}
          {pressed && variant === "primary" ? (
            <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(7,7,12,0.18)" }} />
          ) : null}
          {FOCUS_RING && focused ? (
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: 0,
                bottom: 0,
                borderRadius: radius.pill,
                borderWidth: 2,
                borderColor: colors.accentHi,
              }}
            />
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

/** A round icon-only control: back arrows, close buttons, the settings gear. */
export function IconButton({
  name,
  onPress,
  label,
  testID,
  size = 20,
  color = colors.textDim,
  tone = "plain",
}: {
  name: IconName;
  onPress: () => void;
  label: string;
  testID?: string;
  size?: number;
  color?: string;
  tone?: "plain" | "filled";
}) {
  const haptic = useHaptic();
  const box = size + spacing.lg;
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        haptic("selection");
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={spacing.sm}
      style={({ pressed }) => ({
        width: box,
        height: box,
        borderRadius: radius.pill,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: tone === "filled" ? (pressed ? colors.cardHi : colors.card) : pressed ? colors.cardHi : "transparent",
        borderWidth: tone === "filled" ? 1 : 0,
        borderColor: colors.border,
      })}
    >
      <Icon name={name} size={size} color={color} />
    </Pressable>
  );
}

/* ----------------------------------------------------------------- field ---- */

export function Field({
  label,
  testID,
  hint,
  error,
  ...props
}: TextInputProps & { label?: string; testID?: string; hint?: string; error?: string }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: spacing.xs }}>
      {label ? <Text style={[typo.caption, { color: colors.textDim }]}>{label}</Text> : null}
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
        onFocus={(e) => {
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          props.onBlur?.(e);
        }}
        style={[
          typo.body,
          NO_UA_OUTLINE,
          {
            backgroundColor: colors.card,
            borderColor: error ? colors.danger : focused ? colors.accent : colors.border,
            borderWidth: 1,
            borderRadius: radius.md,
            color: colors.text,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md,
          },
          props.style as object,
        ]}
      />
      {error ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[typo.caption, { color: colors.danger }]}>
          {error}
        </Text>
      ) : null}
      {!error && hint ? <Text style={[typo.caption, { color: colors.textMuted }]}>{hint}</Text> : null}
    </View>
  );
}

/* ---------------------------------------------------------------- header ---- */

export function HeaderBar({
  title,
  right,
  onBack,
}: {
  title: string;
  right?: React.ReactNode;
  onBack?: () => void;
}) {
  const { t } = useT();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: onBack ? spacing.sm : spacing.lg,
        paddingRight: spacing.lg,
        minHeight: layout.headerHeight,
        paddingVertical: spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        backgroundColor: colors.bg,
        gap: spacing.sm,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, flexShrink: 1 }}>
        {onBack ? <IconButton name="chevronLeft" onPress={onBack} label={t("back")} color={colors.text} /> : null}
        <Text numberOfLines={1} accessibilityRole="header" accessibilityLabel={title} style={[typo.h2, { color: colors.text }]}>
          {title}
        </Text>
      </View>
      {right}
    </View>
  );
}

/* -------------------------------------------------------------- wordmark ---- */

/**
 * The brand set in the display face with the brand gradient poured through it. Drawn as SVG text
 * so the gradient fill works identically on web and native (there is no text-mask on RN).
 */
export function Wordmark({ size = font.xl }: { size?: number }) {
  const label = "status";
  const width = Math.ceil(size * 0.6 * label.length + size * 0.3);
  const height = Math.ceil(size * 1.25);
  return (
    <View accessibilityRole="header" accessibilityLabel={label} style={{ width, height, justifyContent: "center" }}>
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <Defs>
          <LinearGradient id="wordmark" x1="0" y1="0" x2="1" y2="0.6">
            <Stop offset="0" stopColor={gradients.brand[0]} />
            <Stop offset="1" stopColor={gradients.brand[1]} />
          </LinearGradient>
        </Defs>
        <SvgText
          x={0}
          y={height * 0.76}
          fill="url(#wordmark)"
          fontSize={size}
          fontWeight="700"
          fontFamily="SpaceGrotesk_700Bold"
          letterSpacing={-1.4}
        >
          {label}
        </SvgText>
      </Svg>
    </View>
  );
}

/* ------------------------------------------------------- rows / sections ---- */

/** A raised surface. Use for anything that should read as an object rather than a strip of feed. */
export function Card({
  children,
  style,
  tone = "card",
  glowColor,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: "card" | "elevated" | "outline";
  glowColor?: string;
}) {
  return (
    <View
      style={[
        {
          backgroundColor: tone === "outline" ? "transparent" : tone === "elevated" ? colors.cardHi : colors.card,
          borderWidth: 1,
          borderColor: glowColor ?? colors.border,
          borderRadius: radius.lg,
          padding: spacing.lg,
        },
        tone === "elevated" ? elevation.mid : elevation.low,
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Small caps label that opens a group of rows. */
export function SectionHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.xl,
        paddingBottom: spacing.sm,
      }}
    >
      <Text accessibilityRole="header" style={[typo.micro, { color: colors.textMuted }]}>
        {title.toUpperCase()}
      </Text>
      {right}
    </View>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  return <View style={{ height: 1, backgroundColor: colors.border, marginLeft: inset }} />;
}

/** A tappable settings-style row with an optional leading icon and trailing chevron. */
export function Row({
  label,
  value,
  onPress,
  testID,
  icon,
  danger = false,
  right,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  testID?: string;
  icon?: IconName;
  danger?: boolean;
  right?: React.ReactNode;
}) {
  const fg = danger ? colors.danger : colors.text;
  const content = (
    <>
      {icon ? <Icon name={icon} size={18} color={danger ? colors.danger : colors.textDim} /> : null}
      <Text style={[typo.body, { color: fg, flex: 1 }]} numberOfLines={1}>
        {label}
      </Text>
      {value ? (
        <Text style={[typo.meta, { color: colors.textMuted }]} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {right}
      {onPress ? <Icon name="chevronRight" size={16} color={colors.textMuted} /> : null}
    </>
  );
  const layoutStyle = {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 48,
  } as const;
  if (!onPress) return <View style={layoutStyle}>{content}</View>;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      style={({ pressed }) => [layoutStyle, { backgroundColor: pressed ? colors.card : "transparent" }]}
    >
      {content}
    </Pressable>
  );
}

/** A small rounded tag: NEWS, a trending topic, a world name. */
export function Chip({
  label,
  color = colors.accent,
  icon,
  testID,
  onPress,
  tone = "tint",
}: {
  label: string;
  color?: string;
  icon?: IconName;
  testID?: string;
  onPress?: () => void;
  tone?: "tint" | "solid" | "outline";
}) {
  const bg = tone === "solid" ? color : tone === "tint" ? `${color}22` : "transparent";
  const fg = tone === "solid" ? colors.textInverse : color;
  const inner = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.xs,
        paddingHorizontal: spacing.sm,
        paddingVertical: 3,
        borderRadius: radius.xs,
        backgroundColor: bg,
        borderWidth: tone === "outline" ? 1 : 0,
        borderColor: color,
      }}
    >
      {icon ? <Icon name={icon} size={11} color={fg} /> : null}
      <Text style={[typo.micro, { color: fg }]}>{label.toUpperCase()}</Text>
    </View>
  );
  if (!onPress) return <View testID={testID}>{inner}</View>;
  return (
    <Pressable testID={testID} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      {inner}
    </Pressable>
  );
}
