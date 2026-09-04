import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, Pressable, Text, View, type ViewStyle } from "react-native";
import { colors, compactNumber, font, gradients, identityFor, identityPalette, layout, radius, spacing, tList } from "@rpgllm/shared";
import type { StringKey } from "@rpgllm/shared";
import { useT } from "../state/store";
import { AnimatedNumber, Avatar, FadeSlideIn, Gradient, Icon, duration, ease, timing, typo, useAnimatedValue, useReduceMotion } from "../ui";
import { Round, SoftOrb } from "./Brand";

/**
 * The cold open — the three promises of the product, above the sign-in, in about ten seconds.
 *
 * Rules it lives by:
 * - the deck has a **fixed height** and every slide is absolutely positioned inside it, so nothing
 *   below it (the sign-in sheet, its CTA) ever moves while the deck animates;
 * - it is decoration plus a headline: it never covers, disables or delays the sign-in;
 * - all art is generated (gradients + shapes). No image, no font, no network, no invented copy —
 *   the mock bubbles and posts are *shapes*, and every word on screen comes from `i18n`.
 */

const SLIDE_MS = 4200;

/**
 * Seeds for the morphing portrait. They are never shown — `Avatar` hashes them into an identity
 * gradient and a motif, so the disc becomes a different person every beat.
 */
const FACES = ["aurora", "nova", "kite", "ember", "lyric", "onyx"] as const;

/** `plusFeature1` is the one line that lives in i18n's only array string. */
type SubKey = StringKey | "plusFeature1";

interface Slide {
  key: string;
  title: StringKey;
  sub: SubKey;
  art: (active: boolean) => React.ReactNode;
}

/* ------------------------------------------------------------- slide art ---- */

/** "Who do you want to play as?" — one identity dissolving into the next, orbited by the palette. */
function MorphArt({ active }: { active: boolean }) {
  const reduce = useReduceMotion();
  const [step, setStep] = useState(0);
  const cross = useAnimatedValue(0);
  const spin = useAnimatedValue(0);

  useEffect(() => {
    if (!active || reduce) return;
    let alive = true;
    const run = (): void => {
      cross.setValue(0);
      timing(cross, 1, { duration: 1100, delay: 340, easing: ease.out }).start(({ finished }) => {
        if (!alive || !finished) return;
        setStep((s) => s + 1);
        run();
      });
    };
    run();
    return () => {
      alive = false;
      cross.stopAnimation();
    };
  }, [active, cross, reduce]);

  useEffect(() => {
    if (!active || reduce) return;
    spin.setValue(0);
    const loop = Animated.loop(timing(spin, 1, { duration: 26000, easing: ease.linear }));
    loop.start();
    return () => loop.stop();
  }, [active, reduce, spin]);

  const a = FACES[step % FACES.length] ?? FACES[0]!;
  const b = FACES[(step + 1) % FACES.length] ?? FACES[0]!;
  const satellites = [0, 1, 2, 3, 4, 5];

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Animated.View
        style={{
          position: "absolute",
          width: 244,
          height: 244,
          transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }],
        }}
      >
        {satellites.map((i) => {
          const pair = identityPalette[(i * 2 + 1) % identityPalette.length] ?? identityPalette[0]!;
          const angle = (i / satellites.length) * Math.PI * 2;
          return (
            <Round
              key={i}
              size={22}
              style={{ position: "absolute", left: 122 + Math.cos(angle) * 106 - 11, top: 122 + Math.sin(angle) * 106 - 11, opacity: 0.9 }}
            >
              <Gradient colors={[pair[0], pair[1]]} angle={135} style={{ flex: 1 }} />
            </Round>
          );
        })}
      </Animated.View>

      <View style={{ width: 128, height: 128, alignItems: "center", justifyContent: "center" }}>
        <View style={{ position: "absolute", opacity: 0.7 }}>
          <SoftOrb from={identityFor(a).from} to={identityFor(a).to} size={230} />
        </View>
        <Animated.View style={{ position: "absolute", opacity: reduce ? 1 : cross.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}>
          <Avatar handle={a} size={128} />
        </Animated.View>
        <Animated.View
          style={{
            position: "absolute",
            opacity: reduce ? 0 : cross,
            transform: [{ scale: reduce ? 1 : cross.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) }],
          }}
        >
          <Avatar handle={b} size={128} />
        </Animated.View>
        <View style={{ position: "absolute", width: 138, height: 138, borderRadius: radius.pill, borderWidth: 2, borderColor: "rgba(255,255,255,0.2)" }} />
      </View>
    </View>
  );
}

/** A line of "text" inside a mock bubble — shape, never invented words. */
function Bar({ w, tone = "rgba(255,255,255,0.5)", h = 7 }: { w: number; tone?: string; h?: number }) {
  return <View style={{ width: w, height: h, borderRadius: h / 2, backgroundColor: tone }} />;
}

