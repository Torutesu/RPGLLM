import React, { useEffect, useMemo } from "react";
import { Animated, View, type ViewStyle } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";
import { colors, hashString, identityPalette, radius, spacing } from "@rpgllm/shared";
import { duration, ease, timing, useAnimatedValue, useReduceMotion } from "../ui";

/**
 * First-run brand chrome — the two things the shared visual system (`src/ui`, Agent J) does not
 * cover, because they only exist here: a *radial* identity orb (expo-linear-gradient is linear
 * only) and the three-step spine of onboarding. Everything else on these screens comes from
 * `src/ui` and `src/components/ui`.
 */

/** RN 0.86 dropped `StyleSheet.absoluteFillObject` from the public types. */
export const FILL: ViewStyle = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 };

/**
 * A soft radial orb. Used as the halo behind a chosen persona, the glow inside the world-loading
 * ripple, and as one lobe of the aurora background.
 */
export function SoftOrb({ from, to, size, style }: { from: string; to: string; size: number; style?: ViewStyle }) {
  const uid = useMemo(() => `orb${hashString(`${from}${to}${size}`).toString(36)}`, [from, to, size]);
  return (
    <View pointerEvents="none" style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <RadialGradient id={uid} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={from} stopOpacity="0.95" />
            <Stop offset="0.5" stopColor={to} stopOpacity="0.42" />
            <Stop offset="1" stopColor={to} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Circle cx="50" cy="50" r="50" fill={`url(#${uid})`} />
      </Svg>
    </View>
  );
}

/**
 * The living background of the first run: three identity-palette orbs drifting behind the content.
 * Seeded by the screen (or the world slug), so each step has its own colour temperature and the
 * same screen always breathes the same way. Still under `prefers-reduced-motion`.
 */
export function Aurora({ seed, intensity = 1 }: { seed: string; intensity?: number }) {
  const reduce = useReduceMotion();
  const drift = useAnimatedValue(0);
  const orbs = useMemo(() => {
    const h = hashString(seed);
    return [0, 1, 2].map((i) => {
      const pair = identityPalette[(h + i * 5) % identityPalette.length] ?? identityPalette[0]!;
      return {
        from: pair[0],
        to: pair[1],
        size: 280 + ((h >> (i * 3)) % 5) * 44,
        left: -70 + ((h >> (i * 4)) % 7) * 48,
        top: -90 + ((h >> (i * 2)) % 9) * 56,
        dx: i % 2 === 0 ? 28 : -24,
        dy: i === 1 ? -22 : 20,
      };
    });
  }, [seed]);

  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        timing(drift, 1, { duration: 15000, easing: ease.inOut }),
        timing(drift, 0, { duration: 15000, easing: ease.inOut }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [drift, reduce]);

  // Clipped: the orbs are wider than the screen, and an unclipped absolute child would give the
  // page a horizontal scrollbar on web.
  return (
    <View pointerEvents="none" style={[FILL, { overflow: "hidden" }]}>
      {orbs.map((o, i) => (
        <Animated.View
          key={`${o.from}-${i}`}
          style={{
            position: "absolute",
            left: o.left,
            top: o.top,
            opacity: 0.45 * intensity,
            transform: [
              { translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [0, o.dx] }) },
              { translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [0, o.dy] }) },
            ],
          }}
        >
          <SoftOrb from={o.from} to={o.to} size={o.size} />
        </Animated.View>
      ))}
    </View>
  );
}

/** The three-step spine of the first run (story → persona → follower). Decorative. */
export function StepDots({ step, total = 3 }: { step: number; total?: number }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ flexDirection: "row", gap: spacing.xs, alignItems: "center" }}
    >
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={{
            height: 4,
            width: i === step ? 22 : 10,
            borderRadius: radius.pill,
            backgroundColor: i === step ? colors.accentHi : i < step ? colors.accentMuted : colors.border,
          }}
        />
      ))}
    </View>
  );
}

/** A circle filled with any gradient the linear system provides. */
export function Round({ size, children, style }: { size: number; children: React.ReactNode; style?: ViewStyle }) {
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, overflow: "hidden" }, style]}>{children}</View>
  );
}

export { duration, ease, timing, useAnimatedValue, useReduceMotion };
