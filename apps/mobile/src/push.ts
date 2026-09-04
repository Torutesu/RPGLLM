import { Platform } from "react-native";
import { router } from "expo-router";
import { api } from "./api/client";
import { notificationsModule } from "./notifications-module";

/**
 * S2-2 — push registration and routing.
 *
 * Two rules shape this file:
 *
 * 1. **Web is a hard no-op.** The E2E suite runs the web export; a permission prompt there would
 *    hang it. `notifications-module.web.ts` also keeps `expo-notifications` out of the web bundle.
 *
 * 2. **Never ask before the app has been useful.** Asking on launch is the single biggest cause of
 *    a permanent deny, and iOS only ever shows the system dialog once. So the prompt is *locked*
 *    until `markValueDelivered()` is called — which `state/store.tsx` does after the first post
 *    lands. Any earlier call (the feed's mount, for example) is either a silent token refresh, when
 *    permission was granted in an earlier session, or nothing at all.
 */
export type PushPlatform = "ios" | "android" | "web";

export interface PermissionResponse {
  granted: boolean;
  canAskAgain?: boolean;
}
export interface ExpoPushToken {
  data: string;
}

/** The slice of `expo-notifications` this app uses (see `notifications-module.ts`). */
export interface NotificationsModule {
  getPermissionsAsync(): Promise<PermissionResponse>;
  requestPermissionsAsync(): Promise<PermissionResponse>;
  getExpoPushTokenAsync(): Promise<ExpoPushToken>;
  /** Android 8+ needs a channel before anything can be shown. No-op elsewhere. */
  setAndroidChannelAsync?(): Promise<void>;
  /** Notification taps. Returns an unsubscribe function. */
  addResponseListener?(handler: (target: string | null) => void): () => void;
  /** The tap that cold-started the app, if there was one. */
  lastResponseTarget?(): Promise<string | null>;
}

let notifications: NotificationsModule | null = Platform.OS === "web" ? null : notificationsModule;

/** Test seam / escape hatch: swap the native module (pass null to disable). */
export function setNotificationsModule(mod: NotificationsModule | null): void {
  notifications = mod;
  registered = false;
  routingAttached = false;
}

export type PushOutcome =
  | { registered: true; token: string }
  | { registered: false; reason: "web" | "unavailable" | "denied" | "failed" | "already" | "too_early" };

/** One registration per app session is enough; the server upserts by token anyway. */
let registered = false;
/** The prompt stays locked until the app has delivered something worth being notified about. */
let valueDelivered = false;
let routingAttached = false;

export function pushPlatform(): PushPlatform {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  return "web";
}

/**
 * "The app has done something for you" — called after the first successful post. From here on
 * `registerForPush()` is allowed to show the system permission dialog.
 */
export function markValueDelivered(): void {
  valueDelivered = true;
}

/* ------------------------------------------------------------------- routing ---- */

/**
 * Where a notification's `target` goes. The server writes the same strings into
 * `Notification.target`, so this mirrors `app/notifications.tsx`.
 */
export function routeForTarget(target: string | null): string | null {
  if (!target) return null;
  const [kind, ...rest] = target.split(":");
  const id = rest.join(":");
  switch (kind) {
    case "post":
      return id ? `/post/${id}` : "/feed";
    case "dm":
      return id ? `/dms/${id}` : "/dms";
    case "digest":
    case "event":
      return "/feed";
    case "achievement":
      return "/achievements";
    case "profile":
      return "/profile";
    default:
      return "/feed";
  }
}

export function handleNotificationTarget(target: string | null): void {
  const route = routeForTarget(target);
  if (!route) return;
  try {
    router.push(route as Parameters<typeof router.push>[0]);
  } catch {
    /* a tap must never crash the app; the user is already looking at *something* */
  }
}

/** Attaches the tap handler once, and follows the tap that cold-started the app. */
function attachRouting(mod: NotificationsModule): void {
  if (routingAttached) return;
  routingAttached = true;
  mod.addResponseListener?.(handleNotificationTarget);
  void mod.lastResponseTarget?.().then((target) => {
    if (target) handleNotificationTarget(target);
  });
}

/* -------------------------------------------------------------- registration ---- */

/**
 * Asks for permission (at most once, and only after the app has earned it) and hands the Expo token
 * to the API. Never throws: a device that refuses notifications must not break the calling screen.
 */
export async function registerForPush(): Promise<PushOutcome> {
  if (Platform.OS === "web") return { registered: false, reason: "web" };
  if (registered) return { registered: false, reason: "already" };
  const mod = notifications;
  if (!mod) return { registered: false, reason: "unavailable" };

  try {
    const current = await mod.getPermissionsAsync();
    if (!current.granted) {
      // Locked until the first post: no prompt, no denial to recover from.
      if (!valueDelivered) return { registered: false, reason: "too_early" };
      if (current.canAskAgain === false) return { registered: false, reason: "denied" };
      const asked = await mod.requestPermissionsAsync();
      if (!asked.granted) return { registered: false, reason: "denied" };
    }

    if (Platform.OS === "android") await mod.setAndroidChannelAsync?.();

    const token = await mod.getExpoPushTokenAsync();
    if (!token.data) return { registered: false, reason: "failed" };
    await api.registerPush(token.data, pushPlatform());
    registered = true;
    attachRouting(mod);
    return { registered: true, token: token.data };
  } catch {
    return { registered: false, reason: "failed" };
  }
}

/** Fire-and-forget helper for screens that just want it attempted. */
export function ensurePushRegistered(): void {
  void registerForPush();
}

/** After the first successful post: unlock the prompt and register in the same breath. */
export function pushAfterFirstPost(): void {
  markValueDelivered();
  void registerForPush();
}
