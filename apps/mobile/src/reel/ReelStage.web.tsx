import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { View } from "react-native";
import { colors, radius } from "@rpgllm/shared";
import { useReduceMotion } from "../ui";
import { canRecord, pickMime } from "./capabilities.web";
import { ensureFaces, paintFrame } from "./paint.web";
import { frameAt } from "./frame";
import { planReel, QUALITY_FULL, STAGE, type SceneLabels } from "./scene";
import type { MomentReel } from "../api/client";
import type { ReelFile, ReelStageHandle } from "./types";

/**
 * The stage, on the web: one `<canvas>` that is both the preview and the thing being recorded.
 *
 * The alternative — animating React views and recording them — cannot work: there is no API that
 * turns a DOM subtree into a `MediaStream`. `getDisplayMedia` asks the player to pick a window and
 * records their whole screen, which is not a product. So the composition is drawn, at 1080×1920,
 * into a canvas whose backing store *is* the video frame; the element is then scaled down by CSS to
 * whatever room the screen has. The player watches the master, not a proxy of it.
 */

const FPS = 30;
/** ~9 s of 1080×1920 vertical video; high enough that a re-encode by TikTok has something to eat. */
const BITRATE = 7_000_000;

export interface ReelStageProps {
  reel: MomentReel;
  labels: SceneLabels;
  /** display width in CSS pixels; the canvas is always 1080×1920 behind it */
  width: number;
  testID?: string;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const ReelStage = forwardRef<ReelStageHandle, ReelStageProps>(function ReelStage(
  { reel, labels, width, testID },
  ref,
) {
  const host = useRef<View>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const loop = useRef<number | null>(null);
  const reduced = useReduceMotion();
  const plan = useMemo(() => planReel(reel, labels, QUALITY_FULL), [reel, labels]);
  const planRef = useRef(plan);
  planRef.current = plan;

  const height = Math.round((width * STAGE.h) / STAGE.w);

  const draw = (t: number): void => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    paintFrame(ctx, frameAt(planRef.current, t));
  };

  const cancel = (): void => {
    if (loop.current !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(loop.current);
    loop.current = null;
  };

  /** One pass over the timeline, on the wall clock, resolving on the last frame. */
  const run = (onTick?: (p: number) => void): Promise<void> =>
    new Promise((resolve) => {
      cancel();
      const duration = planRef.current.durationMs;
      const started = typeof performance !== "undefined" ? performance.now() : Date.now();
      const step = (): void => {
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        const t = now - started;
        draw(Math.min(t, duration));
        onTick?.(Math.min(1, t / duration));
        if (t >= duration) {
          loop.current = null;
          resolve();
          return;
        }
        loop.current = requestAnimationFrame(step);
      };
      loop.current = requestAnimationFrame(step);
    });

  useEffect(() => {
    const node = host.current as unknown as HTMLElement | null;
    if (!node) return;
    const canvas = document.createElement("canvas");
    canvas.width = STAGE.w;
    canvas.height = STAGE.h;
    canvas.setAttribute("role", "img");
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    node.appendChild(canvas);
    canvasRef.current = canvas;
    ctxRef.current = canvas.getContext("2d");
    return () => {
      cancel();
      node.removeChild(canvas);
      canvasRef.current = null;
      ctxRef.current = null;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void ensureFaces().then(() => {
      if (!alive) return;
      // A reel that has to be asked to move is a screenshot. It plays itself once, unless the
      // player has asked the system for less motion — then it holds the frame the headline lands on.
      if (reduced) draw(planRef.current.t.headline + 500);
      else void run();
    });
    return () => {
      alive = false;
      cancel();
    };
  }, [plan, reduced]);

  useImperativeHandle(ref, (): ReelStageHandle => ({
    play: () => {
      void run();
    },
    record: async (onProgress: (p: number) => void): Promise<ReelFile | null> => {
      const canvas = canvasRef.current;
      const picked = pickMime();
      if (!canvas || !picked || !canRecord()) return null;
      await ensureFaces();
      cancel();
      draw(0);

      let stream: MediaStream;
      let recorder: MediaRecorder;
      try {
        stream = canvas.captureStream(FPS);
        recorder = new MediaRecorder(stream, { mimeType: picked.mime, videoBitsPerSecond: BITRATE });
      } catch {
        return null;
      }

      const chunks: Blob[] = [];
      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      // an encoder that dies mid-render must resolve, not hang: the caller shows a size of 0 and
      // falls back to the card rather than leaving "Recording…" on screen for ever
      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => {
          resolve();
        };
        recorder.onerror = () => {
          resolve();
        };
      });

      onProgress(0);
      recorder.start(200);
      // a beat of lead-in so the encoder's first key frame is the first frame of the reel
      await wait(120);
      await run(onProgress);
      // and a beat of tail so the last frame is in the file rather than in the queue
      await wait(320);
      try {
        recorder.stop();
      } catch {
        /* already stopped */
      }
      await stopped;
      for (const track of stream.getTracks()) track.stop();

      const blob = new Blob(chunks, { type: picked.mime });
      if (blob.size === 0) return null;
      onProgress(1);
      return {
        url: URL.createObjectURL(blob),
        name: `status-${planRef.current.reel.slug}.${picked.ext}`,
        mime: picked.mime,
        bytes: blob.size,
      };
    },
  }));

  return (
    <View
      testID={testID}
      ref={host}
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
    />
  );
});
