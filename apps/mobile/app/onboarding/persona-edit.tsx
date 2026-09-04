import React, { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { T, colors, font, spacing } from "@rpgllm/shared";
import { api } from "../../src/api/client";
import { useActions, useAppState, useT } from "../../src/state/store";
import { Button, Field, Screen } from "../../src/components/ui";
import { Avatar } from "../../src/components/Avatar";

const HANDLE_RE = /^[a-z0-9_]{3,15}$/;

/** SCR-005 — custom persona editor. */
export default function PersonaEditor() {
  const { draft } = useAppState();
  const { patchDraft, setDraft } = useActions();
  const { t } = useT();

  const [handle, setHandle] = useState(draft?.handle ?? "");
  const [displayName, setDisplayName] = useState(draft?.displayName ?? "");
  const [bio, setBio] = useState(draft?.bio ?? "");
  const [voiceNotes, setVoiceNotes] = useState(draft?.voiceNotes ?? "");
  const [available, setAvailable] = useState<boolean | null>(null);

  const valid = HANDLE_RE.test(handle) && displayName.trim().length > 0;

  useEffect(() => {
    const worldId = draft?.worldId;
    if (!worldId || !HANDLE_RE.test(handle)) {
      setAvailable(null);
      return;
    }
    let cancelled = false;
    const id = setTimeout(() => {
      void api
        .checkHandle(worldId, handle)
        .then((r) => {
          if (!cancelled) setAvailable(r.available);
        })
        .catch(() => {
          if (!cancelled) setAvailable(null);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [draft?.worldId, handle]);

  const onSave = () => {
    if (!draft) return;
    setDraft({ ...draft, handle, displayName, bio, voiceNotes });
    router.push("/onboarding/first-follower");
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
        <View style={{ alignItems: "center" }}>
          <Avatar handle={handle || "you"} size={72} label={`${t("handle")} @${handle}`} />
        </View>
        <Field
          testID={T.personaHandleInput}
          label={t("handle")}
          value={handle}
          onChangeText={(v) => {
            setHandle(v.toLowerCase());
            patchDraft({ handle: v.toLowerCase() });
          }}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={15}
          error={available === false ? t("handleTaken") : undefined}
        />
        {available === true ? (
          <Text
            accessibilityLiveRegion="polite"
            accessibilityLabel={t("handleAvailable")}
            style={{ color: colors.positive, fontSize: font.xs }}
          >
            ✓
          </Text>
        ) : null}
        <Field
          testID={T.personaNameInput}
          label={t("displayName")}
          value={displayName}
          onChangeText={(v) => {
            setDisplayName(v);
            patchDraft({ displayName: v });
          }}
          maxLength={40}
        />
        <Field
          testID={T.personaBioInput}
          label={t("bio")}
          value={bio}
          onChangeText={(v) => {
            setBio(v);
            patchDraft({ bio: v });
          }}
          maxLength={160}
          multiline
          hint={`${bio.length}/160`}
        />
        <Field
          label={t("voiceNotes")}
          value={voiceNotes}
          onChangeText={(v) => {
            setVoiceNotes(v);
            patchDraft({ voiceNotes: v });
          }}
          maxLength={200}
          multiline
          hint={`${voiceNotes.length}/200`}
        />
        <Button testID={T.personaSave} label={t("save")} onPress={onSave} disabled={!valid || available === false} />
      </ScrollView>
    </Screen>
  );
}
