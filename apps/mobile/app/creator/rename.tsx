import React, { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { T, colors, font, layout, radius, spacing } from "@rpgllm/shared";
import { api, ApiError } from "../../src/api/client";
import { Button, HeaderBar, Screen } from "../../src/components/ui";
import { Aurora } from "../../src/components/Brand";
import { useActions, useAppState, useT } from "../../src/state/store";
import { Gradient, Icon, typo } from "../../src/ui";

/**
 * Circuit ② — naming yourself.
 *
 * An account is minted with a placeholder (`quietheron42`), and this is the way out of it. It is
 * deliberately not a settings row with a text box: this is the name every world this person makes
 * will be credited under, and the screen is built to feel like *choosing a name* rather than
 * editing a field — the handle is the largest thing on the page, and underneath it the credit line
 * that will appear on their worlds updates as they type, so the decision is shown in the place it
 * will actually be read.
 *
 * The field is guided rather than policed: input is lower-cased and characters outside
 * `[a-z0-9_]` are dropped as they are typed, so the only rule left to break is the length — one
 * rule, stated once, in `creatorRenameHint`.
 */

const MIN = 3;
const MAX = 15;
const VALID = /^[a-z0-9_]{3,15}$/;

/** What the server will accept, from whatever was typed. */
const normalize = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, MAX);

export default function CreatorRename() {
  const { me } = useAppState();
  const { refreshMe } = useActions();
  const { t } = useT();

  const current = me?.user.creatorHandle ?? "";
  const [handle, setHandle] = useState(current);
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const seeded = useRef(false);

  // `/v1/me` may land after this screen mounts; seed the field once, and never over the top of
  // something the player has already typed.
  useEffect(() => {
    if (seeded.current || !current) return;
    seeded.current = true;
    setHandle((h) => (h === "" ? current : h));
  }, [current]);

  const valid = VALID.test(handle);
  const unchanged = handle === current;
  const tooShort = handle.length > 0 && handle.length < MIN;

  const onSave = async () => {
    if (!valid || busy || unchanged) return;
    setError(null);
    setBusy(true);
    try {
      await api.setCreatorHandle(handle);
      setSaved(true);
      // The confirmation is the beat the refresh takes: every surface that credits this account
      // reads `me.user.creatorHandle`, so nothing is correct until this returns.
      await refreshMe();
      router.back();
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      setSaved(false);
      setError(
        err?.code === "HANDLE_TAKEN" || err?.status === 409
          ? t("creatorRenameTaken")
          : err?.code === "VALIDATION" || err?.status === 422
            ? t("creatorRenameHint")
            : err?.code === "RATE_LIMITED"
              ? t("rateLimited")
              : t("loadFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  /** The credit exactly as a card will print it, so the choice is seen where it will be read. */
  const preview = useMemo(() => `${t("studioBy")} @${handle || current || "…"}`, [t, handle, current]);

  return (
    <Screen wash={false}>
      <Aurora seed={`rename-${current}`} intensity={0.8} />
      <HeaderBar
        title={t("handle")}
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/settings"))}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.xl }}
      >
        <View style={{ width: "100%", maxWidth: layout.maxContentWidth, alignSelf: "center", gap: spacing.xl }}>
          <Text accessibilityRole="header" style={[typo.title, { color: colors.text }]}>
            {t("creatorRename")}
          </Text>

          {/* ------------------------------------------------------------- the name itself ---- */}
          <View
            style={{
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: focused ? colors.accent : error ? colors.danger : colors.border,
              backgroundColor: colors.card,
              overflow: "hidden",
            }}
          >
            <Gradient
              colors={[`${colors.accent}1A`, "rgba(124,92,255,0)"]}
              angle={160}
              pointerEvents="none"
              style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
            />
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.lg,
              }}
            >
              <Text importantForAccessibility="no" style={[typo.title, { color: colors.textMuted }]}>
                @
              </Text>
              <TextInput
                testID={T.creatorRenameInput}
                accessibilityLabel={t("creatorRename")}
                value={handle}
                onChangeText={(v) => {
                  setError(null);
                  setHandle(normalize(v));
                }}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={MAX}
                style={{
                  flex: 1,
                  // Without an explicit floor a flex child on web is at least its content width,
                  // which pushed the counter clean off the row as the name got longer.
                  minWidth: 0,
                  color: colors.text,
                  fontSize: font.xxl,
                  fontWeight: "700",
                  paddingVertical: 0,
                  paddingLeft: spacing.xxs,
                }}
              />
              <Text
                accessibilityRole="text"
                accessibilityLabel={`${handle.length} / ${MAX}`}
                style={[
                  typo.count,
                  { color: valid ? colors.positive : colors.textMuted, flexShrink: 0, paddingLeft: spacing.sm },
                ]}
              >
                {`${handle.length}/${MAX}`}
              </Text>
            </View>
          </View>

          {/* ------------------------------------------- the credit, where it will be read ---- */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
              padding: spacing.md,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.bgElevated,
            }}
          >
            <Icon name="sparkle" size={14} color={colors.accentHi} filled />
            <Text numberOfLines={1} style={[typo.meta, { color: colors.textDim, flex: 1 }]}>
              {preview}
            </Text>
          </View>

          {error ? (
            <Text
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              style={[typo.meta, { color: colors.danger }]}
            >
              {error}
            </Text>
          ) : (
            <Text style={[typo.caption, { color: tooShort ? colors.danger : colors.textMuted }]}>
              {t("creatorRenameHint")}
            </Text>
          )}

          {saved ? (
            <Text accessibilityLiveRegion="polite" style={[typo.meta, { color: colors.positive }]}>
              {t("creatorRenameSaved")}
            </Text>
          ) : null}

          <Button
            testID={T.creatorRenameSave}
            label={t("save")}
            icon="check"
            onPress={() => void onSave()}
            loading={busy}
            disabled={!valid || busy || unchanged}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}
