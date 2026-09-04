import React from "react";
import { ActivityIndicator } from "react-native";
import { Redirect } from "expo-router";
import { colors } from "@rpgllm/shared";
import { useAppState, useT } from "../src/state/store";
import { Centered, Screen } from "../src/components/ui";

/** Entry router: no session → auth, no persona → onboarding, otherwise the feed. */
export default function Index() {
  const { booted, token, me } = useAppState();
  const { t } = useT();

  if (!booted) {
    return (
      <Screen>
        <Centered>
          <ActivityIndicator
            color={colors.accent}
            accessibilityRole="progressbar"
            accessibilityLabel={t("wakingUp")}
            accessibilityLiveRegion="polite"
          />
        </Centered>
      </Screen>
    );
  }
  if (!token) return <Redirect href="/auth" />;
  if (!me) {
    return (
      <Screen>
        <Centered>
          <ActivityIndicator
            color={colors.accent}
            accessibilityRole="progressbar"
            accessibilityLabel={t("wakingUp")}
            accessibilityLiveRegion="polite"
          />
        </Centered>
      </Screen>
    );
  }
  if (me.user.birthYear === null) return <Redirect href="/auth" />;
  if (!me.persona) return <Redirect href="/onboarding/scenario" />;
  return <Redirect href="/feed" />;
}
