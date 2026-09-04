import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

export interface GradientProps {
  /** Two or more stops. A single colour is padded so the gradient stays valid. */
  colors: readonly string[];
  /** CSS convention: 0° paints upward, 90° to the right, 180° downward (the default). */
  angle?: number;
  /** Stop positions in 0..1; must match `colors` in length when given. */
  locations?: readonly number[];
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
}

type Stops = readonly [string, string, ...string[]];

function toStops(colors: readonly string[]): Stops {
  const first = colors[0] ?? "transparent";
  if (colors.length >= 2) return colors as unknown as Stops;
  return [first, first];
}

/**
 * One linear gradient interface for web and native.
 *
 * `expo-linear-gradient` renders a real CSS gradient on web and a native gradient layer on
 * iOS/Android, so the same `angle` produces the same picture everywhere. Angles are expressed the
 * way CSS does it, then converted to the start/end unit points the native module wants.
 */
export function Gradient({
  colors,
  angle = 180,
  locations,
  style,
  children,
  pointerEvents,
}: GradientProps) {
  const rad = ((angle - 90) * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const start = { x: 0.5 - dx / 2, y: 0.5 - dy / 2 };
  const end = { x: 0.5 + dx / 2, y: 0.5 + dy / 2 };
  const stops = toStops(colors);
  return (
    <LinearGradient
      colors={stops}
      start={start}
      end={end}
      {...(locations && locations.length === stops.length
        ? { locations: locations as unknown as readonly [number, number, ...number[]] }
        : {})}
      style={style}
      pointerEvents={pointerEvents}
    >
      {children}
    </LinearGradient>
  );
}

/**
 * A gradient hairline — the 1px rule that stops a divider looking like a table border.
 * Fades out at both ends so stacked cards read as one surface.
 */
export function GradientRule({
  color,
  height = 1,
  style,
}: {
  color: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Gradient
      colors={["transparent", color, "transparent"]}
      angle={90}
      style={[{ height }, style]}
      pointerEvents="none"
    />
  );
}

/** A flat scrim used behind sheets and overlays; kept here so callers import one module. */
export function Scrim({ color, style }: { color: string; style?: StyleProp<ViewStyle> }) {
  return <View pointerEvents="none" style={[{ backgroundColor: color }, style]} />;
}
