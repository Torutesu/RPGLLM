import React, { useEffect, useState } from "react";
import { Animated, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { T, colors, elevation, identityFor, layout, radius, spacing, tList } from "@rpgllm/shared";
import { useActions, useAppState, useT } from "../../src/state/store";
import { Button, Chip, Screen } from "../../src/components/ui";
import { SkeletonList } from "../../src/components/Skeleton";
import { Aurora, FILL, SoftOrb, StepDots } from "../../src/components/Brand";
import { Avatar, FadeSlideIn, Gradient, Icon, PressScale, duration, ease, timing, typo, useAnimatedValue, useReduceMotion } from "../../src/ui";
import type { Character } from "../../src/api/types";

const MAX_W = 560;
const FOOTER_H = 150;

/**
 * SCR-006 — the moment the story starts.
 *
 * The CTA lives in a **fixed footer** outside the scroller, so expanding a card never moves it,
 * and the themed overlay ("Planting the first ripple…") clears the instant `POST /personas`
 * answers — it is a beat, not a gate.
 */
export default function FirstFollower() {
  const { world, worldStatus, draft } = useAppState();
  const { loadWorld, createPersona } = useActions();
  const { t, locale } = useT();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (draft?.worldId) void loadWorld(draft.worldId);
  }, [draft?.worldId, loadWorld]);

  const candidates = (world?.characters ?? []).filter((c) => c.canBeFirstFollower);
  const chosen = candidates.find((c) => c.id === selected) ?? null;

  const onEnter = async () => {
    if (!selected) return;
    setError(null);
    setCreating(true);
    const res = await createPersona(selected);
    setCreating(false);
    if (res.ok) router.replace("/feed");
    else setError(t("loadFailed"));
  };

  const changes = [t("follows"), t("remembers"), tList(locale, "plusFeatures")[1] ?? ""].filter((s) => s.length > 0);

  return (
    <Screen wash={false}>
      <Aurora seed={world?.world.slug ?? "first-follower"} intensity={0.45} />
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingTop: spacing.xxl,
          paddingBottom: FOOTER_H + spacing.xl,
          gap: spacing.lg,
        }}
      >
        <View style={{ width: "100%", maxWidth: MAX_W, alignSelf: "center", gap: spacing.lg }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View />
            <StepDots step={2} />
          </View>

          <Text accessibilityRole="header" style={[typo.title, { color: colors.text }]}>
            {t("chooseFollower")}
          </Text>

          {worldStatus === "loading" && !world ? <SkeletonList count={3} /> : null}

          {candidates.map((c, i) => (
            <FadeSlideIn key={c.id} delay={i * 55} distance={12}>
              <FollowerCard character={c} selected={selected === c.id} changes={changes} onPress={() => setSelected(c.id)} />
            </FadeSlideIn>
          ))}

          {error ? (
            <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[typo.meta, { color: colors.danger }]}>
              {error}
            </Text>
          ) : null}
        </View>
      </ScrollView>

      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.lg,
          paddingBottom: spacing.xl,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          backgroundColor: colors.bgElevated,
          ...elevation.high,
        }}
      >
        <View style={{ width: "100%", maxWidth: MAX_W, alignSelf: "center", gap: spacing.md }}>
          <View style={{ height: 34, justifyContent: "center" }}>
            {chosen ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }} accessibilityLiveRegion="polite">
                <Avatar handle={chosen.handle} size={layout.avatarSm} />
                <Text numberOfLines={1} style={[typo.metaStrong, { color: colors.text, flexShrink: 1 }]}>
                  {`${chosen.displayName} · ${t("follows")}`}
                </Text>
              </View>
            ) : (
              <Text style={[typo.meta, { color: colors.textMuted }]}>{t("chooseFollower")}</Text>
            )}
          </View>
          <Button
            testID={T.enterWorld}
            label={t("enterWorld")}
            icon="sparkle"
            onPress={() => void onEnter()}
            disabled={!selected || creating}
            loading={creating}
          />
        </View>
      </View>

      {creating ? <PlantingOverlay slug={world?.world.slug ?? "world"} handle={chosen?.handle ?? "world"} /> : null}
    </Screen>
  );
}

/* ------------------------------------------------------------------ card ---- */

