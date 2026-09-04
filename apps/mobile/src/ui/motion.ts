import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, type EasingFunction } from "react-native";
import * as Haptics from "expo-haptics";
import { motion } from "@rpgllm/shared";

/**
 * Motion helpers.
 *
 * `react-native-reanimated` is deliberately not used here — see build-notes "Agent J". Adding it to
 * this workspace needs a `babel.config.js` and a worklets runtime that the other agents' web export
 * would have to absorb mid-flight. Everything the design calls for (digit rolls, entrance stagger,
 * shimmer, a like burst) is expressible with React Native's own `Animated`, which already runs on
 * web through react-native-web with no build change.
 */

/** Token cubic-beziers, as Easing functions. */
export const ease = {
  out: Easing.bezier(motion.easeOut[0], motion.easeOut[1], motion.easeOut[2], motion.easeOut[3]),
  inOut: Easing.bezier(motion.easeInOut[0], motion.easeInOut[1], motion.easeInOut[2], motion.easeInOut[3]),
  overshoot: Easing.bezier(motion.overshoot[0], motion.overshoot[1], motion.overshoot[2], motion.overshoot[3]),
  linear: Easing.linear,
} as const satisfies Record<string, EasingFunction>;

/**
 * The native driver only exists on iOS/Android; asking for it on web logs a warning on every
 * animation and falls back to JS anyway.
 */
export const NATIVE_DRIVER = Platform.OS !== "web";

export const duration = {
  instant: motion.instant,
  fast: motion.fast,
  base: motion.base,
  slow: motion.slow,
  celebration: motion.celebration,
} as const;

/** `Animated.timing` with the house defaults already applied. */
export function timing(
  value: Animated.Value,
  toValue: number,
  opts?: { duration?: number; easing?: EasingFunction; delay?: number; useNativeDriver?: boolean },
): Animated.CompositeAnimation {
  return Animated.timing(value, {
    toValue,
    duration: opts?.duration ?? duration.base,
    easing: opts?.easing ?? ease.out,
    delay: opts?.delay ?? 0,
    useNativeDriver: opts?.useNativeDriver ?? NATIVE_DRIVER,
  });
}

/**
 * Respects the OS "reduce motion" setting. Every animated primitive in `anim.tsx` checks this and
 * jumps straight to the end state instead of moving.
 */
export function useReduceMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (alive) setReduced(v);
    });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => setReduced(v));
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

export type HapticKind = "light" | "medium" | "heavy" | "success" | "warning" | "error" | "selection";

/**
 * Haptics where the platform has them, a silent no-op where it does not (web, and any device that
 * refuses the call). Never throws — a missing taptic engine must not break a button.
 */
export function useHaptic(): (kind?: HapticKind) => void {
  return useCallback((kind: HapticKind = "light") => {
    if (Platform.OS === "web") return;
    try {
      switch (kind) {
        case "selection":
          void Haptics.selectionAsync();
          return;
        case "success":
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          return;
        case "warning":
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          return;
        case "error":
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          return;
        case "heavy":
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          return;
        case "medium":
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          return;
        default:
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch {
      /* haptics are a garnish */
    }
  }, []);
}

/** A stable `Animated.Value` for the life of the component. */
export function useAnimatedValue(initial: number): Animated.Value {
  const ref = useRef<Animated.Value | null>(null);
  if (ref.current === null) ref.current = new Animated.Value(initial);
  return ref.current;
}

/** Fires `fn` on every change of `value` except the first render. */
export function useOnChange<T>(value: T, fn: (next: T, prev: T) => void): void {
  const prev = useRef<T>(value);
  useEffect(() => {
    if (prev.current !== value) {
      const before = prev.current;
      prev.current = value;
      fn(value, before);
    }
  }, [value, fn]);
}
