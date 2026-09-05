import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { T, colors, compactNumber, font, layout, radius, spacing } from "@rpgllm/shared";
import { api, ApiError, type WorldFull, type WorldVisibility } from "../../src/api/client";
import { Button, HeaderBar, Screen } from "../../src/components/ui";
import { Aurora, FILL } from "../../src/components/Brand";
import { StudioCast } from "../../src/components/StudioCast";
import { StudioProgress } from "../../src/components/StudioProgress";
import { StudioStatusBadge } from "../../src/components/StudioWorldCard";
import { WorldCover } from "../../src/components/WorldCard";
import { useActions, useT } from "../../src/state/store";
import { useWorldStatus } from "../../src/studio/useWorldStatus";
import { isFailedBuild, isPlayable } from "../../src/studio/labels";
import { isResubmitCooldown } from "../../src/studio/report";
import { shareWorldLink, worldShareUrl } from "../../src/studio/share";
import { Burst, FadeSlideIn, Icon, PressScale, typo } from "../../src/ui";

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
      {/* The pill stays factual — `review` — and the headline above it says which kind of review. */}
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
  const [publishBusy, setPublishBusy] = useState<WorldVisibility | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [burst, setBurst] = useState(0);
  const [copied, setCopied] = useState(false);
  /** Set once the server has refused a resubmit, so the button that cannot work stops being offered. */
  const [resubmitWait, setResubmitWait] = useState(false);

  const world = published ?? data?.world ?? null;
  const ready = world !== null && isPlayable(world.status);

  // The one burst of the whole flow: the moment a line of text turned into a world.
  useEffect(() => {
    if (ready) setBurst((n) => n + 1);
  }, [ready]);

  /**
   * Two different "no". `draft` is a build that died — the server refunds and drops the world back
   * there, so there is nothing to play and nothing to review. `rejected` is a finished world a
   * human turned down for Explore, which is still perfectly playable in private.
   */
  const buildFailed = world ? isFailedBuild(world.status) : false;
  const reviewRejected = world?.status === "rejected";
  /**
   * `review` has two causes and only one of them is good news. A world nobody has read yet is
   * queued; a world that enough players reported was *taken off the shelf*. The creator is owed
   * the difference, so `pulled` says the second one out loud instead of hiding inside "In review".
   */
  const pulled = world?.status === "review" && world.pulled;

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

  /**
   * Publishing is one call with three endings, and the client has to tell them apart:
   *   private   → 200, back to `ready`, and it is pulled out of review/Explore if it was there;
   *   unlisted  → 200, live behind the link — so the link itself has to appear;
   *   public    → 202, `review`, because no world reaches Explore without a human.
   * `needsReview` on the body is what separates "it is live" from "it is queued".
   */
  const publish = async (visibility: WorldVisibility): Promise<boolean> => {
    if (!world) return false;
    setPublishError(null);
    setCopied(false);
    setPublishBusy(visibility);
    try {
      const res = await api.publishWorld(world.id, visibility);
      setPublished(res.world);
      return true;
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      /*
       * A rejected world may be sent back, but not immediately
       * (`WORLD_MODERATION.RESUBMIT_COOLDOWN_HOURS`). That refusal is a rule, not a fault, so it
       * gets its own sentence — and the button it refuses stops being offered.
       */
      if (world.status === "rejected" && isResubmitCooldown(e)) {
        setResubmitWait(true);
        return false;
      }
      // The safety gate runs on every publish, unlisted included.
      setPublishError(err?.isSafety ? t("studioPremiseBlocked") : t("loadFailed"));
      return false;
    } finally {
      setPublishBusy(null);
    }
  };

  /** "Keep it private" is a real request when the world is out there; otherwise it is just a way out. */
  const keepPrivate = async () => {
    if (world && (world.visibility !== "private" || world.status === "review" || world.status === "published")) {
      const ok = await publish("private");
      if (!ok) return;
    }
    router.replace("/studio/worlds");
  };

  const copyLink = async () => {
    if (!world) return;
    const didCopy = await shareWorldLink(worldShareUrl(world.id), world.title);
    setCopied(didCopy);
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
                  {/* No confetti over a takedown: the burst belongs to the reveal, not to this. */}
                  {pulled ? null : <Burst trigger={burst} color={colors.accentHi} size={60} />}
                  <Text
                    accessibilityRole="header"
                    accessibilityLiveRegion="polite"
                    style={[typo.title, { color: pulled ? colors.danger : colors.text }]}
                  >
                    {t(pulled ? "studioPulled" : "studioReady")}
                  </Text>
                </View>
                <Text style={[typo.body, { color: colors.textDim }]}>{world.scenario}</Text>
                <Meta world={world} />
              </View>

              {pulled ? (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: spacing.sm,
                    padding: spacing.md,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: `${colors.danger}59`,
                    backgroundColor: `${colors.danger}14`,
                  }}
                >
                  <Icon name="shield" size={16} color={colors.danger} />
                  <Text style={[typo.meta, { color: colors.textDim, flex: 1 }]}>{t("studioPulledHint")}</Text>
                </View>
              ) : world.status === "review" ? (
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

              {/* Live behind the link: the link is the whole point, so it is on screen, not in a menu. */}
              {world.visibility === "unlisted" && world.status === "published" ? (
                <Pressable
                  onPress={() => void copyLink()}
                  accessibilityRole="button"
                  accessibilityLabel={`${t("copyLink")} — ${worldShareUrl(world.id)}`}
                >
                  {({ pressed }) => (
                    <PressScale pressed={pressed} to={0.99}>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: spacing.md,
                          padding: spacing.md,
                          borderRadius: radius.md,
                          backgroundColor: colors.card,
                          borderWidth: 1,
                          borderColor: colors.borderHi,
                        }}
                      >
                        <Icon name="share" size={16} color={colors.accentHi} />
                        <Text numberOfLines={1} importantForAccessibility="no" style={[typo.meta, { color: colors.textDim, flex: 1 }]}>
                          {worldShareUrl(world.id)}
                        </Text>
                        <Text importantForAccessibility="no" style={[typo.label, { color: copied ? colors.positive : colors.accentHi }]}>
                          {copied ? t("copied") : t("copyLink")}
                        </Text>
                      </View>
                    </PressScale>
                  )}
                </Pressable>
              ) : null}

              <View style={{ gap: spacing.sm }}>
                <Button testID={T.studioPlay} label={t("studioPlay")} icon="sparkle" onPress={play} />
                {world.status !== "review" && world.visibility !== "public" ? (
                  <Button
                    testID={T.studioPublish}
                    label={t("studioPublish")}
                    icon="share"
                    variant="secondary"
                    loading={publishBusy === "public"}
                    onPress={() => void publish("public")}
                  />
                ) : null}
                {world.visibility !== "unlisted" && world.status !== "review" ? (
                  <Button
                    label={t("studioVisibilityUnlisted")}
                    icon="eye"
                    variant="secondary"
                    loading={publishBusy === "unlisted"}
                    onPress={() => void publish("unlisted")}
                  />
                ) : null}
                <Button
                  testID={T.studioKeepPrivate}
                  label={t("studioKeepPrivate")}
                  variant="ghost"
                  loading={publishBusy === "private"}
                  onPress={() => void keepPrivate()}
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
              {/*
                Turned down is not forever: the world can go back to the queue once the cooldown is
                up. Until the server says no, the offer stands; the moment it does, the offer is
                withdrawn and replaced by the reason — a button that can only fail is worse than
                no button.
              */}
              {resubmitWait ? (
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingTop: spacing.xxs }}
                >
                  <Icon name="clock" size={15} color={colors.warning} />
                  <Text
                    accessibilityRole="alert"
                    accessibilityLiveRegion="polite"
                    style={[typo.meta, { color: colors.warning, flex: 1 }]}
                  >
                    {t("studioResubmitWait")}
                  </Text>
                </View>
              ) : (
                <>
                  {publishError ? (
                    <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[typo.meta, { color: colors.danger }]}>
                      {publishError}
                    </Text>
                  ) : null}
                  <Button
                    testID={T.studioPublish}
                    label={t("studioPublish")}
                    icon="share"
                    variant="secondary"
                    loading={publishBusy === "public"}
                    onPress={() => void publish("public")}
                  />
                </>
              )}
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
