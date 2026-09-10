import React from "react";
import { ScrollView, Text, View } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { T, colors, compactNumber, layout, spacing } from "@rpgllm/shared";
import { Button, HeaderBar, Screen } from "../../src/components/ui";
import { Aurora } from "../../src/components/Brand";
import { SkeletonList } from "../../src/components/Skeleton";
import { CreatorLink } from "../../src/components/CreatorLink";
import { StudioCast } from "../../src/components/StudioCast";
import { StudioStatusBadge } from "../../src/components/StudioWorldCard";
import { WorldHero } from "../../src/components/WorldHero";
import { useActions, useAppState, useT } from "../../src/state/store";
import { pushOnce } from "../../src/nav";
import { useSharedWorld } from "../../src/studio/useSharedWorld";
import { Icon, typo } from "../../src/ui";

/**
 * The world page — where a share link lands.
 *
 * An unlisted world's only distribution is its link, so the link has to open somewhere a *stranger*
 * can stand: the studio screen (SCR-049) is the creator's workshop, reads a creator-only endpoint
 * and answered every recipient with "Couldn't load" (QA-002). This route reads
 * `GET /v1/worlds/:id`, which serves anyone who may play the world, and shows the world the way its
 * maker would want it introduced — the cover, the line it came from, and the eight people in it —
 * with one thing to do about it.
 *
 * It is deliberately a destination and not a redirect: a world someone else made is somebody's
 * work, and the next thing this screen is asked to carry is the person who made it. What it does
 * *not* do is decide anything about that world — publishing, the link panel and the takedown
 * notices all stay on the creator's screen, one tap away when the world is yours.
 */

const COVER_H = 220;

