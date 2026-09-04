import React, { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { T, colors, spacing } from "@rpgllm/shared";
import { api } from "../../src/api/client";
import { useActions, useAppState, useT } from "../../src/state/store";
import { Button, Screen } from "../../src/components/ui";
import { SkeletonList } from "../../src/components/Skeleton";
import { Aurora, StepDots } from "../../src/components/Brand";
import { FadeSlideIn, typo } from "../../src/ui";
import { WorldCard } from "../../src/components/WorldCard";
import type { Character, WorldSummary } from "../../src/api/types";

/** SCR-003 — three worlds, three covers, one tap. Step 1 of the first run. */
export default function ScenarioPicker() {
  const { worlds, worldsStatus } = useAppState();
  const { loadWorlds, setDraft } = useActions();
  const { t } = useT();
  const [cast, setCast] = useState<Record<string, Character[]>>({});

  useEffect(() => {
    void loadWorlds();
  }, [loadWorlds]);

  /**
   * The cast strip on each card needs the world's characters, which only the detail endpoint has.
   * It is fetched *after* the cards are on screen and never blocks the tap — the card renders and
   * is clickable the moment `/v1/worlds` answers.
   */
  useEffect(() => {
    if (!worlds || worlds.length === 0) return;
    let alive = true;
    void Promise.allSettled(worlds.slice(0, 3).map((w) => api.world(w.id))).then((results) => {
      if (!alive) return;
      const next: Record<string, Character[]> = {};
      for (const r of results) {
        if (r.status === "fulfilled") next[r.value.world.id] = r.value.characters;
      }
      setCast(next);
    });
    return () => {
      alive = false;
    };
  }, [worlds]);

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
    <Screen wash={false}>
      <Aurora seed="pick-your-story" intensity={0.55} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.xxl, paddingBottom: spacing.xxxl, gap: spacing.xl }}>
        <View style={{ width: "100%", maxWidth: 560, alignSelf: "center", gap: spacing.xl }}>
          <View style={{ gap: spacing.md }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View />
              <StepDots step={0} />
            </View>
            <Text accessibilityRole="header" style={[typo.title, { color: colors.text }]}>
              {t("pickStory")}
            </Text>
            <Text style={[typo.meta, { color: colors.textMuted }]}>{t("tagline")}</Text>
          </View>

          {worldsStatus === "loading" && !worlds ? <SkeletonList count={3} /> : null}

          {worldsStatus === "error" ? (
            <View style={{ gap: spacing.md }}>
              <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[typo.meta, { color: colors.textMuted }]}>
                {t("loadFailed")}
              </Text>
              <Button label={t("retry")} variant="secondary" onPress={() => void loadWorlds()} />
            </View>
          ) : null}

          <View style={{ gap: spacing.xl }}>
            {(worlds ?? []).map((w, i) => (
              <FadeSlideIn key={w.id} delay={i * 70} distance={14}>
                <WorldCard world={w} cast={cast[w.id] ?? []} onPress={() => choose(w)} testID={T.worldCard(w.slug)} />
              </FadeSlideIn>
            ))}
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
