import React from "react";
import { View } from "react-native";
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from "react-native-svg";
import { T, colors, hashString, identityFor, radius, spacing, type MediaKind } from "@rpgllm/shared";
import { seeded, seededIn, seededOf } from "../lib/derive";

/**
 * Procedural post media (Agent K) — the thing that turns a wall of text into a feed.
 *
 * There is not one bitmap in this app. A post that "has an image" carries a kind and a seed
 * (`src/lib/derive.ts`), and everything below is drawn from that seed: identical on iOS, Android
 * and the web export, free to ship, impossible to have a broken URL, and legally weightless — no
 * scraped photos, no likenesses.
 *
 *   art   — an abstract composition in the author's identity colours. Reads as "they posted a
 *           picture" without pretending to be a photograph of anyone.
 *   chart — the shape of a number going up (or down): streams, chart position, poll.
 *   leak  — a screenshot of a message thread, redacted. The receipts that drive every scandal.
 */

export interface PostMediaProps {
  postId: string;
  handle: string;
  kind: MediaKind;
  seed: string;
  /** Rendered smaller inside a thread or a profile grid. */
  compact?: boolean;
}

const VW = 320;

/** A soft film grain: cheap, and the difference between "vector art" and "a picture". */
function Grain({ seed, height, count = 90 }: { seed: string; height: number; count?: number }) {
  return (
    <G opacity={0.14}>
      {Array.from({ length: count }, (_, i) => (
        <Circle
          key={i}
          cx={seededIn(seed, 900 + i, 0, VW)}
          cy={seededIn(seed, 1900 + i, 0, height)}
          r={seededIn(seed, 2900 + i, 0.4, 1.7)}
          fill={i % 3 === 0 ? "#000000" : "#FFFFFF"}
        />
      ))}
    </G>
  );
}

