import React, { useState } from "react";
import { Text, View } from "react-native";
import { T, colors, radius, spacing } from "@rpgllm/shared";
import { useT } from "../state/store";
import { APPEAL_MAX, appealText, isAppealValid } from "../studio/appeal";
import { Icon, typo } from "../ui";
import { Button, Field } from "./ui";

/**
 * The one message a creator gets to send about a rejection (SCR-049).
 *
 * It is deliberately small: one field, one button, no attachments, no thread. The hint says out
 * loud that a person reads it and that there is only one — a creator who thinks this is a support
 * chat will spend it on "hi?".
 */

/** Shared shell so the sent state and the pending state are visibly the same object. */
function Notice({ tint, icon, children }: { tint: string; icon: "clock" | "check"; children: React.ReactNode }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: spacing.sm,
        padding: spacing.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: `${tint}59`,
        backgroundColor: `${tint}14`,
      }}
    >
      <Icon name={icon} size={16} color={tint} />
      {children}
    </View>
  );
}

/**
 * Sent, or waiting. Both are the same fact from different distances: `sent` is the answer to the
 * button that was just pressed, `pending` is what the screen says to someone who closed the app
 * and came back — which is why this is a state on the world, never a toast.
 */
export function AppealStatus({ sent }: { sent: boolean }) {
  const { t } = useT();
  const tint = sent ? colors.positive : colors.warning;
  return (
    <Notice tint={tint} icon={sent ? "check" : "clock"}>
      <Text
        testID={sent ? T.studioAppealSent : undefined}
        accessibilityRole={sent ? "alert" : "text"}
        accessibilityLiveRegion={sent ? "polite" : "none"}
        style={[typo.meta, { color: sent ? colors.text : colors.textDim, flex: 1 }]}
      >
        {t(sent ? "studioAppealSent" : "studioAppealPending")}
      </Text>
    </Notice>
  );
}

export function AppealForm({
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (message: string) => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const [message, setMessage] = useState("");
  const length = appealText(message).length;
  const valid = isAppealValid(message);

  return (
    <View
      style={{
        gap: spacing.md,
        padding: spacing.lg,
        borderRadius: radius.lg,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.borderHi,
      }}
    >
      <View style={{ gap: spacing.xs }}>
        <Text accessibilityRole="header" style={[typo.h2, { color: colors.text }]}>
          {t("studioAppealTitle")}
        </Text>
        <Text style={[typo.meta, { color: colors.textDim }]}>{t("studioAppealHint")}</Text>
      </View>

      <Field
        testID={T.studioAppealInput}
        value={message}
        onChangeText={setMessage}
        multiline
        numberOfLines={5}
        /*
         * The contract is min 10 / max 500. The ceiling is enforced by the field itself and the
         * floor by the disabled button, so the way a creator meets either limit is the UI, never
         * a 400 after they have already spent their one message.
         */
        maxLength={APPEAL_MAX}
        editable={!busy}
        accessibilityLabel={t("studioAppealTitle")}
        style={{ minHeight: 112, textAlignVertical: "top" }}
      />
      <Text
        accessibilityLiveRegion="none"
        style={[typo.caption, { color: valid ? colors.textDim : colors.textMuted, alignSelf: "flex-end" }]}
      >
        {`${length} / ${APPEAL_MAX}`}
      </Text>

      {error ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[typo.meta, { color: colors.danger }]}>
          {error}
        </Text>
      ) : null}

      <Button
        testID={T.studioAppealSubmit}
        label={t("studioAppealSubmit")}
        icon="send"
        loading={busy}
        disabled={!valid}
        onPress={() => onSubmit(appealText(message))}
      />
      <Button label={t("cancel")} variant="ghost" disabled={busy} onPress={onCancel} />
    </View>
  );
}
