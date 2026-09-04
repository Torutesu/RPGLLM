import React, { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, Share, Text, View } from "react-native";
import { router } from "expo-router";
import * as Linking from "expo-linking";
import { LEGAL, LOCALES, T, colors, font, radius, spacing, type Locale } from "@rpgllm/shared";
import { IS_WEB } from "../src/env";
import { useActions, useAppState, useT } from "../src/state/store";
import { Button, HeaderBar, Screen } from "../src/components/ui";

const STORE_SUBSCRIPTIONS: Record<string, string> = {
  ios: "https://apps.apple.com/account/subscriptions",
  android: "https://play.google.com/store/account/subscriptions",
};

/** No i18n key exists for the free tier — it is a plan name, like "status plus". */
const FREE_PLAN = "Free";
const EXPORT_FILENAME = "rpgllm-export.json";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
      <Text style={{ color: colors.textMuted, fontSize: font.xs, fontWeight: "700", textTransform: "uppercase" }}>
        {title}
      </Text>
      <View
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          backgroundColor: colors.bgElevated,
          padding: spacing.md,
          gap: spacing.md,
        }}
      >
        {children}
      </View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.md }}>
      <Text style={{ color: colors.textMuted, fontSize: font.sm }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: font.sm, flexShrink: 1 }} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function LinkRow({ testID, label, url }: { testID: string; label: string; url: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={() => void Linking.openURL(url)}
      style={{ paddingVertical: spacing.xs }}
    >
      <Text style={{ color: colors.accent, fontSize: font.md }}>{label}</Text>
    </Pressable>
  );
}

