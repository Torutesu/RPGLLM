import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { T, colors, compactNumber, layout, radius, spacing } from "@rpgllm/shared";
import { api, ApiError, type WorldFull, type WorldVisibility } from "../../src/api/client";
import { Button, HeaderBar, Screen } from "../../src/components/ui";
import { Aurora } from "../../src/components/Brand";
import { AppealForm, AppealStatus } from "../../src/components/StudioAppeal";
import { ShelfPrice, shortForShelf } from "../../src/components/ShelfPrice";
import { shelfFee } from "../../src/studio/shelf-fee";
import { StudioCast } from "../../src/components/StudioCast";
import { StudioProgress } from "../../src/components/StudioProgress";
import { StudioStatusBadge } from "../../src/components/StudioWorldCard";
import { WorldHero } from "../../src/components/WorldHero";
import { useActions, useAppState, useT } from "../../src/state/store";
import { useWorldStatus } from "../../src/studio/useWorldStatus";
import { rejectedStep } from "../../src/studio/appeal";
import { canAskForEveryone, canPutBehindLink, isLiveBehindLink } from "../../src/studio/audience";
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

/** The shelf's own refusal, inside the box that states its price. */
function ShelfRefusal({ text }: { text: string }) {
  return (
    <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[typo.meta, { color: colors.danger }]}>
      {text}
    </Text>
  );
}

