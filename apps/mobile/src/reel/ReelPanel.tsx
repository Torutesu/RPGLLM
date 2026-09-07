import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";
import { T, colors, radius, spacing } from "@rpgllm/shared";
import { useT } from "../state/store";
import { Button } from "../components/ui";
import { Gradient, typo } from "../ui";
import type { Moment, MomentReel } from "../api/client";
import { normalizeReel, reelFromMoment } from "./beats";
import { canRecord, releaseFile, saveFile } from "./capabilities";
import { ReelStage } from "./ReelStage";
import type { ReelFile, ReelStageHandle } from "./types";

/**
 * "Make it a video" — the moment, as something that moves and can be taken away.
 *
 * The panel is deliberately three states and no more: it plays, it records, it hands over a file.
 * Where it cannot record it says so in words and leaves the card's own share working, because a
 * button that silently does nothing is worse than one that is not there.
 */

const MAX_STAGE_W = 300;

function bytesLabel(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`;
}

export interface ReelPanelProps {
  moment: Moment;
  /** the server's cut when `GET /v1/moments/:slug/reel` answered; the card's own when it did not */
  reel: MomentReel | null;
}

export function ReelPanel({ moment, reel }: ReelPanelProps) {
  const { t } = useT();
  const stage = useRef<ReelStageHandle>(null);
  const [width, setWidth] = useState(MAX_STAGE_W);
  const [progress, setProgress] = useState<number | null>(null);
  const [file, setFile] = useState<ReelFile | null>(null);
  const supported = canRecord();

  const timeline = useMemo(() => normalizeReel(reel ?? reelFromMoment(moment)), [reel, moment]);
  const labels = useMemo(
    () => ({ followers: t("followers"), aura: t("aura"), humor: t("humor") }),
    [t],
  );

  // one object URL per recording, and never one left behind
  useEffect(() => () => {
    if (file) releaseFile(file);
  }, [file]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = Math.floor(e.nativeEvent.layout.width);
    if (w > 0) setWidth(Math.max(160, Math.min(MAX_STAGE_W, w)));
  }, []);

  const onRecord = useCallback(() => {
    if (progress !== null) return;
    setProgress(0);
    void (async () => {
      const made = await stage.current?.record((p) => setProgress(p));
      setProgress(null);
      if (!made) return;
      setFile((prev) => {
        if (prev) releaseFile(prev);
        return made;
      });
      // hand it over straight away; the button below is there for a second copy
      saveFile(made);
    })();
  }, [progress]);

  const recording = progress !== null;
  const pct = Math.round((progress ?? 0) * 100);

  return (
    <View
      testID={T.momentReel}
      style={{
        gap: spacing.md,
        padding: spacing.lg,
        borderRadius: radius.xl,
        backgroundColor: colors.bgElevated,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <View style={{ gap: spacing.xxs }}>
        <Text style={[typo.h2, { color: colors.text }]}>{t("reelTitle")}</Text>
        <Text style={[typo.caption, { color: colors.textMuted }]}>{t("reelHint")}</Text>
      </View>

      <View onLayout={onLayout} style={{ alignItems: "center" }}>
        <ReelStage ref={stage} reel={timeline} labels={labels} width={width} />
      </View>

      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Button
          testID={T.momentReelPlay}
          label={t("reelPlay")}
          icon="play"
          variant="ghost"
          onPress={() => stage.current?.play()}
          style={{ flex: 1 }}
        />
        {supported ? (
          <Button
            testID={T.momentReelRecord}
            label={t("reelRecord")}
            icon="download"
            onPress={onRecord}
            loading={recording}
            disabled={recording}
            style={{ flex: 1 }}
          />
        ) : null}
      </View>

      {recording ? (
        <View
          testID={T.momentReelProgress}
          accessibilityRole="progressbar"
          accessibilityLabel={t("reelRendering")}
          accessibilityValue={{ min: 0, max: 100, now: pct }}
          style={{ gap: spacing.xs }}
        >
          <View style={{ height: 6, borderRadius: radius.pill, backgroundColor: colors.card, overflow: "hidden" }}>
            <Gradient
              colors={[colors.accent, colors.hot]}
              angle={90}
              style={{ height: 6, width: `${Math.max(2, pct)}%`, borderRadius: radius.pill }}
            />
          </View>
          <Text style={[typo.caption, { color: colors.textDim }]}>{t("reelRendering")}</Text>
        </View>
      ) : null}

      {file ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={[typo.caption, { color: colors.positive }]}>
            {`${t("reelReady")} · ${bytesLabel(file.bytes)}`}
          </Text>
          <Button
            testID={T.momentReelDownload}
            label={file.name}
            icon="download"
            variant="ghost"
            onPress={() => saveFile(file)}
          />
        </View>
      ) : null}

      {supported ? null : (
        <Text testID={T.momentReelUnsupported} style={[typo.caption, { color: colors.textDim }]}>
          {t("reelUnsupported")}
        </Text>
      )}
    </View>
  );
}