function Art({ uid, seed, from, to, height }: { uid: string; seed: string; from: string; to: string; height: number }) {
  const blobs = 4 + Math.floor(seeded(seed, 3) * 3);
  const tilt = seededIn(seed, 4, -28, 28);
  return (
    <>
      <Defs>
        <LinearGradient id={`${uid}bg`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={from} />
          <Stop offset="1" stopColor={to} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={VW} height={height} fill={`url(#${uid}bg)`} />
      {/* A darkened corner gives the composition a light source. */}
      <Ellipse cx={VW * 0.85} cy={height * 0.92} rx={VW * 0.8} ry={height * 0.7} fill="#06060C" opacity={0.42} />
      <G transform={`rotate(${tilt} ${VW / 2} ${height / 2})`}>
        {Array.from({ length: blobs }, (_, i) => (
          <Ellipse
            key={i}
            cx={seededIn(seed, 10 + i, VW * 0.1, VW * 0.9)}
            cy={seededIn(seed, 20 + i, height * 0.1, height * 0.9)}
            rx={seededIn(seed, 30 + i, VW * 0.12, VW * 0.42)}
            ry={seededIn(seed, 40 + i, height * 0.1, height * 0.44)}
            fill={i % 2 === 0 ? "#FFFFFF" : "#06060C"}
            opacity={seededIn(seed, 50 + i, 0.06, 0.24)}
          />
        ))}
      </G>
      {/* Two long arcs: the one shape that reads as intent rather than noise. */}
      {[0, 1].map((i) => {
        const y = seededIn(seed, 60 + i, height * 0.2, height * 0.8);
        const lift = seededIn(seed, 70 + i, -height * 0.6, height * 0.6);
        return (
          <Path
            key={i}
            d={`M ${-20} ${y} Q ${VW / 2} ${y + lift} ${VW + 20} ${y - lift * 0.4}`}
            stroke={i === 0 ? "#FFFFFF" : to}
            strokeWidth={seededIn(seed, 80 + i, 1.2, 3.4)}
            strokeOpacity={seededIn(seed, 90 + i, 0.35, 0.75)}
            fill="none"
          />
        );
      })}
      <Circle
        cx={seededIn(seed, 100, VW * 0.2, VW * 0.8)}
        cy={seededIn(seed, 101, height * 0.2, height * 0.8)}
        r={seededIn(seed, 102, 10, 26)}
        fill="#FFFFFF"
        opacity={0.5}
      />
      <Grain seed={seed} height={height} />
    </>
  );
}

function Chart({ uid, seed, from, to, height }: { uid: string; seed: string; from: string; to: string; height: number }) {
  const bars = 12;
  const rising = seeded(seed, 5) > 0.32;
  const pad = 18;
  const w = (VW - pad * 2) / bars;
  const values = Array.from({ length: bars }, (_, i) => {
    const trend = rising ? i / (bars - 1) : 1 - i / (bars - 1);
    return 0.16 + trend * 0.62 + seeded(seed, 200 + i) * 0.22;
  });
  const top = 26;
  const floor = height - 22;
  const y = (v: number): number => floor - v * (floor - top);
  const line = values.map((v, i) => `${i === 0 ? "M" : "L"} ${pad + w * i + w / 2} ${y(v)}`).join(" ");
  const tone = rising ? colors.positive : colors.negative;
  return (
    <>
      <Defs>
        <LinearGradient id={`${uid}fill`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={tone} stopOpacity={0.42} />
          <Stop offset="1" stopColor={tone} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={VW} height={height} fill={colors.bgElevated} />
      <Rect x={0} y={0} width={VW} height={height} fill={from} opacity={0.1} />
      {[0.25, 0.5, 0.75].map((g) => (
        <Path key={g} d={`M ${pad} ${top + (floor - top) * g} H ${VW - pad}`} stroke={colors.border} strokeWidth={1} />
      ))}
      {values.map((v, i) => (
        <Rect
          key={i}
          x={pad + w * i + w * 0.18}
          y={y(v)}
          width={w * 0.64}
          height={Math.max(2, floor - y(v))}
          rx={3}
          fill={to}
          opacity={0.28 + (i / bars) * 0.35}
        />
      ))}
      <Path d={`${line} L ${VW - pad} ${floor} L ${pad} ${floor} Z`} fill={`url(#${uid}fill)`} />
      <Path d={line} stroke={tone} strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={pad + w * (bars - 1) + w / 2} cy={y(values[bars - 1]!)} r={4.5} fill={tone} />
      {/* The axis line and a caption bar — deliberately wordless, so it needs no translation. */}
      <Rect x={pad} y={floor + 6} width={VW - pad * 2} height={1} fill={colors.border} />
      <Rect x={pad} y={12} width={seededIn(seed, 6, 60, 130)} height={7} rx={3.5} fill={colors.textMuted} opacity={0.5} />
    </>
  );
}

function Leak({ seed, from, height }: { seed: string; from: string; height: number }) {
  const pad = 14;
  const headerH = 30;
  const gap = 7;
  // Bubbles are chat-sized, not panel-sized: as many as fit, stacked from the top, so the card
  // reads as a screenshot of a conversation rather than four abstract slabs.
  const rows: { mine: boolean; w: number; lines: number; h: number }[] = [];
  let y = headerH + pad;
  for (let i = 0; i < 8; i += 1) {
    const lines = seeded(seed, 500 + i) > 0.55 ? 2 : 1;
    const h = lines === 2 ? 34 : 22;
    if (y + h > height - pad) break;
    rows.push({ mine: seeded(seed, 300 + i) > 0.55, w: seededIn(seed, 400 + i, VW * 0.3, VW * 0.6), lines, h });
    y += h + gap;
  }
  let cursor = headerH + pad;
  return (
    <>
      <Rect x={0} y={0} width={VW} height={height} fill={colors.card} />
      <Rect x={0} y={0} width={VW} height={headerH} fill={colors.bgElevated} />
      <Rect x={0} y={headerH} width={VW} height={1} fill={colors.border} />
      <Circle cx={pad + 8} cy={headerH / 2} r={8} fill={from} opacity={0.9} />
      <Rect x={pad + 22} y={headerH / 2 - 7} width={seededIn(seed, 7, 56, 104)} height={5} rx={2.5} fill={colors.textDim} opacity={0.8} />
      <Rect x={pad + 22} y={headerH / 2 + 2} width={seededIn(seed, 8, 30, 62)} height={4} rx={2} fill={colors.textMuted} opacity={0.6} />
      {/* The "…" a screenshot of a thread always has in the corner. */}
      {[0, 1, 2].map((i) => (
        <Circle key={i} cx={VW - pad - 14 + i * 6} cy={headerH / 2} r={1.6} fill={colors.textMuted} />
      ))}
      {rows.map((row, i) => {
        const top = cursor;
        cursor += row.h + gap;
        const x = row.mine ? VW - pad - row.w : pad;
        return (
          <G key={i}>
            <Rect
              x={x}
              y={top}
              width={row.w}
              height={row.h}
              rx={row.h / 2.6}
              fill={row.mine ? from : colors.cardHi}
              opacity={row.mine ? 0.88 : 1}
            />
            {/* Redacted text: the leak is legible as a leak, never as words. */}
            {Array.from({ length: row.lines }, (_, k) => (
              <Rect
                key={k}
                x={x + 10}
                y={top + (row.lines === 2 ? 10 + k * 11 : 9)}
                width={(row.w - 20) * seededIn(seed, 600 + i * 3 + k, 0.4, 0.94)}
                height={4}
                rx={2}
                fill={row.mine ? "#FFFFFF" : colors.textDim}
                opacity={row.mine ? 0.6 : 0.45}
              />
            ))}
          </G>
        );
      })}
      <Grain seed={seed} height={height} count={35} />
    </>
  );
}

/** Aspect the kind is drawn at: art breathes, receipts and charts stay wide. */
function aspectFor(kind: MediaKind, seed: string): number {
  if (kind === "art") return seededOf(seed, 2, [16 / 9, 4 / 5, 1]);
  if (kind === "leak") return 4 / 3;
  return 16 / 9;
}

/**
 * The media block under a post's text. `T.postMedia(postId)` so an E2E case can point at exactly
 * the picture a given post carries.
 */
export function PostMedia({ postId, handle, kind, seed, compact = false }: PostMediaProps) {
  const identity = identityFor(handle);
  // SVG gradient ids are document-global: two `art` posts sharing an id would both paint with the
  // first one's colours. One id per post keeps every picture in its own author's palette.
  const uid = `pm${hashString(`${postId}:${seed}`).toString(36)}`;
  const aspect = aspectFor(kind, seed);
  const height = Math.round(VW / aspect);
  const label = kind === "leak" ? "screenshot" : kind === "chart" ? "chart" : "image";
  return (
    <View
      testID={T.postMedia(postId)}
      accessibilityRole="image"
      accessibilityLabel={`@${handle} — ${label}`}
      style={{
        aspectRatio: aspect,
        width: "100%",
        maxWidth: compact ? 260 : undefined,
        borderRadius: compact ? radius.sm : radius.md,
        borderWidth: 1,
        // The identity ring: the author's colour is on their avatar, their name and their picture.
        borderColor: `${identity.from}55`,
        backgroundColor: colors.bgElevated,
        overflow: "hidden",
        marginTop: spacing.md,
      }}
    >
      <Svg width="100%" height="100%" viewBox={`0 0 ${VW} ${height}`} preserveAspectRatio="xMidYMid slice">
        {kind === "art" ? <Art uid={uid} seed={seed} from={identity.from} to={identity.to} height={height} /> : null}
        {kind === "chart" ? <Chart uid={uid} seed={seed} from={identity.from} to={identity.to} height={height} /> : null}
        {kind === "leak" ? <Leak seed={seed} from={identity.from} height={height} /> : null}
      </Svg>
    </View>
  );
}