/** Saves the export as a JSON file (web) or hands it to the share sheet (native). */
async function saveExport(json: string): Promise<void> {
  if (IS_WEB && typeof document !== "undefined") {
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = EXPORT_FILENAME;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  // TODO(P1): write to the cache dir and share the file once `expo-file-system` is a dependency.
  await Share.share({ message: json, title: EXPORT_FILENAME });
}

/** SCR-033 — Settings (S1-3/4/5/6). */
export default function SettingsScreen() {
  const { me, locale, blocked, analyticsConsent } = useAppState();
  const { setLocale, signOut, setConsent, exportMyData, restorePurchases, loadBlocked } = useActions();
  const { t } = useT();

  const [busy, setBusy] = useState<"export" | "restore" | "consent" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // `me` arrives after boot; without it in the deps the list would never load on a direct hit.
  useEffect(() => {
    void loadBlocked();
  }, [loadBlocked, me?.persona?.id]);

  const isMinor = me?.user.isMinor ?? true;
  const consentLocked = isMinor;
  const subscription = me?.subscription;
  const planLabel = subscription?.active ? subscription.plan : FREE_PLAN;

  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/feed");
  }, []);

  const onExport = async () => {
    setError(null);
    setNotice(null);
    setBusy("export");
    const res = await exportMyData();
    setBusy(null);
    if (!res.ok || !res.json) {
      setError(t("loadFailed"));
      return;
    }
    await saveExport(res.json);
    setNotice(t("exportReady"));
  };

  const onRestore = async () => {
    setError(null);
    setNotice(null);
    setBusy("restore");
    const res = await restorePurchases();
    setBusy(null);
    if (!res.ok) {
      setError(t("loadFailed"));
      return;
    }
    setNotice(res.plan ? `${t("plusTitle")} — ${res.plan}` : t("restorePurchases"));
  };

  const onConsent = async () => {
    if (consentLocked) return;
    setError(null);
    setBusy("consent");
    const res = await setConsent(!analyticsConsent);
    setBusy(null);
    if (!res.ok) setError(t("loadFailed"));
  };

  const onManageSub = () => {
    const url = STORE_SUBSCRIPTIONS[Platform.OS];
    if (url) void Linking.openURL(url);
    else router.push("/paywall");
  };

  const onSignOut = async () => {
    await signOut();
    router.replace("/auth");
  };

  const nextLocale: Locale = locale === "en" ? "ja" : "en";

  return (
    <Screen>
      <HeaderBar title={t("settings")} onBack={back} />
      <ScrollView testID={T.settings} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
        <Section title={t("account")}>
          <Row label={t("email")} value={me?.user.email ?? me?.user.id ?? "—"} />
          <Button testID={T.settingsExport} label={t("exportData")} variant="secondary" onPress={() => void onExport()} loading={busy === "export"} />
          <Button testID={T.settingsSignOut} label={t("signOut")} variant="ghost" onPress={() => void onSignOut()} />
          <Button testID={T.settingsDelete} label={t("deleteAccount")} variant="ghost" onPress={() => router.push("/delete-account")} />
        </Section>

        <Section title={t("subscription")}>
          <Row label={t("subscription")} value={planLabel} />
          <Button testID={T.settingsManageSub} label={t("manageSubscription")} variant="secondary" onPress={onManageSub} />
          <Button testID={T.settingsRestore} label={t("restorePurchases")} variant="ghost" onPress={() => void onRestore()} loading={busy === "restore"} />
        </Section>

        <Section title={t("privacy")}>
          <Pressable
            testID={T.settingsConsent}
            accessibilityRole="switch"
            accessibilityState={{ checked: analyticsConsent, disabled: consentLocked }}
            accessibilityLabel={t("personalizedAds")}
            disabled={consentLocked || busy === "consent"}
            onPress={() => void onConsent()}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: spacing.md,
              opacity: consentLocked ? 0.5 : 1,
              paddingVertical: spacing.xs,
            }}
          >
            <Text style={{ color: colors.text, fontSize: font.md, flexShrink: 1 }}>{t("personalizedAds")}</Text>
            <Text style={{ color: analyticsConsent ? colors.positive : colors.textMuted, fontSize: font.md, fontWeight: "700" }}>
              {analyticsConsent ? t("on") : t("off")}
            </Text>
          </Pressable>
          {consentLocked ? (
            <Text style={{ color: colors.textMuted, fontSize: font.xs }}>{t("consentLockedMinor")}</Text>
          ) : null}
        </Section>

        <Section title={t("blockedCharacters")}>
          <Pressable
            testID={T.settingsBlocked}
            accessibilityRole="button"
            accessibilityLabel={t("blockedCharacters")}
            onPress={() => router.push("/settings/blocked")}
            style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.xs }}
          >
            <Text style={{ color: colors.text, fontSize: font.md }}>{t("blockedCharacters")}</Text>
            <Text style={{ color: colors.textMuted, fontSize: font.md }}>{`${blocked.length} ›`}</Text>
          </Pressable>
        </Section>

        <Section title={t("language")}>
          <Pressable
            testID={T.settingsLocale}
            accessibilityRole="button"
            accessibilityLabel={t("language")}
            onPress={() => setLocale(nextLocale)}
            style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.xs }}
          >
            <Text style={{ color: colors.text, fontSize: font.md }}>{t("language")}</Text>
            <Text style={{ color: colors.accent, fontSize: font.md, fontWeight: "700" }}>
              {LOCALES.map((l) => (l === locale ? l.toUpperCase() : l)).join(" / ")}
            </Text>
          </Pressable>
        </Section>

        <Section title={t("legal")}>
          <LinkRow testID={T.settingsTerms} label={t("terms")} url={LEGAL.terms} />
          <LinkRow testID={T.settingsPrivacy} label={t("privacy")} url={LEGAL.privacy} />
          <LinkRow testID={T.settingsGuidelines} label={t("guidelines")} url={LEGAL.guidelines} />
          <LinkRow testID="settings-support" label={t("support")} url={LEGAL.support} />
        </Section>

        {notice ? <Text style={{ color: colors.positive, fontSize: font.sm, marginTop: spacing.lg }}>{notice}</Text> : null}
        {error ? <Text style={{ color: colors.danger, fontSize: font.sm, marginTop: spacing.lg }}>{error}</Text> : null}
      </ScrollView>
    </Screen>
  );
}
