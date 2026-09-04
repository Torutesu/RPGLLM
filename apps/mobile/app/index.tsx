import React, { useEffect } from "react";
import { Animated, Text, View } from "react-native";
import { Redirect } from "expo-router";
import { colors, spacing } from "@rpgllm/shared";
import { useAppState, useT } from "../src/state/store";
import { Screen, Wordmark } from "../src/components/ui";
import { Aurora } from "../src/components/Brand";
import { duration, ease, timing, typo, useAnimatedValue, useReduceMotion } from "../src/ui";

/** Entry router: no session → auth, no persona → onboarding, otherwise the feed. */
export default function Index() {
  const { booted, token, me } = useAppState();

  if (!booted) return <Splash />;
  if (!token) return <Redirect href="/auth" />;
  if (!me) return <Splash />;
  if (me.user.birthYear === null) return <Redirect href="/auth" />;
  if (!me.persona) return <Redirect href="/onboarding/scenario" />;
  return <Redirect href="/feed" />;
}

/**
 * Branded boot state.
 *
 * It fades in *after* a short delay: a warm boot resolves in well under that, so the common path
 * never shows a flash of splash, and the ground is the app background so there is no white frame
 * either.
 */
function Splash() {
  const { t } = useT();
  const reduce = useReduceMotion();
  const enter = useAnimatedValue(0);
  const pulse = useAnimatedValue(0);

  useEffect(() => {
    const a = timing(enter, 1, { duration: reduce ? 0 : duration.base, delay: 180, easing: ease.out });
    a.start();
    return () => a.stop();
  }, [enter, reduce]);

  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        timing(pulse, 1, { duration: 900, easing: ease.inOut }),
        timing(pulse, 0, { duration: 900, easing: ease.inOut }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduce]);

  return (
    <Screen wash={false}>
      <Animated.View style={{ flex: 1, opacity: enter }}>
        <Aurora seed="status-boot" intensity={0.45} />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg }}>
          <Wordmark size={44} />
          <Animated.View
            accessibilityRole="progressbar"
            accessibilityLabel={t("wakingUp")}
            accessibilityLiveRegion="polite"
            style={{ opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) }}
          >
            <Text importantForAccessibility="no" style={[typo.micro, { color: colors.textMuted }]}>
              {t("wakingUp")}
            </Text>
          </Animated.View>
        </View>
      </Animated.View>
    </Screen>
  );
}
