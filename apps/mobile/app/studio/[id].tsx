import React, { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { T, colors, compactNumber, font, layout, radius, spacing } from "@rpgllm/shared";
import { api, ApiError, type WorldFull } from "../../src/api/client";
import { Button, HeaderBar, Screen } from "../../src/components/ui";
import { Aurora, FILL } from "../../src/components/Brand";
import { StudioCast } from "../../src/components/StudioCast";
import { StudioProgress } from "../../src/components/StudioProgress";
import { StudioStatusBadge } from "../../src/components/StudioWorldCard";
import { WorldCover } from "../../src/components/WorldCard";
import { useActions, useT } from "../../src/state/store";
import { useWorldStatus } from "../../src/studio/useWorldStatus";
import { isPlayable } from "../../src/studio/labels";
import { Burst, FadeSlideIn, Icon, typo } from "../../src/ui";

/**
 * SCR-049 — building, then the reveal.
 *
 * One route holds both halves on purpose: the player never navigates, the screen *becomes* the
 * world. While it builds, the cover art is already on screen behind the four steps (it is
 * generated from the slug, so it exists before a single token is), and when the last step lands the
 * scrim lifts, the title appears over the art, and the cast walks in.
 *
 * A build that fails says so, says the gems came back, and offers another go.
 */

const COVER_H = 220;

/**
 * The cover develops as the world builds: the scrim over the generated art thins with `progress`,
 * so the picture arriving *is* the progress bar's second voice. `veil` is 0 once it is ready.
 */
function Hero({ world, veil }: { world: WorldFull; veil: number }) {
  const dim = veil > 0.02;
  return (
    <View style={{ height: COVER_H, borderRadius: radius.xl, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
      <WorldCover slug={world.slug} height={COVER_H} />
      {dim ? <View pointerEvents="none" style={[FILL, { backgroundColor: colors.scrim, opacity: veil }]} /> : null}
      {!dim ? (
        <View style={[FILL, { justifyContent: "flex-end", padding: spacing.lg, gap: spacing.xs }]}>
          <Text
            numberOfLines={2}
            style={[
              typo.title,
              {
                color: colors.text,
                fontSize: font.xl,
                textShadowColor: "rgba(0,0,0,0.6)",
                textShadowRadius: 14,
                textShadowOffset: { width: 0, height: 2 },
              },
            ]}
          >
            {world.title}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function Meta({ world }: { world: WorldFull }) {
  const { t } = useT();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, flexWrap: "wrap" }}>
      <StudioStatusBadge status={world.status} visibility={world.visibility} testID={T.studioStatusBadge} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
        <Icon name="person" size={12} color={colors.textMuted} />
        <Text style={[typo.count, { color: colors.textMuted }]}>
          {`${compactNumber(world.playCount)} ${t("studioPlays")}`}
        </Text>
      </View>
    </View>
  );
}

export default function StudioWorldScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const worldId = params.id ?? null;
  const { t } = useT();
  const { setDraft } = useActions();
  const { data, phase, stale, reload } = useWorldStatus(worldId);

  const [published, setPublished] = useState<WorldFull | null>(null);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [burst, setBurst] = useState(0);

  const world = published ?? data?.world ?? null;
  const ready = world !== null && isPlayable(world.status);

  // The one burst of the whole flow: the moment a line of text turned into a world.
  useEffect(() => {
    if (ready) setBurst((n) => n + 1);
  }, [ready]);

  /**
   * `rejected` covers two different stories. A world that never got a cast failed to generate and
   * its gems were refunded; a world with a cast was reviewed and turned down for Explore, and is
   * still perfectly playable in private.
   */
  const buildFailed = world?.status === "rejected" && world.castCount === 0;
  const reviewRejected = world?.status === "rejected" && world.castCount > 0;

  /** No world yet and the poll gave up: the screen shows the failure, not a bar that never moves. */
  const showBuilding = world ? !ready && !buildFailed && !reviewRejected : phase !== "error";

  const play = () => {
    if (!world) return;
    setDraft({
      worldId: world.id,
      worldSlug: world.slug,
      handle: "",
      displayName: "",
      bio: "",
      avatarUrl: null,
      voiceNotes: "",
    });
    router.push({ pathname: "/onboarding/persona", params: { worldId: world.id } });
  };

  const publish = async () => {
    if (!world) return;
    setPublishError(null);
    setPublishBusy(true);
    try {
      const res = await api.publishWorld(world.id, "public");
      setPublished(res.world);
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      setPublishError(err?.status === 422 ? t("studioPremiseBlocked") : t("loadFailed"));
    } finally {
      setPublishBusy(false);
    }
  };

  return (
    <Screen wash={false}>
      <Aurora seed={world?.slug ?? "world-studio"} intensity={0.85} />
      <HeaderBar
        title={t("studioTitle")}
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/studio"))}
      />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.xl }}>
        <View style={{ width: "100%", maxWidth: layout.maxContentWidth, alignSelf: "center", gap: spacing.xl }}>
          {/* ------------------------------------------------- the endpoint is not there ---- */}
          {phase === "error" && !world ? (
            <View style={{ gap: spacing.md, paddingTop: spacing.xxl }}>
              <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[typo.h2, { color: colors.text }]}>
                {t("loadFailed")}
              </Text>
              <Button label={t("retry")} variant="secondary" onPress={() => void reload()} />
            </View>
          ) : null}

          {world ? (
            <Hero
              world={world}
              veil={ready ? 0 : buildFailed || reviewRejected ? 0.8 : 0.86 - 0.5 * Math.max(0, Math.min(1, data?.progress ?? 0))}
            />
          ) : null}

          {/* ------------------------------------------------------------------ building ---- */}
          {showBuilding ? (
            <View testID={T.studioBuilding} style={{ gap: spacing.xl }}>
              <View style={{ gap: spacing.sm }}>
                <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={[typo.title, { color: colors.text }]}>
                  {t("studioBuilding")}
                </Text>
                <Text style={[typo.meta, { color: colors.textDim }]}>{t("studioBuildingWait")}</Text>
              </View>
              <StudioProgress progress={data?.progress ?? 0} />
              {stale ? (
                <Text accessibilityLiveRegion="polite" style={[typo.caption, { color: colors.textMuted }]}>
                  {t("fallbackNotice")}
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* --------------------------------------------------------------- the reveal ---- */}
          {ready && world ? (
            <View testID={T.studioReady} style={{ gap: spacing.xl }}>
              <View style={{ gap: spacing.sm }}>
                <View style={{ alignSelf: "flex-start" }}>
                  <Burst trigger={burst} color={colors.accentHi} size={60} />
                  <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={[typo.title, { color: colors.text }]}>
                    {t("studioReady")}
                  </Text>
                </View>
                <Text style={[typo.body, { color: colors.textDim }]}>{world.scenario}</Text>
                <Meta world={world} />
              </View>

              {world.status === "review" ? (
                <Text style={[typo.meta, { color: colors.warning }]}>{t("studioInReviewHint")}</Text>
              ) : null}

              <View style={{ gap: spacing.md }}>
                <Text accessibilityRole="header" style={[typo.micro, { color: colors.textMuted }]}>
                  {t("studioCastHeading").toUpperCase()}
                </Text>
                <StudioCast cast={data?.cast ?? []} />
              </View>

              {publishError ? (
                <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[typo.meta, { color: colors.danger }]}>
                  {publishError}
                </Text>
              ) : null}

              <View style={{ gap: spacing.sm }}>
                <Button testID={T.studioPlay} label={t("studioPlay")} icon="sparkle" onPress={play} />
                {world.status === "ready" && world.visibility !== "public" ? (
                  <Button
                    testID={T.studioPublish}
                    label={t("studioPublish")}
                    icon="share"
                    variant="secondary"
                    loading={publishBusy}
                    onPress={() => void publish()}
                  />
                ) : null}
                <Button
                  testID={T.studioKeepPrivate}
                  label={t("studioKeepPrivate")}
                  variant="ghost"
                  onPress={() => router.replace("/studio/worlds")}
                />
              </View>
            </View>
          ) : null}

          {/* ------------------------------------------------------ turned down for Explore ---- */}
          {reviewRejected && world ? (
            <View style={{ gap: spacing.md }}>
              <Text accessibilityRole="header" style={[typo.h2, { color: colors.text }]}>
                {t("studioRejected")}
              </Text>
              <Text style={[typo.meta, { color: colors.textDim }]}>{t("studioRejectedHint")}</Text>
              {world.reason ? <Text style={[typo.meta, { color: colors.danger }]}>{world.reason}</Text> : null}
              <Button testID={T.studioPlay} label={t("studioPlay")} onPress={play} />
              <Button
                testID={T.studioKeepPrivate}
                label={t("studioMyWorlds")}
                variant="ghost"
                onPress={() => router.replace("/studio/worlds")}
              />
            </View>
          ) : null}

          {/* -------------------------------------------------------------- build failed ---- */}
          {buildFailed ? (
            <FadeSlideIn>
              <View testID={T.studioFailed} style={{ gap: spacing.md }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <Icon name="shield" size={20} color={colors.danger} />
                  <Text accessibilityRole="header" style={[typo.h2, { color: colors.text }]}>
                    {t("studioFailed")}
                  </Text>
                </View>
                <Text style={[typo.meta, { color: colors.textDim }]}>{t("studioFailedHint")}</Text>
                {world?.reason ? <Text style={[typo.caption, { color: colors.textMuted }]}>{world.reason}</Text> : null}
                <Button testID={T.studioRetry} label={t("studioRetry")} onPress={() => router.replace("/studio")} />
              </View>
            </FadeSlideIn>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}
