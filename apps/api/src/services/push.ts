import type { PrismaClient, PushToken } from "@prisma/client";

/**
 * S2-2 — Expo push delivery.
 *
 * There are no push credentials in this environment, so the transport is off unless
 * `PUSH_ENABLED=1`: `sendPush` then logs what it *would* have sent and reports `skipped`.
 * With the flag on it POSTs the Expo push receipts endpoint (no key needed for Expo-signed
 * tokens; FCM/APNs credentials are configured on the Expo project, not here).
 */
export const PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

/** Read lazily so tests can flip the flag between app instances (env.ts is Agent F's file). */
export const pushEnabled = (): boolean => (process.env.PUSH_ENABLED ?? "0") === "1";

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface PushResult {
  sent: number;
  skipped: boolean;
  error: string | null;
}

/** Expo caps a single request at 100 messages. */
const BATCH = 100;

export async function sendPush(tokens: readonly string[], message: PushMessage): Promise<PushResult> {
  const unique = [...new Set(tokens.filter((t) => t.length > 0))];
  if (unique.length === 0) return { sent: 0, skipped: true, error: null };

  if (!pushEnabled()) {
    // eslint-disable-next-line no-console
    console.info(`[push] skipped (PUSH_ENABLED != 1): "${message.title}" -> ${unique.length} token(s)`);
    return { sent: 0, skipped: true, error: null };
  }

  let sent = 0;
  let error: string | null = null;
  for (let i = 0; i < unique.length; i += BATCH) {
    const chunk = unique.slice(i, i + BATCH);
    const payload = chunk.map((to) => ({
      to,
      title: message.title,
      body: message.body,
      sound: "default",
      ...(message.data ? { data: message.data } : {}),
    }));
    try {
      const res = await fetch(PUSH_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) sent += chunk.length;
      else error = `HTTP ${res.status}`;
    } catch (e) {
      error = e instanceof Error ? e.message : "push transport failed";
    }
  }
  return { sent, skipped: false, error };
}

/** Enabled tokens for a user, newest first. */
export async function tokensForUser(prisma: PrismaClient, userId: string): Promise<PushToken[]> {
  return await prisma.pushToken.findMany({ where: { userId, enabled: true }, orderBy: { createdAt: "desc" } });
}

export async function notifyUser(prisma: PrismaClient, userId: string, message: PushMessage): Promise<PushResult> {
  const tokens = await tokensForUser(prisma, userId);
  return await sendPush(tokens.map((t) => t.token), message);
}
