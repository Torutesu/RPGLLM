import type { AdRequest, AdsAdapter } from "./ads";

/**
 * TODO(P1): real Google Mobile Ads rewarded adapter (native only).
 * Wire `react-native-google-mobile-ads`: load a RewardedAd with
 * `requestNonPersonalizedAdsOnly: !req.personalized`, await EARNED_REWARD,
 * and resolve with the SSV token for POST /wallet/ad-reward.
 */
export class AdMobAds implements AdsAdapter {
  readonly id = "admob";
  isAvailable(): boolean {
    return false;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  showRewarded(_req: AdRequest): Promise<string> {
    return Promise.reject(new Error("admob adapter not implemented (P1)"));
  }
}
