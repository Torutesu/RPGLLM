import React, { useState } from "react";
import { Share, Text, View } from "react-native";
import { T, colors, compactNumber, elevation, gradients, layout, radius, spacing } from "@rpgllm/shared";
import type { Moment } from "../api/client";
import { IS_WEB, APP_ORIGIN } from "../env";
import { useT } from "../state/store";
import { Avatar } from "./Avatar";
import { Button, Wordmark } from "./ui";
import { Gradient, Icon, typo } from "../ui";

/**
 * SCR-040 — the Shareable Moment card (S2-4 / AIF-005).
 *
 * A 9:16 card drawn entirely from design tokens: no external image, no font, nothing to load —
 * so it renders identically in a screenshot, in the app, and on a shared link opened by someone
 * who has never installed the app.
 */
export interface MomentCardProps {
  moment: Moment;
  /** hides the close button for the standalone share page */
  onClose?: () => void;
}

interface Deltas { followers: number; aura: number; humor: number }
interface Reaction { handle: string; displayName: string; text: string }
interface PersonaBadge { handle: string; displayName: string; level: number }

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function readDeltas(payload: Record<string, unknown>, key: string): Deltas {
  const raw = payload[key];
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { followers: num(o["followers"]), aura: num(o["aura"]), humor: num(o["humor"]) };
}

function readReactions(payload: Record<string, unknown>): Reaction[] {
  const raw = payload["reactions"];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): Reaction[] => {
    if (!entry || typeof entry !== "object") return [];
    const o = entry as Record<string, unknown>;
    const text = str(o["text"]);
    return text.length > 0 ? [{ handle: str(o["handle"]), displayName: str(o["displayName"]), text }] : [];
  });
}

function readPersona(payload: Record<string, unknown>): PersonaBadge {
  const raw = payload["persona"];
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { handle: str(o["handle"]), displayName: str(o["displayName"]), level: num(o["level"]) };
}

const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));

export function shareUrlFor(slug: string): string {
  if (IS_WEB && typeof window !== "undefined" && window.location) return `${window.location.origin}/moment/${slug}`;
  // Agent P: a bare path is not shareable off the device. `EXPO_PUBLIC_APP_URL` (mirrors the API's
  // PUBLIC_APP_URL) is what makes a shared moment openable by the person who receives it.
  if (APP_ORIGIN) return `${APP_ORIGIN}/moment/${slug}`;
  return `/moment/${slug}`;
}

function DeltaTile({ label, value }: { label: string; value: number }) {
  const tone = value > 0 ? colors.positive : value < 0 ? colors.negative : colors.textMuted;
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`${label} ${signed(value)}`}
      style={{
        flex: 1,
        gap: 2,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.md,
        borderRadius: radius.md,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Text importantForAccessibility="no" style={[typo.micro, { color: colors.textMuted }]}>
        {label.toUpperCase()}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xxs }}>
        <Icon name={value > 0 ? "arrowUp" : value < 0 ? "arrowDown" : "minus"} size={13} color={tone} />
        <Text importantForAccessibility="no" style={[typo.number, { color: tone }]}>
          {value > 0 ? `+${compactNumber(value)}` : compactNumber(value)}
        </Text>
      </View>
    </View>
  );
}

/**
 * SCR-040 — the card people screenshot. It has to survive being cropped and reposted, so the
 * hierarchy is: brand, headline, the numbers that changed, who reacted, who you are.
 */
