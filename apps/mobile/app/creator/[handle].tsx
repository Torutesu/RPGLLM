import React, { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Redirect, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { T, colors, compactNumber, layout, radius, spacing } from "@rpgllm/shared";
import { api, type CreatorProfile } from "../../src/api/client";
import { Button, HeaderBar, Screen } from "../../src/components/ui";
import { Aurora } from "../../src/components/Brand";
import { CreatorTrustBlock } from "../../src/components/CreatorTrust";
import { Empty } from "../../src/components/Empty";
import { SkeletonList } from "../../src/components/Skeleton";
import { StudioWorldCard } from "../../src/components/StudioWorldCard";
import { pushOnce } from "../../src/nav";
import { useAppState, useT } from "../../src/state/store";
import { rememberTrusted, wasEverTrusted } from "../../src/studio/trust";
import { FadeSlideIn, Icon, typo } from "../../src/ui";

/**
 * Circuit ② — the creator, as a place you can go.
 *
 * This is the page a credit *links to*, and the whole reason "by @x" is worth printing. It answers
 * the three questions a reader has about a name they just met: what else have they made, has
 * anyone played it, and how long have they been at this. Nothing here is a follow graph or a
 * profile in the social sense — it is a body of work with a person's name on it.
 *
 * A creator with nothing public **says so** rather than rendering an empty grid: an empty shelf
 * under a name reads as a broken page, and the difference between "this person has published
 * nothing" and "this page failed to load" is exactly what the third circuit needs to stay honest.
 *
 * When it is you, the page says so and hands you the one thing you might want from it — the name
 * itself. A creator minted as `quietheron42` learns here that the placeholder is not permanent.
 */

/** One of the three numbers. `testID` is optional because "creating since" has no id of its own. */
function Stat({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={{ flex: 1, gap: spacing.xxs, alignItems: "center" }}>
      <Text
        testID={testID}
        accessibilityRole="text"
        accessibilityLabel={`${value} ${label}`}
        style={[typo.number, { color: colors.text }]}
      >
        {value}
      </Text>
      <Text importantForAccessibility="no" numberOfLines={2} style={[typo.micro, { color: colors.textMuted, textAlign: "center" }]}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

export default function CreatorPage() {
  const params = useLocalSearchParams<{ handle?: string }>();
  const routeHandle = (params.handle ?? "").replace(/^@/, "");
  const { t, locale } = useT();
  const { booted, me, token } = useAppState();
  const [profile, setProfile] = useState<CreatorProfile | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  /** Has this device seen this creator trusted before? The one thing `trust` cannot say alone. */
  const [wasTrusted, setWasTrusted] = useState(false);
  const alive = useRef(true);

  /*
   * A rename makes the handle in the URL a name that no longer exists. Once we know this page is
   * ours, the account's current name is the authority — otherwise walking back here from the
   * rename screen would re-read the old handle and 404 on a page that is plainly still yours.
   */
  const myHandle = me?.user.creatorHandle ?? "";
  const handle = profile?.isYou && myHandle ? myHandle : routeHandle;

  const load = useCallback(async () => {
    if (!handle) return;
    try {
      const res = await api.creator(handle);
      if (!alive.current) return;
      setProfile(res);
      setPhase("ready");
    } catch {
      // A page already on screen is never replaced by an error; a first read that fails says so.
      if (alive.current) setPhase((p) => (p === "ready" ? p : "error"));
    }
  }, [handle]);

  /**
   * Focus, not mount: `useFocusEffect` fires on the first render too, so this is the only read the
   * page needs — and the interesting change (a rename, a world finishing review) always happens
   * while the player is on some other screen.
   */
  useFocusEffect(
    useCallback(() => {
      alive.current = true;
      void load();
      return () => {
        alive.current = false;
      };
    }, [load]),
  );

  /**
   * Trust is the creator's own business — the contract sends it to nobody else, and this page
   * refuses to print it for anybody else even if a future payload leaks one. A public mark of
   * "read less closely" is a target, which is the whole reason the field is private.
   */
  const trust = profile?.isYou ? profile.trust : null;

  /*
   * `trusted: true` is remembered, because losing it is invisible in the payload: a reset returns
   * `approvals` to zero, which is exactly what a creator who has never been trusted looks like.
   * On a device that has not seen it, this stays false and the block shows only the progress it
   * can prove — a missing sentence, never a wrong one.
   */
  useEffect(() => {
    if (!trust || !handle) return;
    let live = true;
    void (async () => {
      if (trust.trusted) {
        await rememberTrusted(handle);
        if (live) setWasTrusted(true);
        return;
      }
      const seen = await wasEverTrusted(handle);
      if (live) setWasTrusted(seen);
    })();
    return () => {
      live = false;
    };
  }, [trust, handle]);

  /** Creators are only meaningful inside a session — the endpoint refuses an anonymous read. */
  if (booted && !token) return <Redirect href="/auth" />;

  const since = profile
    ? new Date(profile.joinedAt).toLocaleDateString(locale, { year: "numeric", month: "short" })
    : "";

  return (
    <Screen wash={false}>
      <Aurora seed={`creator-${handle}`} intensity={0.7} />
      <HeaderBar
        title={`@${handle}`}
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/explore"))}
      />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.xl }}>
        <View style={{ width: "100%", maxWidth: layout.maxContentWidth, alignSelf: "center", gap: spacing.xl }}>
          {phase === "loading" && !profile ? <SkeletonList count={3} /> : null}

          {phase === "error" && !profile ? (
            <View style={{ gap: spacing.md, paddingTop: spacing.xxl }}>
              <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[typo.h2, { color: colors.text }]}>
                {t("loadFailed")}
              </Text>
              <Button label={t("retry")} variant="secondary" onPress={() => void load()} />
            </View>
          ) : null}

          {profile ? (
            <View testID={T.creatorPage} style={{ gap: spacing.xl }}>
              {/* ------------------------------------------------------------- the name ---- */}
              <View style={{ gap: spacing.sm, alignItems: "center" }}>
                <Text
                  testID={T.creatorHandleText}
                  accessibilityRole="header"
                  style={[typo.title, { color: colors.text, textAlign: "center" }]}
                >
                  {`@${profile.handle}`}
                </Text>
                {profile.isYou ? (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: spacing.xs,
                      paddingHorizontal: spacing.md,
                      paddingVertical: 3,
                      borderRadius: radius.pill,
                      backgroundColor: `${colors.accent}1F`,
                      borderWidth: 1,
                      borderColor: `${colors.accent}59`,
                    }}
                  >
                    <Icon name="sparkle" size={11} color={colors.accentHi} filled />
                    <Text style={[typo.micro, { color: colors.accentHi }]}>{t("creatorYou").toUpperCase()}</Text>
                  </View>
                ) : null}
              </View>

              {/* --------------------------------------------------------- the three numbers ---- */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-start",
                  gap: spacing.md,
                  padding: spacing.lg,
                  borderRadius: radius.lg,
                  backgroundColor: colors.card,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Stat testID={T.creatorWorldCount} label={t("creatorWorlds")} value={compactNumber(profile.worldCount)} />
                <Stat testID={T.creatorTotalPlays} label={t("creatorPlays")} value={compactNumber(profile.totalPlays)} />
                <Stat label={t("creatorSince")} value={since} />
              </View>

              {/*
               * Exit 2 — what the next world costs a reviewer, and how that changes. It sits under
               * the numbers because it is about the work, and above the rename because it is the
               * one thing on this page that moves.
               */}
              {trust ? <CreatorTrustBlock trust={trust} wasTrusted={wasTrusted} /> : null}

              {/*
               * Your own name, and the way out of a placeholder. It sits under the numbers rather
               * than beside the handle: the page is about the work first, and renaming is a thing
               * you do once.
               */}
              {profile.isYou ? (
                <Button
                  testID={T.creatorRename}
                  label={t("creatorRename")}
                  variant="secondary"
                  icon="sparkle"
                  onPress={() => pushOnce("/creator/rename")}
                />
              ) : null}

              {/* ---------------------------------------------------------------- the work ---- */}
              {profile.worlds.length === 0 ? (
                <Empty icon="sparkle" title={t("creatorNoWorlds")} />
              ) : (
                <View style={{ gap: spacing.md }}>
                  {profile.worlds.map((w, i) => (
                    <FadeSlideIn key={w.id} delay={i * 50} distance={12}>
                      <StudioWorldCard
                        world={w}
                        testID={T.creatorWorld(w.slug)}
                        /*
                         * No credit on these cards: every one of them is by the person whose page
                         * this is, and a "by @x" under their own name is noise. It is also what
                         * keeps this page from stacking a second copy of itself — see `from` below.
                         */
                        canReport={!profile.isYou}
                        onPress={() =>
                          pushOnce({
                            pathname: "/world/[id]",
                            /*
                             * `from` tells the world page which creator page is already behind it,
                             * so its credit walks *back* here instead of pushing a second
                             * `/creator/[handle]` — two mounted copies would duplicate every id on
                             * this screen.
                             */
                            params: { id: w.id, from: profile.handle },
                          })
                        }
                      />
                    </FadeSlideIn>
                  ))}
                </View>
              )}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}
