import React, { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import { colors, elevation, font, hashString, identityFor, identityPalette, layout, radius, spacing } from "@rpgllm/shared";
import type { Character, WorldSummary } from "../api/types";
import { Avatar, Icon, PressScale, typo } from "../ui";
import { FILL } from "./Brand";

/**
 * SCR-003 world card.
 *
 * The cover is *generated*: a seeded composition of gradient bands, a horizon and scattered light,
 * derived from the world slug. "Popstar Era" therefore paints the same picture on every device and
 * both platforms with nothing to download — there is no external image anywhere in this app.
 */

const COVER_W = 320;
const COVER_H = 180;
const COVER_DISPLAY_H = 152;

/** mulberry32 — a tiny deterministic PRNG, so one slug always paints one cover. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The generated cover. Exported because the World Studio (SCR-049/050) paints the same art for a
 * world a player just made — a brand-new world has no image to fetch and never will.
 */
export function WorldCover({ slug, height }: { slug: string; height: number }) {
  const art = useMemo(() => {
    const seed = hashString(slug);
    const rnd = seeded(seed);
    const id = identityFor(slug);
    const alt = identityPalette[(id.index + 4) % identityPalette.length] ?? identityPalette[0]!;
    return {
      uid: `wc${seed.toString(36)}`,
      id,
      alt,
      bands: Array.from({ length: 5 }, (_, i) => ({
        x: rnd() * COVER_W,
        w: 14 + rnd() * 46,
        o: 0.06 + rnd() * 0.18,
        c: i % 2 === 0 ? alt[0] : id.to,
      })),
      sparks: Array.from({ length: 28 }, () => ({
        cx: rnd() * COVER_W,
        cy: rnd() * COVER_H,
        r: 0.7 + rnd() * 2.3,
        o: 0.18 + rnd() * 0.6,
      })),
      horizon: 92 + rnd() * 48,
      lift: 26 + rnd() * 46,
    };
  }, [slug]);

  const sky = `${art.uid}sky`;
  const beam = `${art.uid}beam`;
  const glow = `${art.uid}glow`;
  const fade = `${art.uid}fade`;

  return (
    <View pointerEvents="none" style={{ height, width: "100%" }}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${COVER_W} ${COVER_H}`} preserveAspectRatio="xMidYMid slice">
        <Defs>
          <LinearGradient id={sky} x1="0" y1="0" x2="0.9" y2="1">
            <Stop offset="0" stopColor={art.id.from} />
            <Stop offset="0.55" stopColor={art.id.to} />
            <Stop offset="1" stopColor={colors.bg} />
          </LinearGradient>
          <LinearGradient id={beam} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.5" />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </LinearGradient>
          <LinearGradient id={glow} x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor={art.alt[0]} stopOpacity="0.85" />
            <Stop offset="1" stopColor={art.alt[1]} stopOpacity="0" />
          </LinearGradient>
          <LinearGradient id={fade} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.bg} stopOpacity="0" />
            <Stop offset="0.55" stopColor={colors.bg} stopOpacity="0.4" />
            <Stop offset="1" stopColor={colors.bg} stopOpacity="0.88" />
          </LinearGradient>
        </Defs>

        <Rect x="0" y="0" width={COVER_W} height={COVER_H} fill={`url(#${sky})`} />
        <G>
          {art.bands.map((b, i) => (
            <Rect key={i} x={b.x} y="0" width={b.w} height={COVER_H} fill={`url(#${beam})`} opacity={b.o} />
          ))}
        </G>
        {art.sparks.map((s, i) => (
          <Circle key={i} cx={s.cx} cy={s.cy} r={s.r} fill="#FFFFFF" opacity={s.o} />
        ))}
        <Ellipse cx={COVER_W / 2} cy={COVER_H + art.lift} rx={COVER_W * 0.88} ry={art.lift + 36} fill={`url(#${glow})`} />
        <Path
          d={`M0 ${art.horizon} Q ${COVER_W / 2} ${art.horizon - art.lift} ${COVER_W} ${art.horizon}`}
          stroke="#FFFFFF"
          strokeOpacity="0.26"
          strokeWidth="1.4"
          fill="none"
        />
        <Rect x="0" y="0" width={COVER_W} height={COVER_H} fill={`url(#${fade})`} />
      </Svg>
    </View>
  );
}

function Difficulty({ level }: { level: number }) {
  return (
    <View
      style={{ flexDirection: "row", gap: 3, alignItems: "center" }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {[0, 1, 2].map((i) => (
        <Icon key={i} name="sparkle" size={13} color={i < level ? colors.energy : colors.borderHi} filled={i < level} />
      ))}
    </View>
  );
}

function CastStrip({ cast }: { cast: readonly Character[] }) {
  const shown = cast.slice(0, 3);
  const rest = Math.max(0, cast.length - shown.length);
  if (shown.length === 0) return null;
  return (
    <View
      style={{ flexDirection: "row", alignItems: "center" }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {shown.map((c, i) => (
        <View key={c.id} style={{ marginLeft: i === 0 ? 0 : -11, borderRadius: radius.pill, borderWidth: 2, borderColor: colors.card }}>
          <Avatar handle={c.handle} size={layout.avatarSm} />
        </View>
      ))}
      {rest > 0 ? <Text style={[typo.count, { color: colors.textMuted, marginLeft: spacing.sm }]}>{`+${rest}`}</Text> : null}
    </View>
  );
}

export interface WorldCardProps {
  world: WorldSummary;
  cast?: readonly Character[];
  onPress: () => void;
  testID: string;
}

export function WorldCard({ world, cast = [], onPress, testID }: WorldCardProps) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${world.title}. ${world.scenario}`}
    >
      {({ pressed }) => (
        <PressScale pressed={pressed} to={0.985}>
          <View
            style={{
              borderRadius: radius.xl,
              overflow: "hidden",
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: pressed ? colors.borderHi : colors.border,
              ...elevation.mid,
            }}
          >
            <View style={{ height: COVER_DISPLAY_H }}>
              <WorldCover slug={world.slug} height={COVER_DISPLAY_H} />
              <View style={[FILL, { justifyContent: "flex-end", padding: spacing.lg }]}>
                <Text
                  numberOfLines={2}
                  importantForAccessibility="no"
                  style={[
                    typo.title,
                    {
                      color: colors.text,
                      fontSize: font.xl,
                      textShadowColor: "rgba(0,0,0,0.6)",
                      textShadowRadius: 14,
                      textShadowOffset: { width: 0, height: 2 },
                    },
                  ]}
                >
                  {world.title}
                </Text>
              </View>
            </View>

            <View style={{ padding: spacing.lg, gap: spacing.md }}>
              <Text numberOfLines={2} importantForAccessibility="no" style={[typo.meta, { color: colors.textDim }]}>
                {world.scenario}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md }}>
                <Difficulty level={world.difficulty} />
                <CastStrip cast={cast} />
              </View>
            </View>
          </View>
        </PressScale>
      )}
    </Pressable>
  );
}
