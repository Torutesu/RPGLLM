import React, { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Redirect, router } from "expo-router";
import { AGE, DEV_EMAIL_CODE, LOCALES, T, colors, font, radius, spacing, type Locale } from "@rpgllm/shared";
import { useActions, useAppState, useT } from "../src/state/store";
import { Button, Field, Screen, Wordmark } from "../src/components/ui";
import { InlineError } from "../src/components/Toast";

/** SCR-002 — email sign-in + age gate. */
export default function AuthScreen() {
  const { token, needsAgeGate, ageBlocked, locale, me } = useAppState();
  const { signIn, submitAgeGate, setLocale } = useActions();
  const { t } = useT();

  const [emailMode, setEmailMode] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState(DEV_EMAIL_CODE);
  const [year, setYear] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [yearError, setYearError] = useState<string | null>(null);

  const gateOpen = Boolean(token) && needsAgeGate && !ageBlocked;
  const done = Boolean(token) && !needsAgeGate && !ageBlocked;
  if (done && me) return <Redirect href="/" />;

  const onSubmit = async () => {
    if (gateOpen) return; // already authenticated; the gate below is the next step
    setError(null);
    setBusy(true);
    const res = await signIn(email.trim(), code.trim());
    setBusy(false);
    if (!res.ok) {
      setError(t("notSent"));
      return;
    }
    if (!res.needsAgeGate) router.replace("/");
  };

  const onAgeContinue = async () => {
    const parsed = Number.parseInt(year, 10);
    if (!Number.isFinite(parsed) || parsed < 1900 || parsed > 2100) {
      setYearError(t("birthYear"));
      return;
    }
    setYearError(null);
    setBusy(true);
    const res = await submitAgeGate(parsed);
    setBusy(false);
    if (res.ok) router.replace("/");
  };

  if (ageBlocked) {
    return (
      <Screen>
        <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg, flexGrow: 1, justifyContent: "center" }}>
          <Wordmark />
          <View
            testID={T.ageBlocked}
            style={{
              borderWidth: 1,
              borderColor: colors.danger,
              borderRadius: radius.md,
              padding: spacing.lg,
              backgroundColor: colors.bgElevated,
            }}
          >
            <Text style={{ color: colors.text, fontSize: font.md }}>{t("underAge")}</Text>
            <Text style={{ color: colors.textMuted, fontSize: font.xs, marginTop: spacing.sm }}>{`${AGE.MIN}+`}</Text>
          </View>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg, flexGrow: 1, justifyContent: "center" }}>
        <View style={{ gap: spacing.sm }}>
          <Wordmark />
          <Text style={{ color: colors.textMuted, fontSize: font.md }}>{t("tagline")}</Text>
        </View>

        {!emailMode ? (
          <Button testID={T.authEmailBtn} label={t("continueWithEmail")} onPress={() => setEmailMode(true)} />
        ) : (
          <View style={{ gap: spacing.md }}>
            <Field
              testID={T.authEmailInput}
              label={t("email")}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              editable={!gateOpen}
              placeholder="you@example.com"
            />
            <Field
              testID={T.authCodeInput}
              label={t("code")}
              value={code}
              onChangeText={setCode}
              autoCapitalize="none"
              keyboardType="number-pad"
              maxLength={6}
              editable={!gateOpen}
            />
            {error ? <InlineError text={error} /> : null}
            <Button testID={T.authSubmit} label={t("continue")} onPress={onSubmit} loading={busy && !gateOpen} disabled={gateOpen} />
          </View>
        )}

        {gateOpen ? (
          <View style={{ gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.lg }}>
            <Field
              testID={T.ageYearInput}
              label={t("birthYear")}
              value={year}
              onChangeText={setYear}
              keyboardType="number-pad"
              maxLength={4}
              placeholder="2000"
              error={yearError ?? undefined}
            />
            <Button testID={T.ageContinue} label={t("continue")} onPress={onAgeContinue} loading={busy} />
          </View>
        ) : null}

        <LocaleToggle locale={locale} onChange={setLocale} />
      </ScrollView>
    </Screen>
  );
}

function LocaleToggle({ locale, onChange }: { locale: Locale; onChange: (l: Locale) => void }) {
  const next = LOCALES[(LOCALES.indexOf(locale) + 1) % LOCALES.length] as Locale;
  return (
    <Pressable
      testID={T.localeToggle}
      onPress={() => onChange(next)}
      accessibilityRole="button"
      style={{ flexDirection: "row", gap: spacing.sm, alignSelf: "flex-start", padding: spacing.sm }}
    >
      {LOCALES.map((l) => (
        <Text key={l} style={{ color: l === locale ? colors.accent : colors.textMuted, fontSize: font.sm, fontWeight: "700" }}>
          {l.toUpperCase()}
        </Text>
      ))}
    </Pressable>
  );
}
