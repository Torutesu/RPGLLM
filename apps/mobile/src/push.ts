import { Platform } from "react-native";
import { api } from "./api/client";

/**
 * S2-2 — push registration.
 *
 * Web is a hard no-op (the E2E suite runs the web export, and a permission prompt there would
 * hang it). On native this needs `expo-notifications`, which is **not installed in this
 * environment**: adding it would rewrite the workspace lockfile while the other agents are
 * building, and there are no APNs/FCM credentials to test it against anyway.
 *
 * So the module interface lives here and the native call is injected. Wiring it up later is a
 * three-line change in one place — no call site moves:
 *
 * ```ts
 * import * as Notifications from "expo-notifications";
 * setNotificationsModule({
 *   getPermissionsAsync: Notifications.getPermissionsAsync,
 *   requestPermissionsAsync: Notifications.requestPermissionsAsync,
 *   getExpoPushTokenAsync: () => Notifications.getExpoPushTokenAsync(),
 * });
 * ```
 */
export type PushPlatform = "ios" | "android" | "web";

export interface PermissionResponse { granted: boolean; canAskAgain?: boolean }
export interface ExpoPushToken { data: string }

/** The slice of `expo-notifications` this app uses. */
export interface NotificationsModule {
  getPermissionsAsync(): Promise<PermissionResponse>;
  requestPermissionsAsync(): Promise<PermissionResponse>;
  getExpoPushTokenAsync(): Promise<ExpoPushToken>;
}

let notifications: NotificationsModule | null = null;
export function setNotificationsModule(mod: NotificationsModule | null): void {
  notifications = mod;
  registered = false;
}

export type PushOutcome =
  | { registered: true; token: string }
  | { registered: false; reason: "web" | "unavailable" | "denied" | "failed" | "already" };

/** One registration per app session is enough; the server upserts by token anyway. */
let registered = false;

export function pushPlatform(): PushPlatform {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  return "web";
}

/**
 * Asks for permission (once) and hands the Expo token to the API. Never throws: a device that
 * refuses notifications must not break the screen that called this.
 */
export async function registerForPush(): Promise<PushOutcome> {
  if (Platform.OS === "web") return { registered: false, reason: "web" };
  if (registered) return { registered: false, reason: "already" };
  const mod = notifications;
  if (!mod) return { registered: false, reason: "unavailable" };

  try {
    const current = await mod.getPermissionsAsync();
    const granted = current.granted ? current : await mod.requestPermissionsAsync();
    if (!granted.granted) return { registered: false, reason: "denied" };

    const token = await mod.getExpoPushTokenAsync();
    if (!token.data) return { registered: false, reason: "failed" };
    await api.registerPush(token.data, pushPlatform());
    registered = true;
    return { registered: true, token: token.data };
  } catch {
    return { registered: false, reason: "failed" };
  }
}

/** Fire-and-forget helper for screens that just want it attempted. */
export function ensurePushRegistered(): void {
  void registerForPush();
}
