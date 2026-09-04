import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { ENERGY, T, colors, font, radius, spacing } from "@rpgllm/shared";
import { canShowWatchAd } from "../src/adapters/ads";
import { useActions, useAppState, useMe, useT } from "../src/state/store";
import { Button, Screen } from "../src/components/ui";
import { resetToFeed } from "../src/nav";

function countdown(iso: string | undefined, now: number): string {
  if (!iso) return "--:--:--";
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return "--:--:--";
  const ms = Math.max(0, target - now);
  const s = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** SCR-032 — get energy (modal). */
export default function EnergyModal() {
  const { pendingPost } = useAppState();
  const { me, refresh: refreshMe } = useMe();
  const { watchAd, useCoffee, flushPendingPost } = useActions();
  const { t } = useT();

  const [busy, setBusy] = useState<"ad" | "coffee" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const wallet = me?.wallet;
  const timer = useMemo(() => countdown(wallet?.dailyRefillAt, now), [wallet?.dailyRefillAt, now]);
  const showAd = canShowWatchAd(Boolean(wallet?.adsEnabled));
  const adsLeft = Math.max(0, ENERGY.AD_DAILY_MAX - (wallet?.adRewardsToday ?? 0));

  const close = async () => {
    const flushed = await flushPendingPost();
    if (flushed) {
      resetToFeed();
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace("/feed");
  };

  const onWatchAd = async () => {
    setError(null);
    setBusy("ad");
    const res = await watchAd();
    setBusy(null);
    if (!res.ok) {
      setError(t("adUnavailable"));
      return;
    }
    await close();
  };

  const onCoffee = async () => {
    setError(null);
    setBusy("coffee");
    const res = await useCoffee();
    setBusy(null);
    if (!res.ok) {
      setError(t("notSent"));
      return;
    }
    await close();
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <View
          testID={T.energyModal}
          style={{
            backgroundColor: colors.card,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: colors.border,
            padding: spacing.lg,
            gap: spacing.lg,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Text style={{ color: colors.energy, fontSize: font.xl }}>⚡</Text>
              <Text testID={T.energyValue} style={{ color: colors.text, fontSize: font.xl, fontWeight: "800" }}>
                {String(wallet?.energy ?? 0)}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: font.md }}>{`/ ${wallet?.dailyMax ?? ENERGY.FREE_DAILY}`}</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => void close()}>
              <Text style={{ color: colors.textMuted, fontSize: font.lg }}>×</Text>
            </Pressable>
          </View>

          <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "baseline" }}>
            <Text style={{ color: colors.textMuted, fontSize: font.xs }}>{t("nextRefill")}</Text>
            <Text testID={T.refillTimer} style={{ color: colors.text, fontSize: font.sm, fontWeight: "700" }}>
              {timer}
            </Text>
          </View>

          {showAd ? (
            <View style={{ gap: spacing.xs }}>
              <Button
                testID={T.watchAd}
                label={`▶ ${t("watchAd")} +${ENERGY.AD_REWARD}⚡`}
                onPress={() => void onWatchAd()}
                loading={busy === "ad"}
                disabled={adsLeft <= 0}
                variant="secondary"
              />
              <Text style={{ color: colors.textMuted, fontSize: font.xs }}>
                {`${wallet?.adRewardsToday ?? 0}/${ENERGY.AD_DAILY_MAX}`}
              </Text>
            </View>
          ) : null}

          <Button
            testID={T.useCoffee}
            label={`☕ ${t("useCoffee")} +${ENERGY.COFFEE_ENERGY}⚡`}
            onPress={() => void onCoffee()}
            loading={busy === "coffee"}
            disabled={(wallet?.coffee ?? 0) < 1}
            variant="secondary"
          />

          <Button testID={T.getPlus} label={`⭐ ${t("getPlus")}`} onPress={() => router.push("/paywall")} />

          {error ? <Text style={{ color: colors.danger, fontSize: font.sm }}>{error}</Text> : null}
          {pendingPost ? <Text style={{ color: colors.textMuted, fontSize: font.xs }} numberOfLines={1}>{pendingPost.text}</Text> : null}
        </View>
      </ScrollView>
    </Screen>
  );
}
