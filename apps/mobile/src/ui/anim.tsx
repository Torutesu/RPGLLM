import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { colors, font, radius as radii } from "@rpgllm/shared";
import { Gradient } from "./Gradient";
import { duration, ease, timing, useAnimatedValue, useReduceMotion } from "./motion";

const HIDDEN = {
  accessibilityElementsHidden: true,
  importantForAccessibility: "no-hide-descendants",
} as const;

/* -------------------------------------------------------------- numbers ---- */

function Digit({ char, up, textStyle, height }: { char: string; up: boolean; textStyle: StyleProp<TextStyle>; height: number }) {
  const anim = useAnimatedValue(0);
  const reduce = useReduceMotion();
  const [outgoing, setOutgoing] = useState<string | null>(null);
  const current = useRef(char);

  useEffect(() => {
    if (current.current === char) return;
    const from = current.current;
    current.current = char;
    if (reduce) return;
    setOutgoing(from);
    anim.setValue(0);
    const run = timing(anim, 1, { duration: duration.base, easing: ease.out });
    run.start(() => setOutgoing(null));
    return () => run.stop();
  }, [char, reduce, anim]);

  // Idle state renders exactly one glyph, so the node's text is always the real value.
  if (outgoing === null) {
    return <Text style={[textStyle, { height, lineHeight: height }]}>{char}</Text>;
  }
  const first = up ? outgoing : char;
  const second = up ? char : outgoing;
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: up ? [0, -height] : [-height, 0] });
  return (
    <View style={{ height, overflow: "hidden" }}>
      <Animated.View style={{ transform: [{ translateY }] }}>
        <Text style={[textStyle, { height, lineHeight: height }]}>{first}</Text>
        <Text style={[textStyle, { height, lineHeight: height }]}>{second}</Text>
      </Animated.View>
    </View>
  );
}

export interface AnimatedNumberProps {
  value: number;
  /** e.g. `compactNumber` for follower counts. Defaults to the plain integer. */
  format?: (n: number) => string;
  style?: StyleProp<TextStyle>;
  testID?: string;
  /** Supply to put the number in the accessibility tree; otherwise the parent control names it. */
  label?: string;
}

/**
 * A number whose digits roll when it changes — up when it grew, down when it shrank.
 *
 * This is the difference between a follower count that is a fact and one that feels like it is
 * happening to you. Only the digits that actually changed move.
 */
export function AnimatedNumber({ value, format, style, testID, label }: AnimatedNumberProps) {
  const text = (format ?? String)(value);
  const previous = useRef(value);
  const up = value >= previous.current;
  useEffect(() => {
    previous.current = value;
  }, [value]);

  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  const size = typeof flat?.fontSize === "number" ? flat.fontSize : font.md;
  const height = Math.ceil(size * 1.3);
  const a11y = label === undefined ? HIDDEN : ({ accessibilityRole: "text", accessibilityLabel: label } as const);

  return (
    <View testID={testID} {...a11y} style={{ flexDirection: "row", alignItems: "center" }}>
      {text.split("").map((c, i) => (
        <Digit key={i} char={c} up={up} textStyle={style} height={height} />
      ))}
    </View>
  );
}

/* --------------------------------------------------------------- motion ---- */

