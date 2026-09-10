import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import {
  LOCALES,
  T,
  WORLD_MODERATION,
  WORLD_STUDIO,
  colors,
  compactNumber,
  font,
  glow,
  layout,
  radius,
  spacing,
  type Locale,
  type WorldGenre,
} from "@rpgllm/shared";
import { api, ApiError, type WorldVisibility } from "../../src/api/client";
import { Button, HeaderBar, Screen } from "../../src/components/ui";
import { Aurora } from "../../src/components/Brand";
import { ShelfPrice } from "../../src/components/ShelfPrice";
import { WorldCover } from "../../src/components/WorldCard";
import { useActions, useAppState, useT } from "../../src/state/store";
import {
  GENRES,
  GENRE_LABEL,
  GENRE_TINT,
  VISIBILITIES,
  VISIBILITY_HINT,
  VISIBILITY_LABEL,
} from "../../src/studio/labels";
import { rememberShelfFee } from "../../src/studio/shelf-fee";
import { FadeSlideIn, Gradient, Icon, PressScale, typo } from "../../src/ui";

/**
 * SCR-048 — World Studio, create.
 *
 * The whole screen exists to make someone want to type one line. So the premise field is the hero:
 * it is the largest thing on the page, it is the only thing above the fold besides the pitch, and
 * while it is empty it shows a rotating example — the placeholder cycles through real one-line
 * worlds so the player can see the shape of the answer before writing their own.
 *
 * Everything below it is the price of that line, stated plainly: what it costs in gems, what the
 * balance is, how many builds are left today, and who will be able to play the result.
 */

const MIN = 8;
const MAX = 200;
/** A little headroom past the cap so an over-long line is *shown* to be over rather than truncated. */
const HARD_CAP = MAX + 60;
const PLACEHOLDER_MS = 4200;

function Label({ text }: { text: string }) {
  return (
    <Text accessibilityRole="header" style={[typo.micro, { color: colors.textMuted }]}>
      {text.toUpperCase()}
    </Text>
  );
}

/** The hero field's rotating example line. Real worlds, not lorem — see the header comment. */
function RotatingExample({ examples, index }: { examples: readonly string[]; index: number }) {
  const text = examples[index % Math.max(1, examples.length)] ?? "";
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: "absolute", left: spacing.lg, right: spacing.lg, top: spacing.lg }}
    >
      <FadeSlideIn key={`${index}-${text}`} distance={8}>
        <Text
          numberOfLines={3}
          style={[typo.body, { color: colors.textMuted, fontSize: font.lg, lineHeight: font.lg * 1.4 }]}
        >
          {text}
        </Text>
      </FadeSlideIn>
    </View>
  );
}

function GenreChip({ genre, selected, onPress }: { genre: WorldGenre; selected: boolean; onPress: () => void }) {
  const { t } = useT();
  const tint = GENRE_TINT[genre];
  const label = t(GENRE_LABEL[genre]);
  return (
    <Pressable
      testID={T.studioGenre(genre)}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      hitSlop={spacing.xs}
    >
      {({ pressed }) => (
        <PressScale pressed={pressed} to={0.95}>
          <View
            style={{
              paddingHorizontal: spacing.lg,
              paddingVertical: spacing.sm,
              minHeight: 38,
              justifyContent: "center",
              borderRadius: radius.pill,
              backgroundColor: selected ? `${tint}26` : colors.card,
              borderWidth: 1,
              borderColor: selected ? tint : colors.border,
            }}
          >
            <Text importantForAccessibility="no" style={[typo.label, { color: selected ? tint : colors.textDim }]}>
              {label}
            </Text>
          </View>
        </PressScale>
      )}
    </Pressable>
  );
}