export default function WorldPage() {
  const params = useLocalSearchParams<{ id?: string; from?: string }>();
  const worldId = params.id ?? null;
  /** The creator page this world was opened from, if any — see the credit below. */
  const from = (params.from ?? "").replace(/^@/, "");
  const { t } = useT();
  const { booted, token } = useAppState();
  const { setDraft } = useActions();
  const { detail, full, phase, reload } = useSharedWorld(token ? worldId : null);

  const world = detail?.world ?? null;
  const cast = detail?.characters ?? [];
  const mine = full?.isMine ?? false;

  /** The link is worth nothing to someone with no session — the API refuses every world without one. */
  if (booted && !token) return <Redirect href="/auth" />;

  /** The whole point of the link: the normal persona flow, for a world you did not build. */
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

  return (
    <Screen wash={false}>
      <Aurora seed={world?.slug ?? "world-page"} intensity={0.85} />
      <HeaderBar
        title={world?.title ?? t("studioCommunity")}
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))}
      />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.xl }}>
        <View style={{ width: "100%", maxWidth: layout.maxContentWidth, alignSelf: "center", gap: spacing.xl }}>
          {phase === "loading" && !world ? <SkeletonList count={3} /> : null}

          {phase === "error" && !world ? (
            <View style={{ gap: spacing.md, paddingTop: spacing.xxl }}>
              <Text
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                style={[typo.h2, { color: colors.text }]}
              >
                {t("loadFailed")}
              </Text>
              <Button label={t("retry")} variant="secondary" onPress={() => void reload()} />
            </View>
          ) : null}

          {world ? (
            <View testID={T.worldPage} style={{ gap: spacing.xl }}>
              <WorldHero slug={world.slug} title={world.title} height={COVER_H} />

              <View style={{ gap: spacing.sm }}>
                <Text style={[typo.body, { color: colors.textDim }]}>{world.scenario}</Text>
                {/*
                 * Whose world this is, and how many people have been in it — off the world detail
                 * itself, so a visitor who was sent a link sees the credit. The status badge stays
                 * behind `full` (the creator-only record): what a world is *waiting on* is the
                 * creator's business, whose world it is is everybody's.
                 */}
                {world.isPreset ? null : (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, flexWrap: "wrap" }}>
                    {full ? <StudioStatusBadge status={full.status} visibility={full.visibility} /> : null}
                    {/*
                     * Circuit ② — the credit is the link. It keeps `T.worldCredit` (the id E2E
                     * already asserts) rather than taking `T.creatorLink`, so the page a share
                     * link lands on still proves it says whose world this is.
                     *
                     * When this page was opened *from* that creator's own page, the credit walks
                     * back to it instead of pushing a second copy — Expo Router keeps stacked
                     * screens mounted, and two `/creator/[handle]` screens would duplicate every
                     * id on them.
                     */}
                    {world.creatorHandle ? (
                      <CreatorLink
                        handle={world.creatorHandle}
                        testID={T.worldCredit}
                        onPress={
                          from && from === world.creatorHandle && router.canGoBack() ? () => router.back() : undefined
                        }
                      />
                    ) : null}
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                      <Icon name="person" size={12} color={colors.textMuted} />
                      <Text style={[typo.count, { color: colors.textMuted }]}>
                        {`${compactNumber(world.playCount)} ${t("studioPlays")}`}
                      </Text>
                    </View>
                    {/* Circuit ④, from the other side: this world has been built on. */}
                    {full && full.remixCount > 0 ? (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                        <Icon name="sparkle" size={12} color={colors.accentHi} filled />
                        <Text style={[typo.count, { color: colors.accentHi }]}>
                          {`${compactNumber(full.remixCount)} ${t("remixCount")}`}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                )}

                {/*
                 * A derivative credits what it came out of. Deliberately a credit and not a link:
                 * `T.remixSource` names the source panel on the studio screen, and this page can be
                 * stacked underneath that screen (world → remix), so using the id twice would let
                 * it match twice. Recorded in build-notes — a `remixSourceLink` id would let the
                 * lineage be walked in both directions.
                 */}
                {full?.remixOf ? (
                  <Text style={[typo.count, { color: colors.textMuted }]}>
                    {`${t("remixFrom")} ${full.remixOf.title}${
                      full.remixOf.creatorHandle ? ` ${t("studioBy")} @${full.remixOf.creatorHandle}` : ""
                    }`}
                  </Text>
                ) : null}
              </View>

              <Button testID={T.worldPlay} label={t("studioPlay")} icon="sparkle" onPress={play} />

              {/*
               * Circuit ④ — the cheapest consumer→author conversion there is.
               *
               * The blank page is the enemy: asking someone to invent a world from nothing converts
               * almost nobody, while asking them for one different line about a world they just
               * played converts a great deal more. So the offer lives here, on the page you meet a
               * world on, and it carries its price in the same breath — `remixHint` says plainly
               * that it costs the same 120 gems as any other world, because a surprise at the
               * paywall is how you lose the author you just recruited.
               */}
              <View style={{ gap: spacing.xs }}>
                <Button
                  testID={T.remixOpen}
                  label={t("remix")}
                  variant="secondary"
                  icon="plus"
                  onPress={() =>
                    pushOnce({
                      pathname: "/studio",
                      params: {
                        remixOf: world.id,
                        remixTitle: world.title,
                        remixSlug: world.slug,
                        remixBy: world.creatorHandle ?? "",
                      },
                    })
                  }
                />
                <Text style={[typo.caption, { color: colors.textMuted }]}>{t("remixHint")}</Text>
              </View>

              <View style={{ gap: spacing.md }}>
                <Text accessibilityRole="header" style={[typo.micro, { color: colors.textMuted }]}>
                  {t("studioCastHeading").toUpperCase()}
                </Text>
                <StudioCast cast={cast} />
              </View>

              {/*
               * Your own link, opened by you. The page stays the visitor's view — that is what you
               * came to check — and hands the controls back with one tap. `replace`, not `push`:
               * two screens carrying the same studio ids must never be mounted at once.
               */}
              {mine ? (
                <Button
                  label={t("studioTitle")}
                  variant="ghost"
                  icon="sparkle"
                  onPress={() => router.replace({ pathname: "/studio/[id]", params: { id: world.id } })}
                />
              ) : null}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}
