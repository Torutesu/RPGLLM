import React from "react";
import { Pressable, Text, View } from "react-native";
import { Tabs, router } from "expo-router";
import { T, colors, font, spacing } from "@rpgllm/shared";
import { useT } from "../../src/state/store";

function TabBar({ activeName }: { activeName: string }) {
  const { t } = useT();
  // Agent H (S2-6): the profile is a stack route (`app/profile.tsx`), so its tab pushes instead of
  // replacing — the header's back button returns to the tab you came from.
  const items = [
    { name: "feed", label: t("feed"), testID: T.tabFeed, href: "/feed" as const, push: false },
    { name: "dms", label: t("dms"), testID: T.tabDms, href: "/dms" as const, push: false },
    { name: "profile", label: t("profile"), testID: T.tabProfile, href: "/profile" as const, push: true },
  ];
  return (
    <View
      style={{
        flexDirection: "row",
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: colors.bg,
        paddingBottom: spacing.md,
      }}
    >
      {items.map((it) => {
        const active = activeName === it.name;
        return (
          <Pressable
            key={it.name}
            testID={it.testID}
            accessibilityRole="button"
            accessibilityLabel={it.label}
            onPress={() => (it.push ? router.push(it.href) : router.replace(it.href))}
            style={{ flex: 1, alignItems: "center", paddingVertical: spacing.md }}
          >
            <Text style={{ color: active ? colors.accent : colors.textMuted, fontSize: font.sm, fontWeight: "700" }}>
              {it.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
      tabBar={(props) => <TabBar activeName={props.state.routes[props.state.index]?.name ?? "feed"} />}
    >
      <Tabs.Screen name="feed" />
      <Tabs.Screen name="dms" />
    </Tabs>
  );
}
