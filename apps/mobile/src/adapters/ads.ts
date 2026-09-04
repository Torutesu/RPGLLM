import { Platform } from "react-native";
import { TEST_AD_TOKEN } from "@rpgllm/shared";
import { adsMode, g } from "../env";
import { AdMobAds } from "./admob";

export type AdRequest = { personalized: boolean };

export interface AdsAdapter {
  readonly id: string;
  /** Whether a rewarded ad can be offered right now. */
  isAvailable(): boolean;
  /** Shows a rewarded ad and resolves with the SSV token to POST to /wallet/ad-reward. */
  showRewarded(req: AdRequest): Promise<string>;
}

/** Used on web and whenever ADS_MODE !== "admob". Deterministic for E2E. */
export class MockAds implements AdsAdapter {
  readonly id = "mock";
  isAvailable(): boolean {
    return true;
  }
  showRewarded(req: AdRequest): Promise<string> {
    // E2E-016 asserts npa=1 for minors; recorded at request time, before the reward resolves.
    g.__lastAdRequest = { npa: !req.personalized, at: Date.now() };
    return new Promise((resolve) => setTimeout(() => resolve(TEST_AD_TOKEN), 300));
  }
}

let cached: AdsAdapter | null = null;
export function getAds(): AdsAdapter {
  if (!cached) cached = Platform.OS !== "web" && adsMode() === "admob" ? new AdMobAds() : new MockAds();
  return cached;
}

/**
 * Watch-ad affordance visibility (SCR-032).
 * Native: whenever the wallet allows ads. Web: only under ADS_MODE=test (E2E-007);
 * hidden otherwise so E2E-012 sees no ad button in a normal web build.
 */
export function canShowWatchAd(walletAdsEnabled: boolean): boolean {
  if (!walletAdsEnabled) return false;
  if (Platform.OS !== "web") return true;
  return adsMode() === "test";
}
