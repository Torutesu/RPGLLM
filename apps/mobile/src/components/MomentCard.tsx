import React, { useState } from "react";
import { Pressable, Share, Text, View } from "react-native";
import { T, colors, font, radius, spacing } from "@rpgllm/shared";
import type { Moment } from "../api/client";
import { IS_WEB } from "../env";
import { useT } from "../state/store";
import { Avatar } from "./Avatar";

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
  return `/moment/${slug}`;
}

function DeltaRow({ label, value }: { label: string; value: number }) {
  const tone = value > 0 ? colors.positive : value < 0 ? colors.negative : colors.textMuted;
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      <Text style={{ color: colors.textMuted, fontSize: font.sm }}>{label}</Text>
      <Text style={{ color: tone, fontSize: font.lg, fontWeight: "800" }}>{signed(value)}</Text>
    </View>
  );
}

export function MomentCard({ moment, onClose }: MomentCardProps) {
  const { t } = useT();
  const [note, setNote] = useState<string | null>(null);
  const payload = moment.payload;
  const deltas = readDeltas(payload, "deltas");
  const after = readDeltas(payload, "after");
  const reactions = readReactions(payload).slice(0, 3);
  const persona = readPersona(payload);
  const url = shareUrlFor(moment.shareSlug);

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
      style={{
        width: "100%",
        maxWidth: 360,
        aspectRatio: 9 / 16,
        alignSelf: "center",
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.lg,
        padding: spacing.xl,
        justifyContent: "space-between",
        gap: spacing.md,
      }}
    >
      <View style={{ gap: spacing.sm }}>
        <Text style={{ color: colors.accent, fontSize: font.xs, fontWeight: "800", letterSpacing: 1 }}>
          {t("shareMoment").toUpperCase()}
        </Text>
        <Text style={{ color: colors.text, fontSize: font.xl, fontWeight: "800" }} numberOfLines={4}>
          {moment.headline}
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: font.sm }} numberOfLines={4}>
          {moment.body}
        </Text>
      </View>

      <View style={{ gap: spacing.sm }}>
        <DeltaRow label={t("followers")} value={deltas.followers} />
        <DeltaRow label={t("aura")} value={deltas.aura} />
        <DeltaRow label={t("humor")} value={deltas.humor} />
      </View>

      <View style={{ gap: spacing.sm }}>
        {reactions.map((r, i) => (
          <View key={`${r.handle}-${i}`} style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }}>
            <Avatar handle={r.handle} size={22} />
            <Text style={{ color: colors.text, fontSize: font.xs, flex: 1 }} numberOfLines={2}>
              {`@${r.handle} ${r.text}`}
            </Text>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Avatar handle={persona.handle} size={28} />
        <Text style={{ color: colors.textMuted, fontSize: font.xs, flex: 1 }} numberOfLines={1}>
          {`@${persona.handle} · ${t("level")} ${persona.level} · ${after.followers} ${t("followers")}`}
        </Text>
      </View>

      {note ? <Text style={{ color: colors.positive, fontSize: font.xs }}>{note}</Text> : null}

      <View style={{ flexDirection: "row", gap: spacing.md }}>
        <Pressable
          testID={T.momentShare}
          accessibilityRole="button"
          accessibilityLabel={t("share")}
          onPress={() => void onShare()}
          style={{
            flex: 1,
            backgroundColor: colors.accent,
            borderRadius: radius.pill,
            paddingVertical: spacing.md,
            alignItems: "center",
          }}
        >
          <Text style={{ color: colors.bg, fontSize: font.sm, fontWeight: "700" }}>{t("share")}</Text>
        </Pressable>
        {onClose ? (
          <Pressable
            testID={T.momentClose}
            accessibilityRole="button"
            accessibilityLabel={t("close")}
            onPress={onClose}
            style={{
              paddingVertical: spacing.md,
              paddingHorizontal: spacing.lg,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text style={{ color: colors.text, fontSize: font.sm, fontWeight: "700" }}>{t("close")}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