function VisibilityRow({
  value,
  selected,
  onPress,
}: {
  value: WorldVisibility;
  selected: boolean;
  onPress: () => void;
}) {
  const { t } = useT();
  const title = t(VISIBILITY_LABEL[value]);
  const hint = t(VISIBILITY_HINT[value]);
  return (
    <Pressable
      testID={T.studioVisibility(value)}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title}. ${hint}`}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "flex-start",
        gap: spacing.md,
        padding: spacing.md,
        minHeight: 56,
        borderRadius: radius.md,
        backgroundColor: selected ? colors.cardHi : pressed ? colors.card : "transparent",
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.border,
      })}
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: radius.pill,
          borderWidth: selected ? 6 : 1,
          borderColor: selected ? colors.accent : colors.borderHi,
          marginTop: 2,
        }}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <Text importantForAccessibility="no" style={[typo.metaStrong, { color: colors.text }]}>
          {title}
        </Text>
        <Text importantForAccessibility="no" style={[typo.caption, { color: colors.textMuted }]}>
          {hint}
        </Text>
      </View>
      {value === "public" ? <Icon name="eye" size={16} color={selected ? colors.accentHi : colors.textMuted} /> : null}
    </Pressable>
  );
}

/**
 * Circuit ④ — what this screen is when it was opened from a world.
 *
 * A remix keeps the source's genre and locale and takes a new premise, so in this mode the two
 * pickers are *gone* rather than pre-selected: the contract makes `genre` and `locale` optional
 * precisely so the server can inherit them from the source, and no world response exposes either
 * field for the client to echo back (recorded in build-notes). Showing pickers whose value the
 * request will not carry would be a lie about what the screen does — and the point of the mode is
 * that the only thing left to decide is the premise.
 */
function RemixSource({ title, slug, by }: { title: string; slug: string; by: string }) {
  const { t } = useT();
  return (
    <View
      testID={T.remixSource}
      accessibilityRole="text"
      accessibilityLabel={`${t("remixFrom")} ${title}${by ? ` ${t("studioBy")} @${by}` : ""}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        padding: spacing.md,
        borderRadius: radius.lg,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: `${colors.accent}55`,
      }}
    >
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: radius.md,
          overflow: "hidden",
          backgroundColor: colors.bgElevated,
        }}
      >
        <WorldCover slug={slug} height={56} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text importantForAccessibility="no" style={[typo.micro, { color: colors.textMuted }]}>
          {t("remixFrom").toUpperCase()}
        </Text>
        <Text numberOfLines={1} importantForAccessibility="no" style={[typo.h2, { color: colors.text }]}>
          {title}
        </Text>
        {by ? (
          <Text numberOfLines={1} importantForAccessibility="no" style={[typo.count, { color: colors.textMuted }]}>
            {`${t("studioBy")} @${by}`}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export default function StudioCreate() {
  const params = useLocalSearchParams<{
    remixOf?: string;
    remixTitle?: string;
    remixSlug?: string;
    remixBy?: string;
  }>();
  const remixOf = params.remixOf ?? "";
  const remixing = remixOf.length > 0;
  const { me, worlds, locale } = useAppState();
  const { loadWorlds, refreshMe, setDraft } = useActions();
  const { t } = useT();

  const [premise, setPremise] = useState("");
  const [genre, setGenre] = useState<WorldGenre>(GENRES[0] ?? "fame");
  const [worldLocale, setWorldLocale] = useState<Locale>(locale);
  /** Once the player picks a language by hand, the account's own locale stops overriding it. */
  const localeTouched = useRef(false);
  const [visibility, setVisibility] = useState<WorldVisibility>("private");
  const [focused, setFocused] = useState(false);
  const [example, setExample] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** `null` = the server has not told us yet; the chip stays hidden rather than inventing a number. */
  const [remaining, setRemaining] = useState<number | null>(null);
  const [serverShelfFee, setServerShelfFee] = useState<number | undefined>(undefined);
  const mounted = useRef(true);

  const gems = me?.wallet.gems ?? 0;
  const trimmed = premise.trim();
  const length = trimmed.length;
  const tooShort = length > 0 && length < MIN;
  const tooLong = length > MAX;
  const validLength = length >= MIN && length <= MAX;
  const poor = gems < WORLD_STUDIO.GEM_COST;
  /**
   * "Everyone", picked here, is the same decision as SCR-049's share button — the build job walks
   * the finished world through the same transition and the same shelf charge. So this screen owes
   * the same two things: the price, said before the pick, and a refusal that names *which* half is
   * short. A world built for 120 whose shelf fee then fails silently is exactly the toll this
   * charge must not become.
   */
  // The server's figure once it has answered; the shipped constant until then.
  const feeInForce = serverShelfFee ?? WORLD_MODERATION.PUBLIC_SUBMIT_GEMS;
  const shelfFee = visibility === "public" ? feeInForce : 0;
  const poorForShelf = !poor && gems < WORLD_STUDIO.GEM_COST + shelfFee;
  const capped = remaining !== null && remaining <= 0;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    void refreshMe();
    if (!worlds) void loadWorlds();
  }, [refreshMe, loadWorlds, worlds]);

  // The screen can mount before `/v1/me` answers, and the account's locale is the better default
  // than the device's guess — so follow it until the player says otherwise.
  useEffect(() => {
    if (!localeTouched.current) setWorldLocale(locale);
  }, [locale]);

  /** How many builds are left today. Degrades to "unknown" — never to a guess — if the API is down. */
  const loadRemaining = useCallback(async () => {
    try {
      const mine = await api.myWorlds();
      if (mounted.current) {
        setRemaining(mine.remainingToday);
        // The fee in force on this deployment, rather than the constant this build shipped with.
        setServerShelfFee(mine.publicSubmitGems);
        rememberShelfFee(mine.publicSubmitGems);
      }
    } catch {
      if (mounted.current) setRemaining(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadRemaining();
    }, [loadRemaining]),
  );

  /**
   * The examples: the shipped one-liner first, then the scenarios of the worlds that already
   * exist — they are written in the player's language by the server and are exactly the shape a
   * premise should take.
   */
  const examples = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const line of [t("studioPremisePlaceholder"), ...(worlds ?? []).map((w) => w.scenario)]) {
      const clean = line.trim();
      if (!clean || seen.has(clean)) continue;
      seen.add(clean);
      out.push(clean);
    }
    return out;
  }, [t, worlds]);

  const rotating = premise.length === 0 && !focused && examples.length > 1;
  useEffect(() => {
    if (!rotating) return;
    const id = setInterval(() => setExample((n) => n + 1), PLACEHOLDER_MS);
    return () => clearInterval(id);
  }, [rotating]);

  const errorText =
    error ??
    (capped ? t("studioLimitReached") : null) ??
    (poor ? t("studioNotEnoughGems") : null) ??
    (poorForShelf ? t("studioNotEnoughForPublic") : null) ??
    (tooShort ? t("studioPremiseTooShort") : null) ??
    (tooLong ? t("studioPremiseTooLong") : null);

  const onCreate = async () => {
    if (!validLength || busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = remixing
        ? await api.remixWorld(remixOf, { premise: trimmed, visibility })
        : await api.createWorld({ premise: trimmed, genre, locale: worldLocale, visibility });
      void refreshMe();
      setDraft(null);
      router.replace({ pathname: "/studio/[id]", params: { id: res.world.id } });
    } catch (e) {
      if (!mounted.current) return;
      /*
       * The create route has its own codes, and two of them are 429s that mean opposite things:
       * WORLD_LIMIT is "come back tomorrow" (the day's builds are spent), RATE_LIMITED is "slow
       * down". Codes are checked before status so the copy can never be the wrong one of the two.
       */
      const err = e instanceof ApiError ? e : null;
      const code = err?.code;
      setError(
        code === "GEMS_REQUIRED"
          ? t("studioNotEnoughGems")
          : code === "WORLD_LIMIT"
            ? t("studioLimitReached")
            : code === "SAFETY_BLOCKED"
              ? t("studioPremiseBlocked")
              : code === "RATE_LIMITED"
                ? t("rateLimited")
                : err?.status === 422
                  ? t("studioPremiseBlocked")
                  : err?.status === 402
                    ? t("studioNotEnoughGems")
                    : err?.status === 429
                      ? t("studioLimitReached")
                      : t("loadFailed"),
      );
      // Either 429 changes what the allowance chip should say — ask the server rather than guess.
      if (err?.status === 429) void loadRemaining();
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const countTone = tooLong ? colors.danger : validLength ? colors.positive : colors.textMuted;
  /** Everything the build needs is in place — the CTA lights up. */
  const ready = validLength && !busy && !poor && !poorForShelf && !capped;

  return (
    <Screen wash={false}>
      <Aurora seed={remixing ? `remix-${params.remixSlug ?? remixOf}` : "world-studio"} intensity={0.9} />
      <HeaderBar
        title={remixing ? t("remix") : t("studioTitle")}
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/feed"))}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.xl }}
      >
        <View style={{ width: "100%", maxWidth: layout.maxContentWidth, alignSelf: "center", gap: spacing.xl }}>
          <View style={{ gap: spacing.sm }}>
            <Text accessibilityRole="header" style={[typo.title, { color: colors.text }]}>
              {remixing ? t("remix") : t("studioPitch")}
            </Text>
            {remixing ? <Text style={[typo.meta, { color: colors.textDim }]}>{t("remixHint")}</Text> : null}
          </View>

          {/* What you are building on, named — so the premise field is answered against something. */}
          {remixing ? (
            <RemixSource
              title={params.remixTitle ?? ""}
              slug={params.remixSlug ?? ""}
              by={(params.remixBy ?? "").replace(/^@/, "")}
            />
          ) : null}

          {/* ---------------------------------------------------------- the hero field ---- */}
          <View style={{ gap: spacing.sm }}>
            <Label text={t("studioPremiseLabel")} />
            <View
              style={{
                borderRadius: radius.lg,
                borderWidth: 1,
                borderColor: focused ? colors.accent : tooLong ? colors.danger : colors.border,
                backgroundColor: colors.card,
                overflow: "hidden",
              }}
            >
              <Gradient
                colors={[`${colors.accent}1A`, "rgba(124,92,255,0)"]}
                angle={160}
                pointerEvents="none"
                style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
              />
              <TextInput
                testID={T.studioPremiseInput}
                accessibilityLabel={t("studioPremiseLabel")}
                value={premise}
                onChangeText={(v) => setPremise(v.slice(0, HARD_CAP))}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                multiline
                style={{
                  minHeight: 132,
                  color: colors.text,
                  fontSize: font.lg,
                  lineHeight: font.lg * 1.4,
                  padding: spacing.lg,
                  textAlignVertical: "top",
                }}
              />
              {premise.length === 0 ? <RotatingExample examples={examples} index={example} /> : null}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: spacing.md,
                  paddingHorizontal: spacing.lg,
                  paddingBottom: spacing.md,
                }}
              >
                <Text style={[typo.caption, { color: colors.textMuted, flex: 1 }]}>{t("studioPremiseHint")}</Text>
                <Text
                  testID={T.studioPremiseCount}
                  accessibilityLabel={`${length} / ${MAX}`}
                  style={[typo.count, { color: countTone }]}
                >
                  {`${length}/${MAX}`}
                </Text>
              </View>
            </View>
          </View>

          {/* ------------------------------------------------------------------ genre ---- */}
          {remixing ? null : (
            <View style={{ gap: spacing.md }}>
              <Label text={t("studioGenreLabel")} />
              <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                {GENRES.map((g) => (
                  <GenreChip key={g} genre={g} selected={g === genre} onPress={() => setGenre(g)} />
                ))}
              </View>
            </View>
          )}

          {/* --------------------------------------------------------------- language ---- */}
          {remixing ? null : (
            <View style={{ gap: spacing.md }}>
              <Label text={t("studioLocaleLabel")} />
              <View accessibilityRole="radiogroup" style={{ flexDirection: "row", gap: spacing.sm }}>
                {LOCALES.map((l) => {
                  const selected = l === worldLocale;
                  return (
                    <Pressable
                      key={l}
                      testID={T.studioLocale(l)}
                      onPress={() => {
                        localeTouched.current = true;
                        setWorldLocale(l);
                      }}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${t("language")} ${l.toUpperCase()}`}
                      style={{
                        minWidth: 64,
                        minHeight: 40,
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: radius.md,
                        backgroundColor: selected ? colors.cardHi : "transparent",
                        borderWidth: 1,
                        borderColor: selected ? colors.accent : colors.border,
                      }}
                    >
                      <Text
                        importantForAccessibility="no"
                        style={[typo.label, { color: selected ? colors.text : colors.textDim }]}
                      >
                        {l.toUpperCase()}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {/* ------------------------------------------------------------- visibility ---- */}
          <View style={{ gap: spacing.sm }}>
            <Label text={t("studioVisibilityLabel")} />
            <View accessibilityRole="radiogroup" style={{ gap: spacing.sm }}>
              {VISIBILITIES.map((v) => (
                <VisibilityRow key={v} value={v} selected={v === visibility} onPress={() => setVisibility(v)} />
              ))}
            </View>
            {/*
              Only under the door that costs something, and only once it is chosen — the other two
              rows stay exactly as free as they are. The balance is left out here because the price
              card directly below already carries it; two gem counts a thumb apart is noise.
            */}
            {visibility === "public" ? (
              <FadeSlideIn distance={8}>
                <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.xxs }}>
                  <ShelfPrice gems={null} tone="quiet" identified={false} fee={feeInForce} />
                </View>
              </FadeSlideIn>
            ) : null}
          </View>

          {/* ------------------------------------------------------------ price + CTA ---- */}
          <View style={{ gap: spacing.md }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: spacing.md,
                padding: spacing.md,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: poor ? `${colors.danger}66` : colors.border,
                backgroundColor: colors.card,
              }}
            >
              <View
                testID={T.studioCost}
                accessibilityRole="text"
                accessibilityLabel={t("studioCost")}
                style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flexShrink: 1 }}
              >
                <Icon name="gem" size={16} color={colors.gem} filled />
                <Text
                  numberOfLines={1}
                  importantForAccessibility="no"
                  style={[typo.metaStrong, { color: colors.text }]}
                >
                  {t("studioCost")}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 2 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
                  <Icon name="gem" size={13} color={poor ? colors.danger : colors.gem} filled />
                  <Text
                    accessibilityRole="text"
                    accessibilityLabel={`${compactNumber(gems)}`}
                    style={[typo.count, { color: poor ? colors.danger : colors.text }]}
                  >
                    {compactNumber(gems)}
                  </Text>
                </View>
                {remaining !== null ? (
                  <Text
                    testID={T.studioRemaining}
                    accessibilityRole="text"
                    accessibilityLabel={`${remaining} ${t("studioRemainingToday")}`}
                    style={[typo.caption, { color: capped ? colors.negative : colors.textMuted }]}
                  >
                    {`${remaining} ${t("studioRemainingToday")}`}
                  </Text>
                ) : null}
              </View>
            </View>

            {errorText ? (
              <Text
                testID={T.studioError}
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                style={[typo.meta, { color: colors.danger }]}
              >
                {errorText}
              </Text>
            ) : null}

            {/*
              The CTA is lit rather than animated. A looping pulse on the button itself never
              settles, which makes it unclickable to an automated driver (and jittery to a thumb);
              a violet glow says "this is the button" without moving.
            */}
            <View style={ready ? { borderRadius: radius.pill, ...glow(colors.accent, 22) } : undefined}>
              <Button
                testID={remixing ? T.remixCreate : T.studioCreate}
                label={t("studioCreate")}
                icon="sparkle"
                onPress={() => void onCreate()}
                loading={busy}
                disabled={!validLength || busy || poor || poorForShelf || capped}
              />
            </View>
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
