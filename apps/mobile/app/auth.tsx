import React, { useCallback, useEffect, useState } from "react";
import { Animated, Linking, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Redirect, router } from "expo-router";
import { AGE, DEV_EMAIL_CODE, LEGAL, LOCALES, T, colors, elevation, gradients, radius, spacing, type Locale } from "@rpgllm/shared";
import { useActions, useAppState, useT } from "../src/state/store";
import { Button, Field, Screen, Wordmark } from "../src/components/ui";
import { Aurora, SoftOrb } from "../src/components/Brand";
import { IntroSlides } from "../src/components/IntroSlides";
import { FadeSlideIn, Gradient, duration, ease, timing, typo, useAnimatedValue, useReduceMotion } from "../src/ui";

/**
 * SCR-002 — the door.
 *
 * Above the fold: the cold open (`IntroSlides`) sells the fantasy. Below it, always on screen and
 * never covered, the sign-in sheet. The deck has a fixed height and animates in place, so the CTA
 * under it does not move — a hard requirement for the E2E flows and for not feeling cheap.
 *
 * Flow and every testID are unchanged: email → 6-digit code → birth year → the world.
 */

const INTRO_KEY = "rpgllm.introSeen";

type WebStorage = { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void };
const webStore = (): WebStorage | null => {
  const g = globalThis as unknown as { localStorage?: WebStorage };
  return Platform.OS === "web" && g.localStorage ? g.localStorage : null;
};

async function readIntroSeen(): Promise<boolean> {
  try {
    if (Platform.OS === "web") return webStore()?.getItem(INTRO_KEY) === "1";
    return (await AsyncStorage.getItem(INTRO_KEY)) === "1";
  } catch {
    return false;
  }
}

async function writeIntroSeen(): Promise<void> {
  try {
    if (Platform.OS === "web") webStore()?.setItem(INTRO_KEY, "1");
    else await AsyncStorage.setItem(INTRO_KEY, "1");
  } catch {
    /* private mode — the deck simply plays again next time */
  }
}

export default function AuthScreen() {
  const { token, needsAgeGate, ageBlocked, locale, me } = useAppState();
  const { signIn, submitAgeGate, setLocale, signOut } = useActions();
  const { t } = useT();
  const { height } = useWindowDimensions();

  const [emailMode, setEmailMode] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState(DEV_EMAIL_CODE);
  const [year, setYear] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [yearError, setYearError] = useState<string | null>(null);
  const [introSeen, setIntroSeen] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void readIntroSeen().then((v) => {
      if (alive) setIntroSeen(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  const markIntroSeen = useCallback(() => {
    void writeIntroSeen();
  }, []);

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
      setError(t("signInFailed"));
      return;
    }
    if (!res.needsAgeGate) router.replace("/");
  };

  const onAgeContinue = async () => {
    const parsed = Number.parseInt(year, 10);
    const thisYear = new Date().getFullYear();
    if (!Number.isFinite(parsed) || parsed < 1900 || parsed > thisYear) {
      setYearError(t("birthYear"));
      return;
    }
    setYearError(null);
    setBusy(true);
    const res = await submitAgeGate(parsed);
    setBusy(false);
    if (res.ok) router.replace("/");
  };

  if (ageBlocked) return <BlockedScreen onBack={() => void signOut()} />;

  // The deck is a fixed band at the top; the sheet under it is always on screen.
  const deckHeight = Math.round(Math.min(520, Math.max(260, height * 0.55)));
  const compactDeck = introSeen === true || height < 560;
  const bandHeight = compactDeck ? 148 : deckHeight;

  return (
    <Screen>
      <Aurora seed="status-auth" />
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexGrow: 1, width: "100%", maxWidth: 520, alignSelf: "center", paddingBottom: spacing.xl }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: spacing.xl,
              paddingTop: spacing.xl,
              paddingBottom: spacing.sm,
            }}
          >
            <Wordmark size={32} />
            <LocaleToggle locale={locale} onChange={setLocale} />
          </View>

          <View style={{ flexGrow: 1, flexShrink: 0, minHeight: bandHeight, justifyContent: "flex-end" }}>
            {introSeen === null ? (
              <View style={{ height: bandHeight }} />
            ) : (
              <IntroSlides height={bandHeight} compact={compactDeck} onSeen={markIntroSeen} />
            )}
          </View>

          <FadeSlideIn delay={80} distance={16}>
            <View
              style={{
                marginTop: spacing.lg,
                marginHorizontal: spacing.lg,
                borderRadius: radius.xl,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
                padding: spacing.xl,
                gap: spacing.lg,
                ...elevation.high,
              }}
            >
              <View style={{ gap: spacing.xs }}>
                <Text accessibilityRole="header" style={[typo.h2, { color: colors.text }]}>
                  {gateOpen ? t("birthYear") : t("tagline")}
                </Text>
                <Text style={[typo.meta, { color: colors.textMuted }]}>
                  {gateOpen ? `${AGE.MIN}+ · ${t("guidelines")}` : t("pickStory")}
                </Text>
              </View>

              {gateOpen ? (
                <View style={{ gap: spacing.lg }}>
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
                  <Button testID={T.ageContinue} label={t("continue")} onPress={() => void onAgeContinue()} loading={busy} />
                </View>
              ) : !emailMode ? (
                <Button testID={T.authEmailBtn} label={t("continueWithEmail")} icon="send" onPress={() => setEmailMode(true)} />
              ) : (
                <View style={{ gap: spacing.lg }}>
                  <Field
                    testID={T.authEmailInput}
                    label={t("email")}
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
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
                  />
                  {error ? (
                    <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[typo.meta, { color: colors.danger }]}>
                      {error}
                    </Text>
                  ) : null}
                  <Button testID={T.authSubmit} label={t("continue")} onPress={() => void onSubmit()} loading={busy} />
                </View>
              )}

              <LegalRow />
            </View>
          </FadeSlideIn>
        </View>
      </ScrollView>
    </Screen>
  );
}

