import { Platform } from "react-native";

/** API base. `EXPO_PUBLIC_*` is inlined by Metro at build time. */
export const API_ORIGIN = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";
export const API_BASE = `${API_ORIGIN}/v1`;

export const IS_WEB = Platform.OS === "web";

type Globals = {
  __ADS_MODE?: string;
  __lastAdRequest?: { npa: boolean; at: number };
  __lastParseError?: { path: string; message: string };
  __sseFrames?: number;
};
export const g = globalThis as unknown as Globals;

/**
 * Ads mode. Build-time `EXPO_PUBLIC_ADS_MODE` is the default; `globalThis.__ADS_MODE`
 * (settable from a test via `page.addInitScript`) overrides it at runtime so a single web
 * export can serve both E2E-007 (ad reward) and E2E-012 (no ad button on web).
 */
export function adsMode(): string {
  return g.__ADS_MODE ?? process.env.EXPO_PUBLIC_ADS_MODE ?? "off";
}

export const BILLING_MODE = process.env.EXPO_PUBLIC_BILLING_MODE ?? "test";

/**
 * RevenueCat *public* SDK keys (safe to ship in a client bundle — the secret key lives on the API).
 * Empty here: they are provided at build time by EAS, see `docs/billing.md`.
 */
export const RC_IOS_KEY = process.env.EXPO_PUBLIC_RC_IOS_KEY ?? "";
export const RC_ANDROID_KEY = process.env.EXPO_PUBLIC_RC_ANDROID_KEY ?? "";

/** Expo project id — `getExpoPushTokenAsync` needs it in a bare/EAS build. See `docs/push.md`. */
export const EXPO_PROJECT_ID = process.env.EXPO_PUBLIC_EXPO_PROJECT_ID ?? "";

/**
 * Public origin of the web app, used to build share links. On web the page's own origin is always
 * right; on a device there is no origin, so `EXPO_PUBLIC_APP_URL` is the only way a shared link can
 * point at anything real. Keep it in step with the API's `PUBLIC_APP_URL`.
 */
export const APP_ORIGIN = (process.env.EXPO_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