/** "What they remember" — a DM exchange landing one bubble at a time. */
function MemoryArt({ active }: { active: boolean }) {
  const { t } = useT();
  const reduce = useReduceMotion();
  const [shown, setShown] = useState(reduce ? 3 : 0);

  useEffect(() => {
    if (!active) return;
    if (reduce) {
      setShown(3);
      return;
    }
    setShown(0);
    const timers = [380, 1080, 1880].map((ms, i) => setTimeout(() => setShown(i + 1), ms));
    return () => timers.forEach(clearTimeout);
  }, [active, reduce]);

  const pair = identityPalette[6] ?? identityPalette[0]!;
  const bubble = (i: number, mine: boolean, widths: number[]): React.ReactNode => {
    if (shown <= i) return <View key={i} style={{ height: 0 }} />;
    const body = widths.map((w, k) => <Bar key={k} w={w} tone={mine ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.32)"} />);
    const shape: ViewStyle = {
      maxWidth: 208,
      borderRadius: radius.lg,
      borderBottomLeftRadius: mine ? radius.lg : radius.xs,
      borderBottomRightRadius: mine ? radius.xs : radius.lg,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      gap: spacing.sm,
      overflow: "hidden",
    };
    return (
      <FadeSlideIn key={i} distance={12} style={{ alignSelf: mine ? "flex-end" : "flex-start" }}>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.sm }}>
          {!mine ? <Avatar handle="hivequeenbea" size={layout.avatarSm} /> : null}
          {mine ? (
            <Gradient colors={[pair[0], pair[1]]} angle={120} style={shape}>
              {body}
            </Gradient>
          ) : (
            <View style={[shape, { backgroundColor: colors.cardHi }]}>{body}</View>
          )}
        </View>
      </FadeSlideIn>
    );
  };

  return (
    <View style={{ flex: 1, justifyContent: "center", gap: spacing.md, paddingHorizontal: spacing.xl }}>
      {bubble(0, false, [148, 92])}
      {bubble(1, true, [116])}
      {bubble(2, false, [170, 128, 80])}
      <View style={{ alignSelf: "flex-end", opacity: shown >= 3 ? 1 : 0, flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
        <Icon name="check" size={11} color={colors.textMuted} />
        <Text style={[typo.micro, { color: colors.textMuted }]}>{t("seen")}</Text>
      </View>
    </View>
  );
}

/** "You're trending" — the follower count falling while the headline lands on top of it. */
function DramaArt({ active }: { active: boolean }) {
  const { t } = useT();
  const reduce = useReduceMotion();
  const START = 128_400;
  const END = 96_200;
  const [count, setCount] = useState(START);
  const land = useAnimatedValue(0);

  useEffect(() => {
    if (!active) return;
    if (reduce) {
      setCount(END);
      land.setValue(1);
      return;
    }
    setCount(START);
    land.setValue(0);
    const drop = setTimeout(() => setCount(END), 700);
    const a = timing(land, 1, { duration: duration.slow, delay: 1200, easing: ease.out });
    a.start();
    return () => {
      clearTimeout(drop);
      a.stop();
    };
  }, [active, land, reduce]);

  return (
    <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: spacing.xl }}>
      <View style={{ backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <Avatar handle="thescoop" size={layout.avatarMd - 8} badge="flame" />
          <View style={{ gap: spacing.xs, flex: 1 }}>
            <Bar w={104} tone="rgba(255,255,255,0.4)" h={8} />
            <Bar w={66} tone="rgba(255,255,255,0.18)" h={6} />
          </View>
        </View>
        <View style={{ gap: spacing.sm }}>
          <Bar w={212} tone="rgba(255,255,255,0.24)" />
          <Bar w={168} tone="rgba(255,255,255,0.24)" />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <AnimatedNumber value={count} format={compactNumber} style={[typo.display, { color: colors.text, fontSize: font.xxl }]} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
            <Icon name="chevronRight" size={13} color={colors.negative} />
            <Text style={[typo.metaStrong, { color: colors.negative }]}>{compactNumber(END - START)}</Text>
          </View>
        </View>
      </View>

      <Animated.View
        style={{
          position: "absolute",
          right: spacing.xxl,
          bottom: 0,
          opacity: land,
          transform: [
            { translateY: land.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) },
            { rotate: land.interpolate({ inputRange: [0, 1], outputRange: ["-10deg", "-3deg"] }) },
          ],
        }}
      >
        <Gradient
          colors={gradients.hot}
          angle={115}
          style={{ borderRadius: radius.pill, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg }}
        >
          <Text style={[typo.micro, { color: colors.accentInk }]}>{t("youAreTrending")}</Text>
        </Gradient>
      </Animated.View>
    </View>
  );
}

/* ----------------------------------------------------------------- deck ---- */

