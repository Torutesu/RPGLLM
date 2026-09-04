import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { T, colors, font, radius, spacing } from "@rpgllm/shared";
import { useActions, useAppState, useT } from "../../src/state/store";
import { Button, Screen } from "../../src/components/ui";
import { SkeletonList } from "../../src/components/Skeleton";
import { Avatar } from "../../src/components/Avatar";

/** SCR-006 — first follower, then persona creation with the themed overlay. */
export default function FirstFollower() {
  const { world, worldStatus, draft } = useAppState();
  const { loadWorld, createPersona } = useActions();
  const { t } = useT();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (draft?.worldId) void loadWorld(draft.worldId);
  }, [draft?.worldId, loadWorld]);

  const candidates = (world?.characters ?? []).filter((c) => c.canBeFirstFollower);

  const onEnter = async () => {
    if (!selected) return;
    setError(null);
    setCreating(true);
    const res = await createPersona(selected);
    setCreating(false);
    if (res.ok) router.replace("/feed");
    else setError(t("notSent"));
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
        <Text accessibilityRole="header" style={{ color: colors.text, fontSize: font.xl, fontWeight: "800" }}>
          {t("chooseFollower")}
        </Text>
        {worldStatus === "loading" && !world ? <SkeletonList count={3} /> : null}
        {candidates.map((c) => {
          const active = selected === c.id;
          return (
            <Pressable
              key={c.id}
              testID={T.follower(c.handle)}
              onPress={() => setSelected(c.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active, checked: active }}
              accessibilityLabel={`${c.displayName} @${c.handle}. ${c.role}. ${c.intro}`}
              style={{
                flexDirection: "row",
                gap: spacing.md,
                alignItems: "center",
                backgroundColor: colors.card,
                borderRadius: radius.lg,
                borderWidth: 2,
                borderColor: active ? colors.accent : colors.border,
                padding: spacing.lg,
              }}
            >
              <Avatar handle={c.handle} size={44} />
              <View style={{ flex: 1 }} importantForAccessibility="no-hide-descendants">
                <Text style={{ color: colors.text, fontSize: font.md, fontWeight: "700" }}>
                  {`${c.displayName} @${c.handle}`}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: font.xs }}>{c.role}</Text>
                <Text style={{ color: colors.textMuted, fontSize: font.sm, marginTop: spacing.xs }} numberOfLines={2}>
                  {c.intro}
                </Text>
              </View>
            </Pressable>
          );
        })}
        {error ? (
          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={{ color: colors.danger, fontSize: font.sm }}
          >
            {error}
          </Text>
        ) : null}
        <Button testID={T.enterWorld} label={t("enterWorld")} onPress={onEnter} disabled={!selected || creating} />
      </ScrollView>

      {creating ? (
        <View
          testID={T.worldLoading}
          accessibilityRole="progressbar"
          accessibilityLabel={t("planting")}
          accessibilityLiveRegion="polite"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: colors.overlay,
            alignItems: "center",
            justifyContent: "center",
            gap: spacing.lg,
          }}
        >
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={{ color: colors.text, fontSize: font.lg }}>{t("planting")}</Text>
        </View>
      ) : null}
    </Screen>
  );
}
