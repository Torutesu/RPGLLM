import React, { useEffect, useRef } from "react";
import { Animated, Text, View } from "react-native";
import { T, colors, gradients, radius, spacing } from "@rpgllm/shared";
import { useT } from "../state/store";
import { BUILD_STEPS, stepIndex } from "../studio/labels";
import { Gradient, Icon, Pulse, duration, ease, timing, typo, useAnimatedValue, useReduceMotion } from "../ui";

/**
 * SCR-049 — the wait, as a beat rather than a spinner.
 *
 * A world takes about a minute to generate. A spinner would make that minute feel like a failure;
 * four named steps make it feel like something is being *made for you* — the bible, then the cast,
 * then the covers, then the feed. The bar only ever moves forward: the API's `progress` is the
 * truth, and a step that has been passed stays lit even if a later poll answers lower.
 */

function Step({ label, state, delay }: { label: string; state: "done" | "active" | "todo"; delay: number }) {
  const tint = state === "done" ? colors.positive : state === "active" ? colors.accentHi : colors.textMuted;
  const dot = (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: radius.pill,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: state === "todo" ? "transparent" : `${tint}22`,
        borderWidth: 1,
        borderColor: state === "todo" ? colors.border : `${tint}66`,
      }}
    >
      {state === "done" ? (
        <Icon name="check" size={12} color={tint} />
      ) : state === "active" ? (
        <Icon name="sparkle" size={12} color={tint} filled />
      ) : (
        <View style={{ width: 5, height: 5, borderRadius: radius.pill, backgroundColor: colors.borderHi }} />
      )}
    </View>
  );
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.xs, opacity: state === "todo" ? 0.55 : 1 }}
    >
      {state === "active" ? <Pulse scaleTo={1.12}>{dot}</Pulse> : dot}
      <Text
        importantForAccessibility="no"
        numberOfLines={1}
        style={[state === "todo" ? typo.meta : typo.metaStrong, { color: state === "todo" ? colors.textMuted : colors.text, flex: 1 }]}
      >
        {label}
      </Text>
      {state === "active" ? <FloatingDots delay={delay} /> : null}
    </View>
  );
}

/** Three dots breathing in sequence — the "still thinking" tell, without a spinner. */
function FloatingDots({ delay }: { delay: number }) {
  const anim = useAnimatedValue(0);
  const reduce = useReduceMotion();
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        timing(anim, 1, { duration: duration.celebration, easing: ease.inOut, delay }),
        timing(anim, 0, { duration: duration.celebration, easing: ease.inOut }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [anim, delay, reduce]);
  return (
    <View style={{ flexDirection: "row", gap: 3 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[0, 1, 2].map((i) => (
        <Animated.View
          key={i}
          style={{
            width: 4,
            height: 4,
            borderRadius: radius.pill,
            backgroundColor: colors.accentHi,
            opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.25 + i * 0.15, 1] }),
          }}
        />
      ))}
    </View>
  );
}

export function StudioProgress({ progress }: { progress: number }) {
  const { t } = useT();
  const clamped = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  // Monotonic: a poll that answers lower never drags the bar backwards.
  const peak = useRef(clamped);
  peak.current = Math.max(peak.current, clamped);
  const shown = peak.current;
  const active = stepIndex(shown);

  const anim = useAnimatedValue(shown);
  const reduce = useReduceMotion();
  useEffect(() => {
    if (reduce) {
      anim.setValue(shown);
      return;
    }
    const run = timing(anim, shown, { duration: duration.slow, easing: ease.out, useNativeDriver: false });
    run.start();
    return () => run.stop();
  }, [anim, shown, reduce]);

  const width = anim.interpolate({ inputRange: [0, 1], outputRange: ["4%", "100%"] });
  const percent = Math.round(shown * 100);

  return (
    <View style={{ gap: spacing.lg }}>
      <View
        testID={T.studioProgress}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: percent }}
        accessibilityLabel={`${t("studioBuilding")} ${percent}%`}
        style={{ height: 6, borderRadius: radius.pill, backgroundColor: colors.bgElevated, overflow: "hidden" }}
      >
        <Animated.View style={{ height: 6, width }}>
          <Gradient colors={gradients.brand} angle={90} style={{ flex: 1, borderRadius: radius.pill }} />
        </Animated.View>
      </View>

      <View style={{ gap: spacing.xs }}>
        {BUILD_STEPS.map((step, i) => (
          <View key={step.key} testID={T.studioStep(step.key)}>
            <Step label={t(step.label)} state={i < active ? "done" : i === active ? "active" : "todo"} delay={i * 120} />
          </View>
        ))}
      </View>
    </View>
  );
}
