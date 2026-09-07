import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { colors, font, layout, spacing } from "@rpgllm/shared";
import { api, type Moment, type MomentReel } from "../../src/api/client";
import { MomentCard } from "../../src/components/MomentCard";
import { ReelPanel } from "../../src/reel/ReelPanel";
import { SkeletonList } from "../../src/components/Skeleton";
import { HeaderBar, Screen } from "../../src/components/ui";
import { useT } from "../../src/state/store";

/**
 * SCR-040 standalone — the share target (S2-4 / AIF-005), now with the reel on top of it.
 *
 * `GET /v1/moments/:slug` is public, so this page renders for someone with no account: the whole
 * point of the growth loop is that the card works before you sign up. The reel is the same argument
 * carried further — a still card cannot show the *turn*, and the turn is the content.
 *
 * `GET /v1/moments/:slug/reel` is allowed to fail. It is a separate request precisely so that a
 * missing endpoint costs the page nothing: the panel cuts its own timeline from the card payload
 * and the screen never knows the difference.
 */
export default function SharedMomentScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { t } = useT();
  const [moment, setMoment] = useState<Moment | null>(null);
  const [reel, setReel] = useState<MomentReel | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  /**
   * Expo Router keeps a stacked screen mounted underneath the one on top of it, so a screen pushed
   * twice — this one is a deep link, which makes that ordinary — would put `moment-reel` and its
   * five controls on the page twice and break every strict selector. The panel therefore belongs to
   * whichever copy of the screen is actually focused.
   */
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const load = useCallback(async () => {
    if (!slug) return;
    try {
      setMoment((await api.sharedMoment(slug)).moment);
      setStatus("ready");
    } catch {
      setStatus("error");
      return;
    }
    try {
      setReel(await api.momentReel(slug));
    } catch {
      setReel(null);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen>
      <HeaderBar title={t("shareMoment")} onBack={() => (router.canGoBack() ? router.back() : router.replace("/feed"))} />
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.lg,
          alignItems: "stretch",
          maxWidth: layout.maxContentWidth,
          width: "100%",
          alignSelf: "center",
        }}
      >
        {status === "loading" ? <SkeletonList count={2} /> : null}
        {status === "error" ? (
          <Text style={{ color: colors.textMuted, fontSize: font.sm, textAlign: "center" }}>{t("notSent")}</Text>
        ) : null}
        {moment && focused ? <ReelPanel moment={moment} reel={reel} /> : null}
        {moment ? (
          <View>
            <MomentCard moment={moment} />
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
