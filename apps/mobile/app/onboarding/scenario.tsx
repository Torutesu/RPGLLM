import React, { useEffect } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { T, colors, font, radius, spacing } from "@rpgllm/shared";
import { useActions, useAppState, useT } from "../../src/state/store";
import { Button, Screen } from "../../src/components/ui";
import { SkeletonList } from "../../src/components/Skeleton";
import type { WorldSummary } from "../../src/api/types";

/** SCR-003 — pick one of the three preset worlds. */
export default function ScenarioPicker() {
  const { worlds, worldsStatus } = useAppState();
  const { loadWorlds, setDraft } = useActions();
  const { t } = useT();

  useEffect(() => {
    void loadWorlds();
  }, [loadWorlds]);

  const choose = (w: WorldSummary) => {
    setDraft({
      worldId: w.id,
      worldSlug: w.slug,
      handle: "",
      displayName: "",
      bio: "",
      avatarUrl: null,
      voiceNotes: "",
    });
    router.push({ pathname: "/onboarding/persona", params: { worldId: w.id } });
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
        <Text style={{ color: colors.text, fontSize: font.xl, fontWeight: "800" }}>{t("pickStory")}</Text>
        {worldsStatus === "loading" && !worlds ? <SkeletonList count={3} /> : null}
        {worldsStatus === "error" ? (
          <View style={{ gap: spacing.md }}>
            <Text style={{ color: colors.textMuted, fontSize: font.sm }}>{t("notSent")}</Text>
            <Button label={t("continue")} variant="secondary" onPress={() => void loadWorlds()} />
          </View>
        ) : null}
        {(worlds ?? []).map((w) => (
          <Pressable
            key={w.id}
            testID={T.worldCard(w.slug)}
            onPress={() => choose(w)}
            accessibilityRole="button"
            style={{
              backgroundColor: colors.card,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: colors.border,
              padding: spacing.lg,
              gap: spacing.sm,
            }}
          >
            <Text style={{ color: colors.text, fontSize: font.lg, fontWeight: "700" }}>{w.title}</Text>
            <Text style={{ color: colors.textMuted, fontSize: font.sm }}>{w.scenario}</Text>
            <Text style={{ color: colors.energy, fontSize: font.xs }}>{"★".repeat(Math.max(1, w.difficulty))}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </Screen>
  );
}
