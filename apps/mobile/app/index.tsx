import React from "react";
import { ActivityIndicator } from "react-native";
import { Redirect } from "expo-router";
import { colors } from "@rpgllm/shared";
import { useAppState } from "../src/state/store";
import { Centered, Screen } from "../src/components/ui";

/** Entry router: no session → auth, no persona → onboarding, otherwise the feed. */
export default function Index() {
  const { booted, token, me } = useAppState();

  if (!booted) {
    return (
      <Screen>
        <Centered>
          <ActivityIndicator color={colors.accent} />
        </Centered>
      </Screen>
    );
  }
  if (!token) return <Redirect href="/auth" />;
  if (!me) {
    return (
      <Screen>
        <Centered>
          <ActivityIndicator color={colors.accent} />
        </Centered>
      </Screen>
    );
  }
  if (me.user.birthYear === null) return <Redirect href="/auth" />;
  if (!me.persona) return <Redirect href="/onboarding/scenario" />;
  return <Redirect href="/feed" />;
}
