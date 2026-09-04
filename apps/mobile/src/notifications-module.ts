import * as Notifications from "expo-notifications";
import { EXPO_PROJECT_ID } from "./env";
import type { NotificationsModule } from "./push";

/**
 * The native slice of `expo-notifications`. Metro prefers `notifications-module.web.ts` when it
 * bundles for the browser, so the web export never pulls this in and can never be asked for a
 * permission (which would hang the E2E suite on a browser prompt).
 */

/** A notification that arrives while the app is open still shows — this is the retention surface. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

const targetOf = (data: unknown): string | null => {
  if (typeof data !== "object" || data === null) return null;
  const target = (data as { target?: unknown }).target;
  return typeof target === "string" && target.length > 0 ? target : null;
};

export const notificationsModule: NotificationsModule = {
  async getPermissionsAsync() {
    const res = await Notifications.getPermissionsAsync();
    return { granted: res.granted, canAskAgain: res.canAskAgain };
  },
  async requestPermissionsAsync() {
    const res = await Notifications.requestPermissionsAsync();
    return { granted: res.granted, canAskAgain: res.canAskAgain };
  },
  async getExpoPushTokenAsync() {
    const res = await Notifications.getExpoPushTokenAsync(
      EXPO_PROJECT_ID ? { projectId: EXPO_PROJECT_ID } : undefined,
    );
    return { data: res.data };
  },
  async setAndroidChannelAsync() {
    // Android 8+ refuses to show a notification that has no channel.
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.DEFAULT,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      showBadge: true,
      sound: "default",
    });
  },
  addResponseListener(handler) {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      handler(targetOf(response.notification.request.content.data));
    });
    return () => sub.remove();
  },
  async lastResponseTarget() {
    const last = await Notifications.getLastNotificationResponseAsync();
    return last ? targetOf(last.notification.request.content.data) : null;
  },
};
