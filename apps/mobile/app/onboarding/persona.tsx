import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { T, colors, font, radius, spacing } from "@rpgllm/shared";
import { useActions, useAppState, useT } from "../../src/state/store";
import { Button, Screen } from "../../src/components/ui";
import { SkeletonList } from "../../src/components/Skeleton";
import { Avatar } from "../../src/components/Avatar";

/** SCR-004 — preset persona grid. */
export default function PersonaPicker() {
  const params = useLocalSearchParams<{ worldId?: string }>();
  const { world, worldStatus, draft } = useAppState();
  const { loadWorld, setDraft } = useActions();
  const { t } = useT();
  const [selected, setSelected] = useState<string | null>(null);

  const worldId = params.worldId ?? draft?.worldId ?? "";

  useEffect(() => {
    if (worldId) void loadWorld(worldId);
  }, [loadWorld, worldId]);

  const presets = world?.presetPersonas ?? [];

  const goEdit = () => {
    setDraft({
      worldId,
      worldSlug: world?.world.slug ?? draft?.worldSlug ?? "",
      handle: "",
      displayName: "",
      bio: "",
      avatarUrl: null,
      voiceNotes: "",
    });
    router.push("/onboarding/persona-edit");
  };

  const onContinue = () => {
    const preset = presets.find((p) => p.handle === selected);
    if (!preset) return;
    setDraft({
      worldId,
      worldSlug: world?.world.slug ?? draft?.worldSlug ?? "",
      handle: preset.handle,
      displayName: preset.displayName,
      bio: preset.bio,
      avatarUrl: preset.avatarUrl,
      voiceNotes: "",
    });
    router.push("/onboarding/first-follower");
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
        <Text accessibilityRole="header" style={{ color: colors.text, fontSize: font.xl, fontWeight: "800" }}>
          {t("whoToPlay")}
        </Text>
        {worldStatus === "loading" && !world ? <SkeletonList count={3} /> : null}
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={t("whoToPlay")}
          style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.lg, justifyContent: "center" }}
        >
          {presets.map((p) => {
            const active = selected === p.handle;
            return (
              <Pressable
                key={p.handle}
                testID={T.personaPreset(p.handle)}
                onPress={() => setSelected(p.handle)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active, checked: active }}
                accessibilityLabel={`${p.displayName} @${p.handle}`}
                style={{
                  alignItems: "center",
                  gap: spacing.xs,
                  padding: spacing.sm,
                  borderRadius: radius.md,
                  borderWidth: 2,
                  borderColor: active ? colors.accent : "transparent",
                  width: 104,
                }}
              >
                <Avatar handle={p.handle} size={56} />
                <Text
                  numberOfLines={1}
                  importantForAccessibility="no"
                  style={{ color: active ? colors.accent : colors.text, fontSize: font.xs, fontWeight: "700" }}
                >
                  {`@${p.handle}`}
                </Text>
                <Text numberOfLines={1} importantForAccessibility="no" style={{ color: colors.textMuted, fontSize: font.xs }}>
                  {p.displayName}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={{ flexDirection: "row", gap: spacing.md, justifyContent: "space-between" }}>
          <Button testID={T.personaCreateOwn} label={t("createOwn")} variant="ghost" onPress={goEdit} style={{ flex: 1 }} />
          <Button testID={T.personaContinue} label={t("continue")} onPress={onContinue} disabled={!selected} style={{ flex: 1 }} />
        </View>
      </ScrollView>
    </Screen>
  );
}
