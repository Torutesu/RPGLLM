import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { PLANS, T, colors, font, radius, spacing, tList, type PlanId } from "@rpgllm/shared";
import { api } from "../src/api/client";
import { useActions, useAppState, useT } from "../src/state/store";
import { Button, Screen } from "../src/components/ui";
import { SkeletonList } from "../src/components/Skeleton";
import type { Offerings } from "../src/api/types";

const PERIOD_KEY: Record<string, "weekly" | "monthly" | "yearly"> = { week: "weekly", month: "monthly", year: "yearly" };

/** SCR-030 — soft paywall (modal). */
export default function Paywall() {
  const { locale } = useAppState();
  const { purchase } = useActions();
  const { t } = useT();

  const [offerings, setOfferings] = useState<Offerings | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [selected, setSelected] = useState<PlanId | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .offerings()
      .then((o) => {
        setOfferings(o);
        setStatus("ready");
        const highlighted = o.plans.find((p) => p.highlighted) ?? o.plans[0];
        if (highlighted) setSelected(highlighted.id);
      })
      .catch(() => setStatus("error"));
  }, []);

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/feed");
  };

  const onContinue = async () => {
    if (!selected) return;
    setError(null);
    setBusy(true);
    const res = await purchase(selected);
    setBusy(false);
    if (!res.ok) {
      setError(t("notSent"));
      return;
    }
    setSuccess(true);
    setTimeout(close, 1500);
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <View
          testID={T.paywall}
          style={{
            backgroundColor: colors.card,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: colors.border,
            padding: spacing.lg,
            gap: spacing.lg,
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ color: colors.text, fontSize: font.xl, fontWeight: "800" }}>{t("plusTitle")}</Text>
            <Pressable testID={T.paywallClose} accessibilityRole="button" onPress={close}>
              <Text style={{ color: colors.textMuted, fontSize: font.lg }}>×</Text>
            </Pressable>
          </View>

          {success ? (
            <View
              testID={T.paywallSuccess}
              style={{ paddingVertical: spacing.xl, alignItems: "center", gap: spacing.sm }}
            >
              <Text style={{ color: colors.positive, fontSize: font.lg, fontWeight: "800" }}>{t("welcomePlus")}</Text>
            </View>
          ) : (
            <>
              <View style={{ gap: spacing.xs }}>
                {tList(locale, "plusFeatures").map((f) => (
                  <Text key={f} style={{ color: colors.text, fontSize: font.sm }}>{`✓ ${f}`}</Text>
                ))}
              </View>

              {status === "loading" ? <SkeletonList count={3} /> : null}
              {status === "error" ? <Text style={{ color: colors.textMuted, fontSize: font.sm }}>{t("notSent")}</Text> : null}

              <View style={{ gap: spacing.md }}>
                {(offerings?.plans ?? []).map((p) => {
                  const active = selected === p.id;
                  const periodKey = PERIOD_KEY[p.period] ?? "monthly";
                  const adFree = PLANS[p.id]?.energyDaily === PLANS.adfree_monthly.energyDaily && p.id === "adfree_monthly";
                  return (
                    <Pressable
                      key={p.id}
                      testID={T.plan(p.id)}
                      accessibilityRole="button"
                      onPress={() => setSelected(p.id)}
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                        borderWidth: 2,
                        borderColor: active ? colors.accent : colors.border,
                        borderRadius: radius.md,
                        padding: spacing.lg,
                        backgroundColor: colors.bgElevated,
                      }}
                    >
                      <Text style={{ color: colors.text, fontSize: font.md, fontWeight: "700" }}>
                        {adFree ? t("adFreeOnly") : t(periodKey)}
                      </Text>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={{ color: colors.text, fontSize: font.md }}>{`$${p.usd.toFixed(2)}`}</Text>
                        {p.highlighted ? (
                          <Text style={{ color: colors.accent, fontSize: font.xs }}>{t("mostPopular")}</Text>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>

              {error ? <Text style={{ color: colors.danger, fontSize: font.sm }}>{error}</Text> : null}

              <Button
                testID={T.paywallContinue}
                label={t("continue")}
                onPress={() => void onContinue()}
                disabled={!selected || busy}
                loading={busy}
              />
              <Pressable accessibilityRole="button" onPress={() => undefined} style={{ alignSelf: "center" }}>
                <Text style={{ color: colors.textMuted, fontSize: font.xs }}>{t("restore")}</Text>
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