/* ----------------------------------------------------------------- pieces --- */

function LegalRow() {
  const { t } = useT();
  const link = (label: string, url: string, testID: string) => (
    <Pressable
      key={testID}
      testID={testID}
      onPress={() => void Linking.openURL(url).catch(() => undefined)}
      accessibilityRole="link"
      accessibilityLabel={label}
      hitSlop={6}
    >
      <Text importantForAccessibility="no" style={[typo.caption, { color: colors.textMuted, textDecorationLine: "underline" }]}>
        {label}
      </Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md, alignItems: "center" }}>
      {link(t("terms"), LEGAL.terms, T.settingsTerms)}
      {link(t("privacy"), LEGAL.privacy, T.settingsPrivacy)}
      {link(t("guidelines"), LEGAL.guidelines, T.settingsGuidelines)}
    </View>
  );
}

function LocaleToggle({ locale, onChange }: { locale: Locale; onChange: (l: Locale) => void }) {
  const { t } = useT();
  const next = LOCALES[(LOCALES.indexOf(locale) + 1) % LOCALES.length] as Locale;
  return (
    <Pressable
      testID={T.localeToggle}
      onPress={() => onChange(next)}
      accessibilityRole="button"
      accessibilityLabel={t("language")}
      accessibilityValue={{ text: locale.toUpperCase() }}
      style={{
        flexDirection: "row",
        gap: spacing.xs,
        alignItems: "center",
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bgElevated,
        paddingHorizontal: spacing.xs,
        paddingVertical: spacing.xs,
      }}
    >
      {LOCALES.map((l) => (
        <View
          key={l}
          style={{
            paddingHorizontal: spacing.sm,
            paddingVertical: 2,
            borderRadius: radius.pill,
            backgroundColor: l === locale ? colors.accentMuted : "transparent",
          }}
        >
          <Text importantForAccessibility="no" style={[typo.micro, { color: l === locale ? colors.text : colors.textMuted }]}>
            {l.toUpperCase()}
          </Text>
        </View>
      ))}
    </Pressable>
  );
}

/** Under 13. A closed door, not a rejection slip. */
function BlockedScreen({ onBack }: { onBack: () => void }) {
  const { t } = useT();
  const reduce = useReduceMotion();
  const breathe = useAnimatedValue(0);

  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        timing(breathe, 1, { duration: duration.celebration * 3, easing: ease.inOut }),
        timing(breathe, 0, { duration: duration.celebration * 3, easing: ease.inOut }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breathe, reduce]);

  return (
    <Screen>
      <Aurora seed="status-blocked" intensity={0.5} />
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: spacing.xl, gap: spacing.xl }}>
        <View style={{ width: "100%", maxWidth: 460, alignSelf: "center", gap: spacing.xl }}>
          <View style={{ alignItems: "center", gap: spacing.lg }}>
            <Animated.View
              style={{
                opacity: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] }),
                transform: [{ scale: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.05] }) }],
              }}
            >
              <SoftOrb from={gradients.cool[0]} to={gradients.cool[1]} size={132} />
            </Animated.View>
            <Wordmark size={28} />
          </View>

          <View
            testID={T.ageBlocked}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            accessibilityLabel={t("underAge")}
            style={{
              borderRadius: radius.xl,
              borderWidth: 1,
              borderColor: colors.borderHi,
              backgroundColor: colors.card,
              padding: spacing.xl,
              gap: spacing.md,
              ...elevation.mid,
            }}
          >
            <Gradient
              colors={gradients.cool}
              angle={115}
              style={{ alignSelf: "flex-start", borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 3 }}
            >
              <Text importantForAccessibility="no" style={[typo.micro, { color: colors.textInverse }]}>
                {`${AGE.MIN}+`}
              </Text>
            </Gradient>
            <Text importantForAccessibility="no" style={[typo.h2, { color: colors.text }]}>
              {t("underAge")}
            </Text>
            <LegalRow />
          </View>

          <Button label={t("back")} variant="secondary" icon="chevronLeft" onPress={onBack} />
        </View>
      </ScrollView>
    </Screen>
  );
}
