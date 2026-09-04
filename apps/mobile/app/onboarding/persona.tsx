import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { T, colors, radius, spacing } from "@rpgllm/shared";
import { useActions, useAppState, useT } from "../../src/state/store";
import { Button, Chip, Screen } from "../../src/components/ui";
import { SkeletonList } from "../../src/components/Skeleton";
import { Aurora, StepDots } from "../../src/components/Brand";
import { FadeSlideIn, typo } from "../../src/ui";
import { PersonaCard } from "../../src/components/PersonaCard";

const MAX_W = 560;

/** SCR-004 — "Who do you want to play as?" Step 2 of the first run. */
export default function PersonaPicker() {
  const params = useLocalSearchParams<{ worldId?: string }>();
  const { world, worldStatus, draft } = useAppState();
  const { loadWorld, setDraft } = useActions();
  const { t } = useT();
  const { width } = useWindowDimensions();
  const [selected, setSelected] = useState<string | null>(null);

  const worldId = params.worldId ?? draft?.worldId ?? "";

  useEffect(() => {
    if (worldId) void loadWorld(worldId);
  }, [loadWorld, worldId]);

  const presets = useMemo(() => world?.presetPersonas ?? [], [world]);
  const chosen = presets.find((p) => p.handle === selected) ?? null;

  // Fixed tile footprint: the grid must not reflow when a tile is picked.
  const inner = Math.min(MAX_W, width) - spacing.lg * 2;
  const columns = inner > 460 ? 4 : 3;
  const tile = Math.floor(inner / columns);

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
    if (!chosen) return;
    setDraft({
      worldId,
      worldSlug: world?.world.slug ?? draft?.worldSlug ?? "",
      handle: chosen.handle,
      displayName: chosen.displayName,
      bio: chosen.bio,
      avatarUrl: chosen.avatarUrl,
      voiceNotes: "",
    });
    router.push("/onboarding/first-follower");
  };

  return (
    <Screen>
      <Aurora seed={world?.world.slug ?? "persona"} intensity={0.45} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.xxl, paddingBottom: spacing.xxxl, gap: spacing.xl }}>
        <View style={{ width: "100%", maxWidth: MAX_W, alignSelf: "center", gap: spacing.lg }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View />
            <StepDots step={1} />
          </View>

          {world ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" }}>
              <Chip label={"★".repeat(Math.max(1, world.world.difficulty))} color={colors.energy} />
              <Text style={[typo.metaStrong, { color: colors.textDim }]}>{world.world.title}</Text>
            </View>
          ) : null}

          <Text accessibilityRole="header" style={[typo.title, { color: colors.text }]}>
            {t("whoToPlay")}
          </Text>

          {worldStatus === "loading" && !world ? <SkeletonList count={3} /> : null}

          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={t("whoToPlay")}
            style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-start" }}
          >
            {presets.map((p, i) => (
              <FadeSlideIn key={p.handle} delay={i * 45} distance={10}>
                <PersonaCard
                  handle={p.handle}
                  displayName={p.displayName}
                  selected={selected === p.handle}
                  onPress={() => setSelected(p.handle)}
                  testID={T.personaPreset(p.handle)}
                  width={tile}
                />
              </FadeSlideIn>
            ))}
          </View>

          {/* Fixed-height preview: the footer below never moves while you choose. */}
          <View
            style={{
              minHeight: 62,
              justifyContent: "center",
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: chosen ? colors.borderHi : "transparent",
              backgroundColor: chosen ? colors.card : "transparent",
              paddingHorizontal: chosen ? spacing.lg : 0,
              paddingVertical: spacing.md,
            }}
          >
            {chosen ? (
              <View style={{ gap: spacing.xs }} accessibilityLiveRegion="polite">
                <Text style={[typo.name, { color: colors.text }]}>{`@${chosen.handle.replace(/^@/, "")}`}</Text>
                <Text numberOfLines={2} style={[typo.meta, { color: colors.textDim }]}>
                  {chosen.bio}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={{ gap: spacing.md }}>
            <Button testID={T.personaContinue} label={t("continue")} onPress={onContinue} disabled={!chosen} />
            <Button testID={T.personaCreateOwn} label={t("createOwn")} variant="ghost" onPress={goEdit} />
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
