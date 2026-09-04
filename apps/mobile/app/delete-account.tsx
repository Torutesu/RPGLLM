import React, { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { DELETION_GRACE_DAYS, T, colors, font, radius, spacing } from "@rpgllm/shared";
import { useActions, useT } from "../src/state/store";
import { Button, Field, HeaderBar, Screen } from "../src/components/ui";

const CONFIRM_WORD = "DELETE";
/** Long enough for the user (and the E2E case) to read `deleteDone` before SCR-002 takes over. */
const SIGN_OUT_DELAY_MS = 2000;

/** SCR-033 → account deletion (App Store Guideline 5.1.1(v)). */
export default function DeleteAccountScreen() {
  const { deleteAccount, signOut } = useActions();
  const { t } = useT();

  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/settings");
  };

  const onConfirm = async () => {
    setError(null);
    setBusy(true);
    const res = await deleteAccount();
    setBusy(false);
    if (!res.ok) {
      setError(t("loadFailed"));
      return;
    }
    // Show the confirmation, then drop the (now dead) session and return to SCR-002.
    setDone(true);
  };

  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => {
      void (async () => {
        await signOut();
        router.replace("/auth");
      })();
    }, SIGN_OUT_DELAY_MS);
    return () => clearTimeout(id);
  }, [done, signOut]);

  return (
    <Screen>
      <HeaderBar title={t("deleteAccount")} onBack={back} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
        {done ? (
          <Text testID={T.deleteDone} style={{ color: colors.positive, fontSize: font.md, fontWeight: "700" }}>
            {t("deleteDone")}
          </Text>
        ) : (
          <>
            <View
              style={{
                borderWidth: 1,
                borderColor: colors.danger,
                borderRadius: radius.md,
                padding: spacing.lg,
                gap: spacing.sm,
              }}
            >
              <Text style={{ color: colors.danger, fontSize: font.md, fontWeight: "700" }}>{t("deleteAccount")}</Text>
              <Text style={{ color: colors.text, fontSize: font.sm }}>{t("deleteWarning")}</Text>
              <Text style={{ color: colors.textMuted, fontSize: font.xs }}>{`${DELETION_GRACE_DAYS}d`}</Text>
            </View>

            <Field
              testID={T.deleteConfirmInput}
              label={t("deleteTypeToConfirm")}
              value={typed}
              onChangeText={setTyped}
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabel={t("deleteTypeToConfirm")}
              placeholder={CONFIRM_WORD}
            />

            <Button
              testID={T.deleteConfirm}
              label={t("deleteConfirm")}
              onPress={() => void onConfirm()}
              disabled={typed.trim().toUpperCase() !== CONFIRM_WORD}
              loading={busy}
            />
            <Button label={t("cancel2")} variant="ghost" onPress={back} />
            {error ? <Text style={{ color: colors.danger, fontSize: font.sm }}>{error}</Text> : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