export function MomentCard({ moment, onClose }: MomentCardProps) {
  const { t } = useT();
  const [note, setNote] = useState<string | null>(null);
  const payload = moment.payload;
  const deltas = readDeltas(payload, "deltas");
  const after = readDeltas(payload, "after");
  const reactions = readReactions(payload).slice(0, 3);
  const persona = readPersona(payload);
  const url = shareUrlFor(moment.shareSlug);
  const winning = deltas.followers + deltas.aura >= 0;

  const onShare = async () => {
    const message = `${moment.headline}\n${url}`;
    try {
      if (IS_WEB) {
        const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { share?: (d: { title: string; text: string; url: string }) => Promise<void> }) : undefined;
        if (nav?.share) {
          await nav.share({ title: moment.headline, text: moment.headline, url });
          return;
        }
        await nav?.clipboard?.writeText(message);
        setNote(t("copied"));
        return;
      }
      await Share.share({ message });
    } catch {
      setNote(t("copied"));
    }
  };

  return (
    <View
      testID={T.momentCard}
      accessibilityRole="summary"
      accessibilityLabel={`${t("shareMoment")}: ${moment.headline}`}
      style={[
        {
          width: "100%",
          maxWidth: 380,
          aspectRatio: 9 / 16,
          alignSelf: "center",
          backgroundColor: colors.bgElevated,
          borderWidth: 1,
          borderColor: colors.borderHi,
          borderRadius: radius.xl,
          overflow: "hidden",
        },
        elevation.high,
      ]}
    >
      <Gradient
        colors={winning ? ["rgba(61,224,138,0.20)", "rgba(124,92,255,0.14)", "rgba(7,7,12,0)"] : ["rgba(255,77,94,0.22)", "rgba(124,92,255,0.12)", "rgba(7,7,12,0)"]}
        angle={155}
        pointerEvents="none"
        style={{ position: "absolute", left: 0, right: 0, top: 0, height: 380 }}
      />
      <Gradient colors={winning ? [...gradients.win] : [...gradients.lose]} angle={90} pointerEvents="none" style={{ height: 4 }} />

      <View style={{ flex: 1, padding: spacing.xl, justifyContent: "space-between", gap: spacing.md }}>
        <View style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Wordmark size={22} />
            <Text style={[typo.micro, { color: colors.textMuted }]}>{t("shareMoment").toUpperCase()}</Text>
          </View>
          <Text style={[typo.title, { color: colors.text, marginTop: spacing.sm }]} numberOfLines={4}>
            {moment.headline}
          </Text>
          <Text style={[typo.meta, { color: colors.textDim }]} numberOfLines={4}>
            {moment.body}
          </Text>
        </View>

        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <DeltaTile label={t("followers")} value={deltas.followers} />
          <DeltaTile label={t("aura")} value={deltas.aura} />
          <DeltaTile label={t("humor")} value={deltas.humor} />
        </View>

        <View style={{ gap: spacing.sm }}>
          {reactions.map((r, i) => (
            <View key={`${r.handle}-${i}`} style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
              <Avatar handle={r.handle} size={layout.avatarXs} />
              <Text style={[typo.caption, { color: colors.textDim, flex: 1 }]} numberOfLines={2}>
                {`“${r.text}”`}
              </Text>
            </View>
          ))}
        </View>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            paddingTop: spacing.md,
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }}
        >
          <Avatar handle={persona.handle} size={layout.avatarSm} ring />
          <View style={{ flex: 1 }}>
            <Text style={[typo.metaStrong, { color: colors.text }]} numberOfLines={1}>
              {`@${persona.handle}`}
            </Text>
            <Text style={[typo.caption, { color: colors.textMuted }]} numberOfLines={1}>
              {`${t("level")} ${persona.level} · ${compactNumber(after.followers)} ${t("followers")}`}
            </Text>
          </View>
        </View>

        {note ? <Text style={[typo.caption, { color: colors.positive }]}>{note}</Text> : null}

        <View style={{ flexDirection: "row", gap: spacing.md }}>
          <Button testID={T.momentShare} label={t("share")} onPress={() => void onShare()} icon="share" style={{ flex: 1 }} />
          {onClose ? <Button testID={T.momentClose} label={t("close")} onPress={onClose} variant="ghost" /> : null}
        </View>
      </View>
    </View>
  );
}
