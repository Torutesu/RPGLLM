import React, { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, Share, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { T, colors, font, radius, spacing } from "@rpgllm/shared";
import { api, ApiError, type ReferralInfo } from "../src/api/client";
import { Button, Field, HeaderBar, Screen } from "../src/components/ui";
import { useActions, useT } from "../src/state/store";

/**
 * SCR-041 — invite a friend (S2-5). Both sides get a coffee (8 energy) when the code is redeemed.
 * Reached from the profile header; a shared link lands here with `?code=` prefilled.
 */
export default function InviteScreen() {
  const { code: incoming } = useLocalSearchParams<{ code?: string }>();
  const { refreshMe, showToast } = useActions();
  const { t } = useT();

  const [info, setInfo] = useState<ReferralInfo | null>(null);
  const [entry, setEntry] = useState(incoming ?? "");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setInfo(await api.referral());
    } catch {
      /* the screen still works for redeeming */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const copy = async () => {
    if (!info) return;
    const message = `${info.code} — ${info.link}`;
    try {
      if (Platform.OS === "web") {
        const nav = typeof navigator !== "undefined" ? navigator : undefined;
        await nav?.clipboard?.writeText(message);
      } else {
        await Share.share({ message });
      }
      setNote(t("copied"));
    } catch {
      setNote(t("copied"));
    }
  };

  const redeem = async () => {
    const value = entry.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.redeemReferral(value);
      setNote(t("redeemed"));
      await refreshMe();
      await load();
      showToast("stat", t("redeemed"));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("notSent"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <HeaderBar title={t("inviteFriends")} onBack={() => (router.canGoBack() ? router.back() : router.replace("/feed"))} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl }}>
        <Text style={{ color: colors.textMuted, fontSize: font.sm }}>{t("inviteExplainer")}</Text>

        <View style={{ gap: spacing.sm }}>
          <Text style={{ color: colors.textMuted, fontSize: font.xs, fontWeight: "700" }}>{t("yourCode")}</Text>
          <Text
            testID={T.referralCode}
            accessibilityRole="text"
            accessibilityLabel={`${t("yourCode")}: ${info?.code ?? ""}`}
            style={{
              color: colors.text,
              fontSize: font.xl,
              fontWeight: "800",
              letterSpacing: 4,
              backgroundColor: colors.bgElevated,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.border,
              paddingVertical: spacing.md,
              paddingHorizontal: spacing.lg,
            }}
          >
            {info?.code ?? "········"}
          </Text>
          <Pressable
            testID={T.referralCopy}
            accessibilityRole="button"
            accessibilityLabel={t("copyLink")}
            onPress={() => void copy()}
            style={{
              alignSelf: "flex-start",
              backgroundColor: colors.accent,
              borderRadius: radius.pill,
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.lg,
            }}
          >
            <Text style={{ color: colors.bg, fontSize: font.sm, fontWeight: "700" }}>{t("copyLink")}</Text>
          </Pressable>
          <Text style={{ color: colors.textMuted, fontSize: font.xs }}>
            {`${info?.invited ?? 0} ${t("invitedCount")} · ☕ ${info?.coffeeEarned ?? 0}`}
          </Text>
        </View>

        {info?.canRedeem !== false ? (
          <View style={{ gap: spacing.md }}>
            <Text style={{ color: colors.textMuted, fontSize: font.xs, fontWeight: "700" }}>{t("haveACode")}</Text>
            <Field
              testID={T.referralRedeemInput}
              value={entry}
              onChangeText={setEntry}
              autoCapitalize="characters"
              maxLength={16}
              placeholder={t("yourCode")}
              accessibilityLabel={t("haveACode")}
              {...(error ? { error } : {})}
            />
            <Button testID={T.referralRedeem} label={t("redeem")} onPress={() => void redeem()} loading={busy} />
          </View>
        ) : null}

        {note ? <Text style={{ color: colors.positive, fontSize: font.sm }}>{note}</Text> : null}
      </ScrollView>
    </Screen>
  );
}
