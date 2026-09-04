import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Svg, {
  Circle,
  ClipPath,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";
import { colors, hashString, identityFor, layout } from "@rpgllm/shared";
import { Icon, type IconName } from "./Icon";

/**
 * A generated character portrait, not a placeholder.
 *
 * Two-letter initials on a flat disc tell you nothing and all look the same in a scrolling feed.
 * This draws a gradient orb in the handle's identity colours plus one of ten geometric motifs —
 * two of which are faces — picked by the same stable hash. The result is deterministic (identical
 * on web, iOS and Android, and across reinstalls), needs no network, and is crisp at any size
 * because it is vector art rather than a bitmap.
 */
const LIGHT = "rgba(255,255,255,0.92)";
const LIGHT_SOFT = "rgba(255,255,255,0.55)";
const INK = "rgba(6,6,12,0.45)";
const INK_SOFT = "rgba(6,6,12,0.26)";

export type AvatarBadge = "crown" | "heart" | "bolt" | "check" | "flame";

const BADGE_ICON: Record<AvatarBadge, IconName> = {
  crown: "crown",
  heart: "heartFilled",
  bolt: "bolt",
  check: "check",
  flame: "flame",
};

const BADGE_COLOR: Record<AvatarBadge, string> = {
  crown: colors.energy,
  heart: colors.hot,
  bolt: colors.energy,
  check: colors.verified,
  flame: colors.negative,
};

/** Dash pattern for an arc drawn as a dashed circle. */
function arcDash(r: number, fraction: number): string {
  const c = 2 * Math.PI * r;
  return `${(c * fraction).toFixed(2)} ${c.toFixed(2)}`;
}

function Motif({ variant, seed, light, ink }: { variant: number; seed: number; light: string; ink: string }) {
  const spin = (seed % 8) * 45;
  const soft = light === LIGHT ? LIGHT_SOFT : INK_SOFT;
  switch (variant) {
    case 0:
      // halo — a thick broken ring pushed off-centre
      return (
        <G transform={`rotate(${spin} 50 50)`}>
          <Circle cx={50} cy={50} r={37} stroke={light} strokeWidth={9} fill="none" strokeLinecap="round" strokeDasharray={arcDash(37, 0.34)} />
          <Circle cx={50} cy={50} r={22} stroke={ink} strokeWidth={7} fill="none" strokeLinecap="round" strokeDasharray={arcDash(22, 0.26)} />
          <Circle cx={50} cy={50} r={8} fill={light} />
        </G>
      );
    case 1:
      // bullseye — dead centre, perfectly symmetric
      return (
        <G>
          <Circle cx={50} cy={50} r={38} stroke={soft} strokeWidth={3} fill="none" />
          <Circle cx={50} cy={50} r={27} stroke={light} strokeWidth={8} fill="none" />
          <Circle cx={50} cy={50} r={11} fill={ink} />
        </G>
      );
    case 2:
      // scatter — a constellation, no two the same size
      return (
        <G transform={`rotate(${spin} 50 50)`}>
          <Circle cx={31} cy={33} r={9} fill={light} />
          <Circle cx={63} cy={26} r={5} fill={soft} />
          <Circle cx={73} cy={51} r={11} fill={ink} />
          <Circle cx={42} cy={62} r={14} fill={light} />
          <Circle cx={24} cy={68} r={5} fill={soft} />
          <Circle cx={64} cy={77} r={7} fill={ink} />
        </G>
      );
    case 3: {
      // equaliser — bottom-anchored bars
      const h = [34, 62, 44, 74, 52];
      return (
        <G>
          {h.map((v, i) => {
            const height = 16 + ((v + seed * 11) % 52);
            return (
              <Rect
                key={i}
                x={17 + i * 14}
                y={80 - height}
                width={9}
                height={height}
                rx={4.5}
                fill={i % 2 === 0 ? light : ink}
              />
            );
          })}
        </G>
      );
    }
    case 4:
      // eyes — the friendliest of the set
      return (
        <G>
          <Circle cx={35} cy={43} r={7.5} fill={ink} />
          <Circle cx={65} cy={43} r={7.5} fill={ink} />
          <Circle cx={38} cy={40} r={2.4} fill={light} />
          <Circle cx={68} cy={40} r={2.4} fill={light} />
          <Path d="M31 62 Q50 78 69 62" stroke={ink} strokeWidth={6} strokeLinecap="round" fill="none" />
        </G>
      );
    case 5:
      // visor — a band right across the orb, edge to edge
      return (
        <G>
          <Rect x={4} y={38} width={92} height={22} rx={11} fill={ink} />
          <Path d="M20 58 L40 40" stroke={light} strokeWidth={5} strokeLinecap="round" />
          <Path d="M50 58 L62 46" stroke={soft} strokeWidth={4} strokeLinecap="round" />
        </G>
      );
    case 6:
      // wedge — one heavy diagonal mass
      return (
        <G transform={`rotate(${spin / 2} 50 50)`}>
          <Path d="M4 84 L52 8 L96 84 Z" fill={light} />
          <Circle cx={52} cy={62} r={17} fill={ink} />
        </G>
      );
    case 7:
      // chevrons — stacked, marching down
      return (
        <G>
          {[30, 50, 70].map((y, i) => (
            <Path
              key={y}
              d={`M26 ${y - 9} L50 ${y + 8} L74 ${y - 9}`}
              stroke={i === 1 ? ink : light}
              strokeWidth={7}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ))}
        </G>
      );
    case 8:
      // orbit — a tilted ring with a moon
      return (
        <G>
          <Ellipse cx={50} cy={50} rx={44} ry={17} stroke={soft} strokeWidth={4} fill="none" transform={`rotate(${-28 - spin / 4} 50 50)`} />
          <Circle cx={50} cy={50} r={18} fill={light} />
          <Circle cx={50} cy={50} r={7} fill={ink} />
          <Circle cx={84} cy={34} r={7} fill={light} />
        </G>
      );
    default:
      // waves — bottom-weighted, nothing else in the set looks like it
      return (
        <G>
          <Circle cx={50} cy={26} r={10} fill={light} />
          <Path d="M2 58 Q26 32 50 58 T98 58" stroke={light} strokeWidth={8} strokeLinecap="round" fill="none" />
          <Path d="M2 76 Q26 50 50 76 T98 76" stroke={ink} strokeWidth={8} strokeLinecap="round" fill="none" />
        </G>
      );
  }
}

export interface AvatarProps {
  handle: string;
  /** Defaults to `layout.avatarMd`. Use the `layout.avatar*` scale rather than free numbers. */
  size?: number;
  /** Supplying a label puts the avatar in the accessibility tree as a named image. */
  label?: string;
  /** Identity-coloured border — used for verified and press accounts. */
  ring?: boolean;
  /** Small overlay in the bottom-right corner. */
  badge?: AvatarBadge | null;
  /** Muted, for blocked characters and read rows. */
  dim?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Avatar({ handle, size = layout.avatarMd, label, ring = false, badge = null, dim = false, style }: AvatarProps) {
  const clean = handle.replace(/^@/, "").toLowerCase();
  const identity = identityFor(clean);
  const seed = hashString(clean);
  // A second, independent hash so the motif does not track the colour pair.
  const motifSeed = hashString(`${clean}~motif`);
  const variant = motifSeed % 10;
  const inverted = ((motifSeed >> 7) & 1) === 1;
  // A third axis of variation, so two handles have to collide three ways to look alike.
  const zoom = [0.86, 1, 1.14][(motifSeed >> 13) % 3] ?? 1;
  const uid = `av${identity.index}x${(seed % 100000).toString(36)}${variant}`;
  const angle = (seed >> 3) % 4;
  const coords =
    angle === 0
      ? { x1: "0", y1: "0", x2: "1", y2: "1" }
      : angle === 1
        ? { x1: "0", y1: "1", x2: "1", y2: "0" }
        : angle === 2
          ? { x1: "0", y1: "0", x2: "0", y2: "1" }
          : { x1: "1", y1: "0", x2: "0", y2: "1" };

  const a11y =
    label === undefined
      ? ({ accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" } as const)
      : ({ accessibilityRole: "image", accessibilityLabel: label } as const);

  const orbR = ring ? 43 : 49;
  const badgeSize = Math.max(14, Math.round(size * 0.36));

  return (
    <View {...a11y} style={[{ width: size, height: size, opacity: dim ? 0.45 : 1 }, style]}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id={`${uid}g`} x1={coords.x1} y1={coords.y1} x2={coords.x2} y2={coords.y2}>
            <Stop offset="0" stopColor={identity.from} />
            <Stop offset="1" stopColor={identity.to} />
          </LinearGradient>
          <RadialGradient id={`${uid}s`} cx="0.32" cy="0.26" r="0.75">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.3" />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </RadialGradient>
          <ClipPath id={`${uid}c`}>
            <Circle cx={50} cy={50} r={orbR} />
          </ClipPath>
        </Defs>
        {ring ? <Circle cx={50} cy={50} r={48} stroke={identity.from} strokeWidth={2.5} fill="none" /> : null}
        <Circle cx={50} cy={50} r={orbR} fill={`url(#${uid}g)`} />
        <G clipPath={`url(#${uid}c)`} opacity={0.9}>
          <G transform={`translate(50 50) scale(${zoom}) translate(-50 -50)`}>
            <Motif variant={variant} seed={motifSeed} light={inverted ? INK : LIGHT} ink={inverted ? LIGHT : INK} />
          </G>
        </G>
        <Circle cx={50} cy={50} r={orbR} fill={`url(#${uid}s)`} />
        <Circle cx={50} cy={50} r={orbR - 0.7} stroke="rgba(255,255,255,0.16)" strokeWidth={1.4} fill="none" />
      </Svg>
      {badge ? (
        <View
          style={{
            position: "absolute",
            right: -1,
            bottom: -1,
            width: badgeSize,
            height: badgeSize,
            borderRadius: badgeSize / 2,
            backgroundColor: colors.bgElevated,
            borderWidth: 1.5,
            borderColor: colors.bg,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name={BADGE_ICON[badge]} size={badgeSize * 0.62} color={BADGE_COLOR[badge]} filled />
        </View>
      ) : null}
    </View>
  );
}
