import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { colors, radius } from "@rpgllm/shared";
import { Avatar, Gradient, useReduceMotion } from "../ui";
import { Wordmark } from "../components/ui";
import { frameAt } from "./frame";
import { familyFor, planReel, QUALITY_LITE, STAGE, type ReelNode, type SceneLabels } from "./scene";
import type { MomentReel } from "../api/client";
import type { ReelStageHandle } from "./types";

/**
 * The stage, on iOS and Android: the same scene graph, painted with views instead of a canvas.
 *
 * There is no `<canvas>` and no `MediaRecorder` on a phone, so this half deliberately does less —
 * it animates, it does not export. What it must not do is *look* different: every coordinate,
 * colour, line break and easing comes from `scene.ts`, exactly as the web painter's do, so what a
 * player sees here is what the web build would put in the file.
 *
 * Native runs the lighter scene budget (fewer motes, no per-frame twinkle) because every frame here
 * is a React render rather than a draw call.
 */

const FPS = 24;

export interface ReelStageProps {
  reel: MomentReel;
  labels: SceneLabels;
  width: number;
  testID?: string;
}

function Node({ node, index }: { node: ReelNode; index: number }): React.ReactElement | null {
  switch (node.k) {
    case "fill":
      return <View key={index} style={{ position: "absolute", left: 0, top: 0, width: STAGE.w, height: STAGE.h, backgroundColor: node.color }} />;
    case "rect":
      return (
        <View
          key={index}
          style={{
            position: "absolute",
            left: node.x,
            top: node.y,
            width: node.w,
            height: node.h,
            borderRadius: node.r,
            opacity: node.alpha,
            backgroundColor: node.fill ?? undefined,
            borderWidth: node.stroke ? node.sw : 0,
            borderColor: node.stroke ?? undefined,
          }}
        />
      );
    case "grad":
      return (
        <Gradient
          key={index}
          colors={[node.from, node.to]}
          angle={node.angle}
          pointerEvents="none"
          style={{ position: "absolute", left: node.x, top: node.y, width: node.w, height: node.h, borderRadius: node.r, opacity: node.alpha }}
        />
      );
    case "glow":
    case "dot":
      return (
        <View
          key={index}
          style={{
            position: "absolute",
            left: node.x - node.r,
            top: node.y - node.r,
            width: node.r * 2,
            height: node.r * 2,
            borderRadius: node.r,
            backgroundColor: node.color,
            opacity: node.k === "glow" ? node.alpha * 0.5 : node.alpha,
          }}
        />
      );
    case "ring":
      return (
        <View
          key={index}
          style={{
            position: "absolute",
            left: node.x - node.r,
            top: node.y - node.r,
            width: node.r * 2,
            height: node.r * 2,
            borderRadius: node.r,
            borderWidth: Math.max(1, node.sw),
            borderColor: node.color,
            opacity: node.alpha,
          }}
        />
      );
    case "orb":
      return (
        <View key={index} style={{ position: "absolute", left: node.x, top: node.y, opacity: node.alpha }}>
          <Avatar handle={node.handle} size={node.size} ring={node.ring} />
        </View>
      );
    case "mark":
      return (
        <View key={index} style={{ position: "absolute", left: node.x - node.size * 1.95, top: node.y - node.size * 0.62, opacity: node.alpha }}>
          <Wordmark size={node.size} />
        </View>
      );
    case "text": {
      const line = Math.round(node.size * 1.2);
      return (
        <Text
          key={index}
          numberOfLines={1}
          style={{
            position: "absolute",
            left: node.x,
            top: node.y - line / 2,
            width: node.w,
            textAlign: node.align,
            fontFamily: familyFor(node.face, node.bold),
            fontWeight: node.bold ? "700" : "400",
            fontSize: node.size,
            lineHeight: line,
            letterSpacing: node.track,
            color: node.color,
            opacity: node.alpha,
          }}
        >
          {node.text}
        </Text>
      );
    }
    default:
      return null;
  }
}

export const ReelStage = forwardRef<ReelStageHandle, ReelStageProps>(function ReelStage(
  { reel, labels, width, testID },
  ref,
) {
  const reduced = useReduceMotion();
  const plan = useMemo(() => planReel(reel, labels, QUALITY_LITE), [reel, labels]);
  const [t, setT] = useState(reduced ? plan.t.headline + 500 : 0);
  const frame = useRef<number | null>(null);
  const height = Math.round((width * STAGE.h) / STAGE.w);
  const scale = width / STAGE.w;

  const stop = (): void => {
    if (frame.current !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame.current);
    frame.current = null;
  };

  const run = (): void => {
    stop();
    const started = Date.now();
    let last = -1;
    const step = (): void => {
      const now = Date.now() - started;
      // one React render per animation frame is expensive; 24 is enough to read as motion
      if (now - last >= 1000 / FPS) {
        last = now;
        setT(Math.min(now, plan.durationMs));
      }
      if (now >= plan.durationMs) {
        frame.current = null;
        return;
      }
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  };

  useEffect(() => {
    if (reduced) {
      setT(plan.t.headline + 500);
      return;
    }
    run();
    return stop;
  }, [plan, reduced]);

  useImperativeHandle(ref, (): ReelStageHandle => ({
    play: () => {
      if (!reduced) run();
    },
    // No encoder on the device: the panel asks `canRecord()` first and never gets here.
    record: () => Promise.resolve(null),
  }));

  const nodes = frameAt(plan, t);

  return (
    <View
      testID={testID}
      accessibilityRole="image"
      accessibilityLabel={plan.headline.lines.join(" ")}
      style={{
        width,
        height,
        borderRadius: radius.lg,
        overflow: "hidden",
        backgroundColor: colors.bg,
        borderWidth: 1,
        borderColor: colors.borderHi,
      }}
    >
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: (width - STAGE.w) / 2,
          top: (height - STAGE.h) / 2,
          width: STAGE.w,
          height: STAGE.h,
          transform: [{ scale }],
        }}
      >
        {nodes.map((node, i) => (
          <Node key={i} node={node} index={i} />
        ))}
      </View>
    </View>
  );
});