/** A slow breathing scale — for anything that wants to be noticed without shouting. */
export function Pulse({
  children,
  active = true,
  scaleTo = 1.06,
  style,
}: {
  children: React.ReactNode;
  active?: boolean;
  scaleTo?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const anim = useAnimatedValue(0);
  const reduce = useReduceMotion();
  useEffect(() => {
    if (!active || reduce) {
      anim.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        timing(anim, 1, { duration: duration.celebration, easing: ease.inOut }),
        timing(anim, 0, { duration: duration.celebration, easing: ease.inOut }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, reduce, anim]);
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [1, scaleTo] });
  return <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>;
}

const BURST_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

/**
 * The particle burst on a like. `trigger` is a counter: bump it and the burst plays once.
 * Rendered as an absolutely-positioned overlay so it never affects layout.
 */
export function Burst({
  trigger,
  color = colors.hot,
  size = 34,
}: {
  trigger: number;
  color?: string;
  size?: number;
}) {
  const anim = useAnimatedValue(0);
  const reduce = useReduceMotion();
  const [playing, setPlaying] = useState(false);
  const seen = useRef(trigger);

  useEffect(() => {
    if (seen.current === trigger) return;
    seen.current = trigger;
    if (reduce || trigger <= 0) return;
    setPlaying(true);
    anim.setValue(0);
    const run = timing(anim, 1, { duration: duration.slow, easing: ease.out });
    run.start(() => setPlaying(false));
    return () => run.stop();
  }, [trigger, reduce, anim]);

  if (!playing) return null;
  const spread = size * 0.72;
  const ringScale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1.5] });
  const ringOpacity = anim.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0.75, 0.45, 0] });
  const dotOpacity = anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.9, 0] });
  const dotScale = anim.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0.4, 1, 0.2] });
  return (
    <View {...HIDDEN} pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
      <Animated.View
        style={{
          position: "absolute",
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 2,
          borderColor: color,
          opacity: ringOpacity,
          transform: [{ scale: ringScale }],
        }}
      />
      {BURST_ANGLES.map((deg) => {
        const rad = (deg * Math.PI) / 180;
        const tx = anim.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(rad) * spread] });
        const ty = anim.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(rad) * spread] });
        return (
          <Animated.View
            key={deg}
            style={{
              position: "absolute",
              width: 4,
              height: 4,
              borderRadius: 2,
              backgroundColor: color,
              opacity: dotOpacity,
              transform: [{ translateX: tx }, { translateY: ty }, { scale: dotScale }],
            }}
          />
        );
      })}
    </View>
  );
}

/** Entrance for list rows: fade up, staggered by `delay`. */
export function FadeSlideIn({
  children,
  delay = 0,
  distance = 12,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  distance?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const anim = useAnimatedValue(0);
  const reduce = useReduceMotion();
  useEffect(() => {
    if (reduce) {
      anim.setValue(1);
      return;
    }
    const run = timing(anim, 1, { duration: duration.slow, easing: ease.out, delay });
    run.start();
    return () => run.stop();
  }, [anim, delay, reduce]);
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] });
  return <Animated.View style={[style, { opacity: anim, transform: [{ translateY }] }]}>{children}</Animated.View>;
}

/**
 * A skeleton block with a highlight sweeping across it. A static grey box reads as broken;
 * a moving one reads as loading.
 */
export function Shimmer({
  width,
  height,
  radius = radii.sm,
  style,
}: {
  width?: number | `${number}%`;
  height: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const anim = useAnimatedValue(0);
  const reduce = useReduceMotion();
  const [measured, setMeasured] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        timing(anim, 1, { duration: 1100, easing: ease.inOut }),
        Animated.delay(280),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [anim, reduce]);

  const band = Math.max(80, measured * 0.55);
  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [-band, measured + band] });

  return (
    <View
      {...HIDDEN}
      onLayout={(e) => setMeasured(e.nativeEvent.layout.width)}
      style={[
        {
          height,
          borderRadius: radius,
          backgroundColor: colors.bgElevated,
          overflow: "hidden",
        },
        width === undefined ? { alignSelf: "stretch" } : { width },
        style,
      ]}
    >
      {measured > 0 && !reduce ? (
        <Animated.View style={{ position: "absolute", top: 0, bottom: 0, width: band, transform: [{ translateX }] }}>
          <Gradient
            colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.07)", "rgba(255,255,255,0)"]}
            angle={90}
            style={{ flex: 1 }}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

/** Scales its child down while pressed. Wrap the *contents* of a Pressable. */
export function PressScale({
  pressed,
  children,
  to = 0.96,
  style,
}: {
  pressed: boolean;
  children: React.ReactNode;
  to?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const anim = useAnimatedValue(1);
  const reduce = useReduceMotion();
  useEffect(() => {
    if (reduce) return;
    const run = timing(anim, pressed ? to : 1, { duration: duration.instant, easing: ease.out });
    run.start();
    return () => run.stop();
  }, [pressed, to, anim, reduce]);
  return <Animated.View style={[style, { transform: [{ scale: anim }] }]}>{children}</Animated.View>;
}
