import React from "react";
import { Pressable, Text, View } from "react-native";
import { Tabs, router } from "expo-router";
import { T, colors, font, spacing } from "@rpgllm/shared";
import { useT } from "../../src/state/store";

function TabBar({ activeName }: { activeName: string }) {
  const { t } = useT();
  const items = [
    { name: "feed", label: t("feed"), testID: T.tabFeed, href: "/feed" as const },
    { name: "dms", label: t("dms"), testID: T.tabDms, href: "/dms" as const },
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
            onPress={() => router.replace(it.href)}
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
