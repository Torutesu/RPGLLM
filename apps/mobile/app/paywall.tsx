import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { PLANS, T, colors, font, radius, spacing, tList, type PlanId } from "@rpgllm/shared";
import { api } from "../src/api/client";
import { getBilling, type StoreOffering } from "../src/adapters/billing";
import { useActions, useAppState, useT } from "../src/state/store";
import { Button, Screen } from "../src/components/ui";
import { SkeletonList } from "../src/components/Skeleton";
import type { Offerings } from "../src/api/types";

const PERIOD_KEY: Record<string, "weekly" | "monthly" | "yearly"> = { week: "weekly", month: "monthly", year: "yearly" };

/** SCR-030 — soft paywall (modal). */
export default function Paywall() {
  const { locale } = useAppState();
  const { purchase, restorePurchases } = useActions();
  const { t } = useT();

  const [offerings, setOfferings] = useState<Offerings | null>(null);
  /** What the *store* says, when there is a store to ask (native + RevenueCat). Keyed by plan id. */
  const [store, setStore] = useState<Record<string, StoreOffering>>({});
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [selected, setSelected] = useState<PlanId | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void api
      .offerings()
      .then((o) => {
        if (!alive) return;
        setOfferings(o);
        setStatus("ready");
        const highlighted = o.plans.find((p) => p.highlighted) ?? o.plans[0];
        if (highlighted) setSelected(highlighted.id);
      })
      .catch(() => alive && setStatus("error"));

    /**
     * The store is the authority on price: `$14.99` from our catalogue is a guess, `¥2,300` from
     * the App Store is what the payment sheet will actually charge. Asked in parallel and merged
     * when it answers, so an unreachable store never delays or breaks the paywall.
     */
    void getBilling()
      .offerings()
      .then((list) => {
        if (!alive || !list) return;
        setStore(Object.fromEntries(list.map((o) => [o.planId, o])));
      })
      .catch(() => undefined);

    return () => {
      alive = false;
    };
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
    // Backing out of the store sheet is a decision, not a failure: no toast, no red text.
    if (!res.ok && res.cancelled) return;
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
            <Text accessibilityRole="header" style={{ color: colors.text, fontSize: font.xl, fontWeight: "800" }}>
              {t("plusTitle")}
            </Text>
            <Pressable testID={T.paywallClose} accessibilityRole="button" accessibilityLabel={t("close")} onPress={close}>
              <Text importantForAccessibility="no" style={{ color: colors.textMuted, fontSize: font.lg }}>
                ×
              </Text>
            </Pressable>
          </View>

          {success ? (
            <View
              testID={T.paywallSuccess}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              accessibilityLabel={t("welcomePlus")}
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
              {status === "error" ? (
                <Text
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                  style={{ color: colors.textMuted, fontSize: font.sm }}
                >
                  {t("notSent")}
                </Text>
              ) : null}

              <View accessibilityRole="radiogroup" accessibilityLabel={t("plusTitle")} style={{ gap: spacing.md }}>
                {(offerings?.plans ?? []).map((p) => {
                  const active = selected === p.id;
                  const periodKey = PERIOD_KEY[p.period] ?? "monthly";
                  const adFree = PLANS[p.id]?.energyDaily === PLANS.adfree_monthly.energyDaily && p.id === "adfree_monthly";
                  // Store price when the store gave us one, catalogue price otherwise.
                  const price = store[p.id]?.priceString ?? `$${p.usd.toFixed(2)}`;
                  // The store's own intro offer wins over the server-side experiment.
                  const trialDays = Math.max(store[p.id]?.trialDays ?? 0, offerings?.experiments.trialDays ?? 0);
                  return (
                    <Pressable
                      key={p.id}
                      testID={T.plan(p.id)}
                      // one-of-many choice: "radio" makes the selected state audible
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active, checked: active }}
                      accessibilityLabel={`${adFree ? t("adFreeOnly") : t(periodKey)} ${price}${trialDays > 0 ? ` ${trialDays} ${t("freePlan")}` : ""}${p.highlighted ? ` ${t("mostPopular")}` : ""}`}
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
                      <View style={{ gap: 2 }}>
                        <Text style={{ color: colors.text, fontSize: font.md, fontWeight: "700" }}>
                          {adFree ? t("adFreeOnly") : t(periodKey)}
                        </Text>
                        {trialDays > 0 ? (
                          // No i18n key for a free trial exists yet — `freePlan` is the closest
                          // localized word for "free" in both locales (see build-notes, Agent P).
                          <Text style={{ color: colors.positive, fontSize: font.xs }}>
                            {`${trialDays} · ${t("freePlan")}`}
                          </Text>
                        ) : null}
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={{ color: colors.text, fontSize: font.md }}>{price}</Text>
                        {p.highlighted ? (
                          <Text style={{ color: colors.accent, fontSize: font.xs }}>{t("mostPopular")}</Text>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>

              {error ? (
                <Text
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                  style={{ color: colors.danger, fontSize: font.sm }}
                >
                  {error}
                </Text>
              ) : null}

              <Button
                testID={T.paywallContinue}
                label={t("continue")}
                onPress={() => void onContinue()}
                disabled={!selected || busy}
                loading={busy}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("restore")}
                onPress={() => {
                  // Ask the store first (native), then let the server reconcile and report back.
                  void getBilling()
                    .restore()
                    .catch(() => undefined)
                    .then(() => restorePurchases())
                    .then((res) => {
                      if (!res.ok) setError(t("notSent"));
                      else if (res.plan) setSuccess(true);
                    })
                    .catch(() => setError(t("notSent")));
                }}
                style={{ alignSelf: "center" }}
              >
                <Text importantForAccessibility="no" style={{ color: colors.textMuted, fontSize: font.xs }}>
                  {t("restore")}
                </Text>
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
