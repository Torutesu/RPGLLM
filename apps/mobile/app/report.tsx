import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { REPORT_REASONS, T, colors, font, radius, spacing, type ReportReason, type StringKey } from "@rpgllm/shared";
import { useActions, useT } from "../src/state/store";
import { Button, Field, HeaderBar, Screen } from "../src/components/ui";
import type { ReportTarget } from "../src/api/client";

const REASON_KEY: Record<ReportReason, StringKey> = {
  harassment: "reportHarassment",
  sexual: "reportSexual",
  self_harm: "reportSelfHarm",
  hate: "reportHate",
  off_character: "reportOffCharacter",
  other: "reportOther",
};

const TARGETS: readonly ReportTarget[] = ["post", "dm_message", "character", "world"];

const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));

/** SCR-037 — report this content, with the block affordance for a character (Guideline 1.2). */
export default function ReportScreen() {
  const params = useLocalSearchParams<{ target?: string; targetId?: string; handle?: string }>();
  const { reportContent, blockByHandle } = useActions();
  const { t } = useT();

  const targetId = first(params.targetId);
  const rawTarget = first(params.target);
  const target: ReportTarget = useMemo(
    () => (TARGETS.includes(rawTarget as ReportTarget) ? (rawTarget as ReportTarget) : "post"),
    [rawTarget],
  );
  const handle = first(params.handle);

  const [reason, setReason] = useState<ReportReason>("harassment");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [blocked, setBlocked] = useState(false);

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/feed");
  };

  const onSubmit = async () => {
    if (!targetId) {
      setError(t("loadFailed"));
      return;
    }
    setError(null);
    setBusy(true);
    const res = await reportContent(target, targetId, reason, note);
    setBusy(false);
    if (!res.ok) {
      setError(t("loadFailed"));
      return;
    }
    setDone(true);
  };

  const onBlock = async () => {
    setError(null);
    setBusy(true);
    const res = await blockByHandle(handle);
    setBusy(false);
    if (!res.ok) {
      setError(t("loadFailed"));
      return;
    }
    setBlocked(true);
  };

  return (
    <Screen>
      <HeaderBar title={t("reportTitle")} onBack={close} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
        {done ? (
          <View style={{ gap: spacing.lg }}>
            <Text testID={T.reportDone} style={{ color: colors.positive, fontSize: font.md, fontWeight: "700" }}>
              {t("reportDone")}
            </Text>
            {handle && !blocked ? (
              <Text style={{ color: colors.textMuted, fontSize: font.sm }}>{t("blockWarning")}</Text>
            ) : null}
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {REPORT_REASONS.map((r) => {
              const selected = r === reason;
              return (
                <Pressable
                  key={r}
                  testID={T.reportReason(r)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={t(REASON_KEY[r])}
                  onPress={() => setReason(r)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.md,
                    padding: spacing.md,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: selected ? colors.accent : colors.border,
                    backgroundColor: selected ? colors.bgElevated : "transparent",
                  }}
                >
                  <Text style={{ color: selected ? colors.accent : colors.textMuted, fontSize: font.md }}>
                    {selected ? "◉" : "○"}
                  </Text>
                  <Text style={{ color: colors.text, fontSize: font.md }}>{t(REASON_KEY[r])}</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {done ? null : (
          <>
            <Field
              testID={T.reportNote}
              label={t("reportNote")}
              value={note}
              onChangeText={setNote}
              multiline
              numberOfLines={3}
              maxLength={500}
              accessibilityLabel={t("reportNote")}
            />
            <Button testID={T.reportSubmit} label={t("reportSubmit")} onPress={() => void onSubmit()} loading={busy} />
          </>
        )}

        {handle ? (
          <View style={{ gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.lg }}>
            {blocked ? (
              <Text style={{ color: colors.positive, fontSize: font.md, fontWeight: "700" }}>{`${t("blocked")} @${handle}`}</Text>
            ) : confirmBlock ? (
              <>
                <Text style={{ color: colors.text, fontSize: font.md, fontWeight: "700" }}>{t("blockTitle")}</Text>
                <Text style={{ color: colors.textMuted, fontSize: font.sm }}>{t("blockWarning")}</Text>
                <Button testID={T.blockConfirm} label={`${t("block")} @${handle}`} onPress={() => void onBlock()} loading={busy} />
              </>
            ) : (
              <Button
                testID={T.blockOpen}
                label={`${t("block")} @${handle}`}
                variant="ghost"
                onPress={() => setConfirmBlock(true)}
              />
            )}
          </View>
        ) : null}

        {error ? <Text style={{ color: colors.danger, fontSize: font.sm }}>{error}</Text> : null}
        <Button label={t("close")} variant="ghost" onPress={close} />
      </ScrollView>
    </Screen>
  );
}
