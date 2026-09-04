import React, { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { T, colors, identityFor, layout, spacing } from "@rpgllm/shared";
import { api } from "../../src/api/client";
import { useActions, useAppState, useT } from "../../src/state/store";
import { Button, Field, Screen } from "../../src/components/ui";
import { Aurora, SoftOrb, StepDots } from "../../src/components/Brand";
import { Avatar, Icon, typo } from "../../src/ui";

const HANDLE_RE = /^[a-z0-9_]{3,15}$/;
const MAX_W = 520;

/** SCR-005 — build your own. The portrait and its identity colour follow the handle as you type. */
export default function PersonaEditor() {
  const { draft, world } = useAppState();
  const { patchDraft, setDraft } = useActions();
  const { t } = useT();

  const [handle, setHandle] = useState(draft?.handle ?? "");
  const [displayName, setDisplayName] = useState(draft?.displayName ?? "");
  const [bio, setBio] = useState(draft?.bio ?? "");
  const [voiceNotes, setVoiceNotes] = useState(draft?.voiceNotes ?? "");
  const [available, setAvailable] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);

  const shaped = HANDLE_RE.test(handle);
  const valid = shaped && displayName.trim().length > 0 && available !== false;
  const identity = identityFor(handle || "you");

  useEffect(() => {
    const worldId = draft?.worldId;
    if (!worldId || !shaped) {
      setAvailable(null);
      setChecking(false);
      return;
    }
    let cancelled = false;
    setChecking(true);
    const id = setTimeout(() => {
      void api
        .checkHandle(worldId, handle)
        .then((r) => {
          if (!cancelled) setAvailable(r.available);
        })
        .catch(() => {
          if (!cancelled) setAvailable(null);
        })
        .finally(() => {
          if (!cancelled) setChecking(false);
        });
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [draft?.worldId, handle, shaped]);

  const onSave = () => {
    if (!draft || !valid) return;
    setDraft({ ...draft, handle, displayName, bio, voiceNotes });
    router.push("/onboarding/first-follower");
  };

  const status =
    !shaped || checking
      ? null
      : available === true
        ? { text: t("handleAvailable"), tone: colors.positive, icon: "check" as const }
        : available === false
          ? { text: t("handleTaken"), tone: colors.danger, icon: "close" as const }
          : null;

  return (
    <Screen>
      <Aurora seed={handle || world?.world.slug || "persona-edit"} intensity={0.45} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.xxl, paddingBottom: spacing.xxxl, gap: spacing.xl }}>
        <View style={{ width: "100%", maxWidth: MAX_W, alignSelf: "center", gap: spacing.xl }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View />
            <StepDots step={1} />
          </View>

          <View style={{ alignItems: "center", gap: spacing.md }}>
            <View style={{ width: 140, height: 140, alignItems: "center", justifyContent: "center" }}>
              <View style={{ position: "absolute", opacity: 0.85 }}>
                <SoftOrb from={identity.from} to={identity.to} size={140} />
              </View>
              <Avatar handle={handle || "you"} size={layout.avatarXl} label={`@${handle || "you"}`} />
            </View>
            <Text accessibilityRole="header" numberOfLines={1} style={[typo.h1, { color: colors.text }]}>
              {displayName.trim() || t("createOwn")}
            </Text>
          </View>

          <View style={{ gap: spacing.lg }}>
            <View style={{ gap: spacing.xs }}>
              <Field
                testID={T.personaHandleInput}
                label={t("handle")}
                value={handle}
                onChangeText={(v: string) => {
                  const next = v.toLowerCase().replace(/[^a-z0-9_]/g, "");
                  setHandle(next);
                  patchDraft({ handle: next });
                }}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={15}
                placeholder="yourname"
              />
              {/* fixed-height status row, so the form never jumps while the check is in flight */}
              <View style={{ height: 18, justifyContent: "center" }}>
                {status ? (
                  <View
                    style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}
                    accessibilityLiveRegion="polite"
                    accessibilityLabel={status.text}
                  >
                    <Icon name={status.icon} size={12} color={status.tone} />
                    <Text importantForAccessibility="no" style={[typo.caption, { color: status.tone }]}>
                      {status.text}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>

            <Field
              testID={T.personaNameInput}
              label={t("displayName")}
              value={displayName}
              onChangeText={(v: string) => {
                setDisplayName(v);
                patchDraft({ displayName: v });
              }}
              maxLength={40}
            />
            <Field
              testID={T.personaBioInput}
              label={t("bio")}
              value={bio}
              onChangeText={(v: string) => {
                setBio(v);
                patchDraft({ bio: v });
              }}
              maxLength={160}
              multiline
              hint={`${bio.length}/160`}
              style={{ minHeight: 84, textAlignVertical: "top" }}
            />
            <Field
              label={t("voiceNotes")}
              value={voiceNotes}
              onChangeText={(v: string) => {
                setVoiceNotes(v);
                patchDraft({ voiceNotes: v });
              }}
              maxLength={200}
              multiline
              hint={`${voiceNotes.length}/200`}
              style={{ minHeight: 84, textAlignVertical: "top" }}
            />
          </View>

          <Button testID={T.personaSave} label={t("save")} onPress={onSave} disabled={!valid} />
        </View>
      </ScrollView>
    </Screen>
  );
}