export default function StudioWorldScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const worldId = params.id ?? null;
  // `locale` rides along on the share link, so a link sent in Japanese unfurls in Japanese.
  const { t, locale } = useT();
  const { setDraft, refreshMe } = useActions();
  const { me } = useAppState();
  const { data, phase, stale, reload } = useWorldStatus(worldId);
  /**
   * The wallet, for the shelf price. `null` while `/v1/me` has not answered — the price row shows
   * the cost either way and simply says nothing about the balance it does not have.
   */
  const gems = me ? me.wallet.gems : null;

  const [published, setPublished] = useState<WorldFull | null>(null);
  const [publishBusy, setPublishBusy] = useState<WorldVisibility | null>(null);
  /**
   * A refused publish, and whether the refusal is about the *shelf* specifically. The shelf's
   * price has its own box on this screen, and a sentence about that price belongs inside it —
   * an alert two rows above the Play button reads as being about the world, not about the door.
   */
  const [publishError, setPublishError] = useState<{ text: string; shelf: boolean } | null>(null);
  const [burst, setBurst] = useState(0);
  const [copied, setCopied] = useState(false);
  /** Set once the server has refused a resubmit, so the button that cannot work stops being offered. */
  const [resubmitWait, setResubmitWait] = useState(false);
  /** The appeal: closed until asked for, and gone for good once it has been spent. */
  const [appealOpen, setAppealOpen] = useState(false);
  const [appealBusy, setAppealBusy] = useState(false);
  const [appealError, setAppealError] = useState<string | null>(null);
  const [appealSent, setAppealSent] = useState(false);
  /**
   * Somebody else's world, opened at the creator's URL. `GET /:id/status` is creator-only, so this
   * screen used to be a dead end for every link that was ever shared (QA-002). When the world
   * answers the *recipient's* endpoint, the visitor belongs on the world page — and the links
   * already in circulation, which all point here, go on working.
   */
  const [visitor, setVisitor] = useState(false);

  const world = published ?? data?.world ?? null;
  const ready = world !== null && isPlayable(world.status);

  // The one burst of the whole flow: the moment a line of text turned into a world.
  useEffect(() => {
    if (ready) setBurst((n) => n + 1);
  }, [ready]);

  /*
   * The publish row states a price against a balance, and this screen is reached from a shelf that
   * may have been open for a while. One read on mount so the number next to the gem is current.
   */
  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  /*
   * The poll has given up and there is nothing on screen. Before saying "Couldn't load", ask the
   * one question that separates "this world is not yours" from "this world is not there":
   * `GET /v1/worlds/:id` answers anyone who may play it. One request, only on the failure path.
   */
  useEffect(() => {
    if (phase !== "error" || world || !worldId) return;
    let alive = true;
    void api
      .world(worldId)
      .then(() => {
        if (alive) setVisitor(true);
      })
      .catch(() => {
        /* genuinely not there — the error state below is the honest answer */
      });
    return () => {
      alive = false;
    };
  }, [phase, world, worldId]);

  /*
   * Someone else's world is never shown the creator's controls, however it was reached. Two ways
   * to know: the status endpoint refused us and the world answers the recipient's one (`visitor`),
   * or it answered and says the world is not ours — which is what happens the day `/:id/status`
   * opens up to whoever may play a world. Either way the world page is the right screen.
   */
  const notMine = world !== null && !world.isMine;
  if ((visitor || notMine) && worldId) return <Redirect href={{ pathname: "/world/[id]", params: { id: worldId } }} />;

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
  /**
   * An appeal that a person has not answered yet. The world is back in `review` — which is why
   * this has to be read off the world and not off a toast: a creator who closed the app and came
   * back is owed the same sentence.
   */
  const appealPending = world ? (world.appealed || appealSent) && world.status === "review" : false;

  /**
   * The single next step a rejection is owed, and the two knobs the ranking turns: while an unspent
   * appeal is on screen it takes the accent, so the resubmit drops to a ghost and its cooldown
   * refusal drops to a muted caption instead of a second alarm.
   */
  const step = world ? rejectedStep(world, { appealSent, resubmitRefused: resubmitWait }) : null;
  const quietResubmit = step === "appeal";
  // An open form is one task. The other door is still there when it closes, but not over its shoulder.
  const showResubmit = !resubmitWait && !appealOpen && (step === "appeal" || step === "resubmit");
  const showResubmitWait = resubmitWait && !appealOpen && step !== "appealPending";

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
      /*
       * Exit 1: asking for the shelf takes gems. `charged` defaults to zero, so this is a no-op
       * against an API that has not started charging yet — and when it does, the balance the next
       * screen shows is the one the server just wrote, not the one this screen remembers.
       */
      if (res.charged.gems > 0) void refreshMe();
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
      /*
       * A 402 here is never energy — `publishWorld` opts out of the global handlers for exactly
       * this reason. It is the shelf's price, and only the public door has one, so the sentence
       * names the shelf rather than the wallet in general.
       */
      const poorForShelf = visibility === "public" && (err?.isGems === true || err?.status === 402);
      // The safety gate runs on every publish, unlisted included.
      setPublishError({
        text: poorForShelf
          ? t("studioNotEnoughForPublic")
          : err?.isSafety
            ? t("studioPremiseBlocked")
            : t("loadFailed"),
        shelf: poorForShelf,
      });
      return false;
    } finally {
      setPublishBusy(null);
    }
  };

  /**
   * The one message. It is spent on the 200, so everything that can be checked before the call is
   * checked before the call: the 10–500 range is the form's, not the server's, and the button is
   * the only way in. The response carries the world back in `review`, which is the whole point —
   * the screen stops arguing about the rejection and starts saying "someone is reading it".
   */
  const sendAppeal = async (message: string) => {
    if (!world) return;
    setAppealError(null);
    setAppealBusy(true);
    try {
      const res = await api.appealWorld(world.id, message);
      setPublished(res.world);
      setAppealSent(true);
      setAppealOpen(false);
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      setAppealError(err?.isSafety ? t("studioPremiseBlocked") : t("loadFailed"));
    } finally {
      setAppealBusy(false);
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
    const didCopy = await shareWorldLink(worldShareUrl(world.id, locale), world.title);
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
            <WorldHero
              slug={world.slug}
              title={world.title}
              height={COVER_H}
              /* The cover develops as the world builds: the scrim thins with `progress`, so the
                 picture arriving *is* the progress bar's second voice. 0 once it is ready. */
              veil={
                ready
                  ? 0
                  : buildFailed || reviewRejected
                    ? 0.8
                    : 0.86 - 0.5 * Math.max(0, Math.min(1, data?.progress ?? 0))
              }
            />
          ) : null}

          {/* ------------------------------------------------------------------ building ---- */}
          {showBuilding ? (
            <View testID={T.studioBuilding} style={{ gap: spacing.xl }}>
              <View style={{ gap: spacing.sm }}>
                <Text
                  accessibilityRole="header"
                  accessibilityLiveRegion="polite"
                  style={[typo.title, { color: colors.text }]}
                >
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
                  {pulled || appealPending ? null : <Burst trigger={burst} color={colors.accentHi} size={60} />}
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
              ) : appealPending ? (
                /* It is in review *because the creator said so* — the SLA line would bury that. */
                <AppealStatus sent={appealSent} />
              ) : world.status === "review" ? (
                <Text style={[typo.meta, { color: colors.warning }]}>{t("studioInReviewHint")}</Text>
              ) : null}

              <View style={{ gap: spacing.md }}>
                <Text accessibilityRole="header" style={[typo.micro, { color: colors.textMuted }]}>
                  {t("studioCastHeading").toUpperCase()}
                </Text>
                <StudioCast cast={data?.cast ?? []} />
              </View>

              {publishError && !publishError.shelf ? (
                <Text
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                  style={[typo.meta, { color: colors.danger }]}
                >
                  {publishError.text}
                </Text>
              ) : null}

              {/* Live behind the link: the link is the whole point, so it is on screen, not in a
                  menu — and it only appears once the link actually resolves for its recipient. */}
              {isLiveBehindLink(world) ? (
                <Pressable
                  onPress={() => void copyLink()}
                  accessibilityRole="button"
                  accessibilityLabel={`${t("copyLink")} — ${worldShareUrl(world.id, locale)}`}
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
                        <Text
                          numberOfLines={1}
                          importantForAccessibility="no"
                          style={[typo.meta, { color: colors.textDim, flex: 1 }]}
                        >
                          {worldShareUrl(world.id, locale)}
                        </Text>
                        <Text
                          importantForAccessibility="no"
                          style={[typo.label, { color: copied ? colors.positive : colors.accentHi }]}
                        >
                          {copied ? t("copied") : t("copyLink")}
                        </Text>
                      </View>
                    </PressScale>
                  )}
                </Pressable>
              ) : null}

              {/*
                What a world may still be asked to do, read off the audience it actually has rather
                than the one its row claims (`studio/audience.ts`). The rule the old conditions
                broke: no state may withdraw the only control that moves a world out of it — a
                `ready` world that says "public" and sits in no queue is exactly that state, and it
                keeps the button that sends it to a reviewer (QA-003b).
              */}
              <View style={{ gap: spacing.sm }}>
                <Button testID={T.studioPlay} label={t("studioPlay")} icon="sparkle" onPress={play} />
                {/*
                  The one door that costs something, and the price is inside it — read before the
                  press, with the reason attached (gtm.md §2: a person reads every world in
                  Explore). The two doors below are outside this box and carry no gem, no number
                  and no hint, because private and unlisted are free and must look it.
                */}
                {canAskForEveryone(world) ? (
                  <View
                    style={{
                      gap: spacing.md,
                      padding: spacing.md,
                      borderRadius: radius.md,
                      backgroundColor: colors.cardHi,
                      borderWidth: 1,
                      borderColor: shortForShelf(gems, shelfFee()) ? `${colors.danger}66` : colors.border,
                    }}
                  >
                    <ShelfPrice gems={gems} fee={shelfFee()} />
                    {publishError?.shelf ? <ShelfRefusal text={publishError.text} /> : null}
                    <Button
                      testID={T.studioPublish}
                      label={t("studioPublish")}
                      icon="share"
                      variant="secondary"
                      loading={publishBusy === "public"}
                      onPress={() => void publish("public")}
                    />
                  </View>
                ) : null}
                {canPutBehindLink(world) ? (
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
                Two answers to one rejection, ranked rather than shouted (see src/studio/appeal.ts).
                "Send it back" is the same world hoping for a different reviewer; the appeal is the
                creator saying the decision misread it — which is a live possibility, because the
                runbook tells reviewers to reject when unsure. So while an appeal is available it
                takes the accent and the cooldown gives up its warning voice; once it is spent, the
                resubmit is the only story left and gets the volume back.
              */}
              {step === "appealPending" ? <AppealStatus sent={appealSent} /> : null}

              {step === "appeal" ? (
                appealOpen ? (
                  <AppealForm
                    busy={appealBusy}
                    error={appealError}
                    onSubmit={(message) => void sendAppeal(message)}
                    onCancel={() => {
                      setAppealOpen(false);
                      setAppealError(null);
                    }}
                  />
                ) : (
                  <Button
                    testID={T.studioAppeal}
                    label={t("studioAppeal")}
                    icon="message"
                    variant="secondary"
                    onPress={() => setAppealOpen(true)}
                  />
                )
              ) : null}

              {/*
                The same world, again. Offered until the server refuses it — and never at the same
                weight as an unspent appeal, so a creator who wants to write is not competing with
                a button, and a creator who does not is never locked out either.
              */}
              {showResubmit ? (
                <>
                  {publishError && !publishError.shelf ? (
                    <Text
                      accessibilityRole="alert"
                      accessibilityLiveRegion="polite"
                      style={[typo.meta, { color: colors.danger }]}
                    >
                      {publishError.text}
                    </Text>
                  ) : null}
                  {/*
                    Sending it back is the same endpoint with the same `public`, so it is the same
                    charge and it is said here too — a creator who learns the price by being
                    charged twice has been tolled. It keeps the ranking, though: while an unspent
                    appeal is on screen the price drops to a caption and loses its box, so the
                    resubmit does not outshout the door that costs nothing.
                    (`T.studioPublicCost` is safe here — `rejected` and `ready` never render at
                    the same time, so the id exists once on the screen either way.)
                  */}
                  <View
                    style={
                      quietResubmit
                        ? { gap: spacing.sm }
                        : {
                            gap: spacing.md,
                            padding: spacing.md,
                            borderRadius: radius.md,
                            backgroundColor: colors.cardHi,
                            borderWidth: 1,
                            borderColor: shortForShelf(gems, shelfFee()) ? `${colors.danger}66` : colors.border,
                          }
                    }
                  >
                    <ShelfPrice gems={gems} tone={quietResubmit ? "quiet" : "loud"} fee={shelfFee()} />
                    {publishError?.shelf ? <ShelfRefusal text={publishError.text} /> : null}
                    <Button
                      testID={T.studioPublish}
                      label={t("studioPublish")}
                      icon="share"
                      variant={quietResubmit ? "ghost" : "secondary"}
                      loading={publishBusy === "public"}
                      onPress={() => void publish("public")}
                    />
                  </View>
                </>
              ) : null}

              {showResubmitWait ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingTop: spacing.xxs }}>
                  <Icon name="clock" size={15} color={quietResubmit ? colors.textMuted : colors.warning} />
                  <Text
                    accessibilityRole={quietResubmit ? "text" : "alert"}
                    accessibilityLiveRegion={quietResubmit ? "none" : "polite"}
                    style={[
                      quietResubmit ? typo.caption : typo.meta,
                      { color: quietResubmit ? colors.textMuted : colors.warning, flex: 1 },
                    ]}
                  >
                    {t("studioResubmitWait")}
                  </Text>
                </View>
              ) : null}
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
