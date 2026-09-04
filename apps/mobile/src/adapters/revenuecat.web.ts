import type { PlanId } from "@rpgllm/shared";
import type { BillingAdapter, PurchaseResult, StoreOffering } from "./billing";

/**
 * Web stub. Metro prefers `revenuecat.web.ts` over `revenuecat.ts` when it bundles for the browser,
 * which is how `react-native-purchases` (native modules, no web build) stays out of the web export
 * entirely. `getBilling()` never selects this adapter on web either — it hands the browser
 * `DevBilling` — so reaching any method here means the mode was forced by hand.
 */
export class RevenueCatBilling implements BillingAdapter {
  readonly id = "revenuecat-web";
  async identify(): Promise<void> {
    /* nothing to identify: the web build has no store */
  }
  async offerings(): Promise<StoreOffering[] | null> {
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  purchase(_plan: PlanId): Promise<PurchaseResult> {
    return Promise.reject(new Error("in-app purchases are not available on the web build"));
  }
  restore(): Promise<void> {
    return Promise.reject(new Error("in-app purchases are not available on the web build"));
  }
}
