import React, { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import { Tabs, router } from "expo-router";
import { T, colors, font, radius, spacing } from "@rpgllm/shared";
import { useActions, useAppState, useT } from "../../src/state/store";

/** Agent L: the unread pip on the Notifications tab — the thing that pulls people back in. */
function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <View
      testID={T.notifBadge}
      accessibilityRole="text"
      accessibilityLabel={`${count} unread`}
      style={{
        position: "absolute",
        top: -6,
        right: -14,
        minWidth: 18,
        paddingHorizontal: 5,
        height: 18,
        borderRadius: radius.pill,
        backgroundColor: colors.hot,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: colors.bg,
      }}
    >
      <Text importantForAccessibility="no" style={{ color: colors.text, fontSize: font.xxs, fontWeight: "800" }}>
        {count > 99 ? "99+" : count}
      </Text>
    </View>
  );
}

function TabBar({ activeName }: { activeName: string }) {
  const { t } = useT();
  const { me, notifUnread, streaming } = useAppState();
  const { loadNotifications } = useActions();
  const personaId = me?.persona?.id ?? null;

  // The badge has to appear the moment a reply lands, so the count is refreshed when a persona
  // exists and again whenever a post/DM stream finishes.
  useEffect(() => {
    if (!personaId || streaming) return;
    void loadNotifications();
  }, [personaId, streaming, loadNotifications]);

  // Agent H (S2-6): the profile is a stack route (`app/profile.tsx`), so its tab pushes instead of
  // replacing — the header's back button returns to the tab you came from. Notifications (SCR-042)
  // is the same shape.
  const items = [
    { name: "feed", label: t("feed"), testID: T.tabFeed, href: "/feed" as const, push: false, badge: 0 },
    // Agent K: Explore (SCR-046) is a stack route like the profile, so its tab pushes.
    { name: "explore", label: t("explore"), testID: T.tabExplore, href: "/explore" as const, push: true, badge: 0 },
    { name: "dms", label: t("dms"), testID: T.tabDms, href: "/dms" as const, push: false, badge: 0 },
    /*
     * WS-CLIENT: no Studio tab here. A sixth item does not fit at 390pt — "Notifications" alone
     * needs more than a sixth of the bar, so adding one truncates two labels. The World Studio is
     * entered from the world picker, Explore and the profile instead; see build-notes for what a
     * `tab-studio` item would need (a short notifications label, or an icon-first bar).
     */
    { name: "notifications", label: t("notifications"), testID: T.tabNotifications, href: "/notifications" as const, push: true, badge: notifUnread },
    { name: "profile", label: t("profile"), testID: T.tabProfile, href: "/profile" as const, push: true, badge: 0 },
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
            accessibilityRole="tab"
            accessibilityLabel={it.badge > 0 ? `${it.label}, ${it.badge} unread` : it.label}
            accessibilityState={{ selected: active }}
            onPress={() => (it.push ? router.push(it.href) : router.replace(it.href))}
            style={{ flex: 1, alignItems: "center", paddingVertical: spacing.md }}
          >
            <View>
              <Text
                importantForAccessibility="no"
                numberOfLines={1}
                style={{ color: active ? colors.accent : colors.textMuted, fontSize: font.sm, fontWeight: "700" }}
              >
                {it.label}
              </Text>
              <UnreadBadge count={it.badge} />
            </View>
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
