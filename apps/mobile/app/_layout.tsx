import React from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { colors } from "@rpgllm/shared";
import { EngagementOverlay } from "../src/components/Celebration";
import { AppProvider } from "../src/state/store";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Screen name="compose" options={{ presentation: "modal" }} />
          <Stack.Screen name="energy" options={{ presentation: "modal" }} />
          <Stack.Screen name="paywall" options={{ presentation: "modal" }} />
          <Stack.Screen name="event/[id]" options={{ presentation: "modal" }} />
        </Stack>
        {/* Agent L: the app-wide engagement layer (SCR-045 celebration + the daily streak card). */}
        <EngagementOverlay />
      </AppProvider>
    </SafeAreaProvider>
  );
}