const SLIDES: Slide[] = [
  { key: "be-anyone", title: "whoToPlay", sub: "ach_level_10_title", art: (a) => <MorphArt active={a} /> },
  { key: "memory", title: "remembers", sub: "plusFeature1", art: (a) => <MemoryArt active={a} /> },
  { key: "drama", title: "youAreTrending", sub: "ach_survivor_desc", art: (a) => <DramaArt active={a} /> },
];

export interface IntroSlidesProps {
  /** Fixed pixel height. The deck never grows or shrinks while it runs. */
  height: number;
  /** Already seen once: one still frame, no rail, no timer. */
  compact?: boolean;
  /** Fired when the deck has been watched through or skipped. */
  onSeen?: () => void;
  style?: ViewStyle;
}

export function IntroSlides({ height, compact = false, onSeen, style }: IntroSlidesProps) {
  const { t, locale } = useT();
  const reduce = useReduceMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const fade = useAnimatedValue(0);
  const rail = useAnimatedValue(0);
  const seenRef = useRef(false);

  const markSeen = useCallback(() => {
    if (seenRef.current) return;
    seenRef.current = true;
    onSeen?.();
  }, [onSeen]);

  const go = useCallback(
    (next: number) => {
      const n = (next + SLIDES.length) % SLIDES.length;
      setIndex(n);
      if (n === SLIDES.length - 1) markSeen();
    },
    [markSeen],
  );

  useEffect(() => {
    if (compact || reduce) {
      fade.setValue(1);
      return;
    }
    fade.setValue(0);
    const a = timing(fade, 1, { duration: duration.base, easing: ease.out });
    a.start();
    return () => a.stop();
  }, [compact, fade, index, reduce]);

  useEffect(() => {
    if (compact || paused) return;
    rail.setValue(0);
    if (reduce) rail.setValue(1);
    else timing(rail, 1, { duration: SLIDE_MS, easing: ease.linear, useNativeDriver: false }).start();
    const id = setTimeout(() => go(index + 1), SLIDE_MS);
    return () => {
      clearTimeout(id);
      rail.stopAnimation();
    };
  }, [compact, go, index, paused, rail, reduce]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderGrant: () => setPaused(true),
        onPanResponderRelease: (_e, g) => {
          setPaused(false);
          if (g.dx < -40) go(index + 1);
          else if (g.dx > 40) go(index - 1);
        },
        onPanResponderTerminate: () => setPaused(false),
      }),
    [go, index],
  );

  const slide = SLIDES[compact ? 0 : index] ?? SLIDES[0]!;
  // i18n index 1 of `plusFeatures` is "Characters text you first" / 「キャラから先にDMが来る」.
  const sub = slide.sub === "plusFeature1" ? (tList(locale, "plusFeatures")[1] ?? "") : t(slide.sub);

  return (
    <View style={[{ height, overflow: "hidden" }, style]} {...(compact ? {} : pan.panHandlers)}>
      <Animated.View key={slide.key} style={{ flex: 1, opacity: fade }}>
        <View style={{ flex: 1 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {slide.art(true)}
        </View>
        <View style={{ paddingHorizontal: spacing.xl, gap: spacing.xs, minHeight: 84, justifyContent: "flex-end" }}>
          <Text accessibilityRole="header" numberOfLines={2} style={[typo.h1, { color: colors.text }]}>
            {t(slide.title)}
          </Text>
          <Text numberOfLines={2} style={[typo.meta, { color: colors.textDim }]}>
            {sub}
          </Text>
        </View>
      </Animated.View>

      {compact ? null : (
        <View style={{ flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.xl, paddingTop: spacing.md, alignItems: "center" }}>
          {SLIDES.map((s, i) => (
            <Pressable
              key={s.key}
              onPress={() => {
                setPaused(false);
                go(i);
              }}
              accessibilityRole="button"
              accessibilityLabel={t(s.title)}
              accessibilityState={{ selected: i === index }}
              style={{ flex: 1, paddingVertical: spacing.sm }}
            >
              <View style={{ height: 3, borderRadius: radius.pill, backgroundColor: colors.borderHi, overflow: "hidden" }}>
                {i === index ? (
                  <Animated.View
                    style={{
                      height: 3,
                      borderRadius: radius.pill,
                      backgroundColor: colors.accentHi,
                      width: rail.interpolate({ inputRange: [0, 1], outputRange: ["4%", "100%"] }),
                    }}
                  />
                ) : (
                  <View style={{ height: 3, width: i < index ? "100%" : "0%", backgroundColor: colors.accentMuted }} />
                )}
              </View>
            </Pressable>
          ))}
          <Pressable
            onPress={() => {
              markSeen();
              go(SLIDES.length - 1);
            }}
            accessibilityRole="button"
            accessibilityLabel={t("close")}
            hitSlop={8}
            style={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.sm }}
          >
            <Text style={[typo.micro, { color: colors.textMuted }]}>{t("close")}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