function FollowerCard({
  character, selected, changes, onPress,
}: { character: Character; selected: boolean; changes: readonly string[]; onPress: () => void }) {
  const id = identityFor(character.handle);
  return (
    <Pressable
      testID={T.follower(character.handle.replace(/^@/, ""))}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={`${character.displayName} @${character.handle.replace(/^@/, "")}. ${character.role}. ${character.intro}`}
    >
      {({ pressed }) => (
        <PressScale pressed={pressed} to={0.99}>
          <View
            style={{
              borderRadius: radius.xl,
              borderWidth: selected ? 2 : 1,
              borderColor: selected ? id.to : colors.border,
              backgroundColor: colors.card,
              overflow: "hidden",
              ...(selected ? elevation.mid : elevation.low),
            }}
          >
            {selected ? (
              <Gradient colors={[`${id.from}30`, `${id.to}10`]} angle={140} pointerEvents="none" style={FILL} />
            ) : null}

            <View style={{ padding: spacing.lg, gap: spacing.md }} importantForAccessibility="no-hide-descendants">
              <View style={{ flexDirection: "row", gap: spacing.md, alignItems: "center" }}>
                <Avatar handle={character.handle} size={layout.avatarMd + 8} ring={selected} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text numberOfLines={1} style={[typo.name, { color: colors.text }]}>
                    {character.displayName}
                  </Text>
                  <Text numberOfLines={1} style={[typo.caption, { color: colors.textMuted }]}>
                    {`@${character.handle.replace(/^@/, "")}`}
                  </Text>
                </View>
                <Chip label={character.role} color={id.to} />
              </View>

              <Text style={[typo.meta, { color: colors.textDim }]}>{character.intro}</Text>

              {selected ? (
                <FadeSlideIn distance={6}>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, paddingTop: spacing.xs }}>
                    {changes.map((c) => (
                      <Chip key={c} label={c} color={colors.positive} icon="check" />
                    ))}
                  </View>
                </FadeSlideIn>
              ) : null}
            </View>
          </View>
        </PressScale>
      )}
    </Pressable>
  );
}

/* --------------------------------------------------------------- overlay ---- */

/** "Planting the first ripple…" — three rings leaving the follower, in the world's colours. */
function PlantingOverlay({ slug, handle }: { slug: string; handle: string }) {
  const { t } = useT();
  const reduce = useReduceMotion();
  const id = identityFor(slug);
  const r0 = useAnimatedValue(0);
  const r1 = useAnimatedValue(0);
  const r2 = useAnimatedValue(0);
  const rings = [r0, r1, r2];

  useEffect(() => {
    if (reduce) return;
    const loops = rings.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 420),
          timing(v, 1, { duration: 1600, easing: ease.out }),
          timing(v, 0, { duration: 0, easing: ease.linear }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce]);

  return (
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
        backgroundColor: colors.scrim,
        alignItems: "center",
        justifyContent: "center",
        gap: spacing.xxl,
      }}
    >
      <View style={{ width: 260, height: 260, alignItems: "center", justifyContent: "center" }}>
        {rings.map((v, i) => (
          <Animated.View
            key={i}
            style={{
              position: "absolute",
              width: 120,
              height: 120,
              borderRadius: radius.pill,
              borderWidth: 2,
              borderColor: i % 2 === 0 ? id.from : id.to,
              opacity: reduce ? 0.3 : v.interpolate({ inputRange: [0, 1], outputRange: [0.85, 0] }),
              transform: [{ scale: reduce ? 1.6 : v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 2.1] }) }],
            }}
          />
        ))}
        <View style={{ position: "absolute", opacity: 0.75 }}>
          <SoftOrb from={id.from} to={id.to} size={190} />
        </View>
        <Avatar handle={handle} size={layout.avatarLg + 12} />
      </View>

      <View style={{ alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.xl }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Icon name="sparkle" size={16} color={id.to} />
          <Text style={[typo.h2, { color: colors.text, textAlign: "center" }]}>{t("planting")}</Text>
        </View>
        <Text style={[typo.meta, { color: colors.textMuted, textAlign: "center" }]}>{t("wakingUp")}</Text>
      </View>
    </View>
  );
}
