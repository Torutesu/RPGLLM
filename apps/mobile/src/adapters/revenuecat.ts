import type { PlanId } from "@rpgllm/shared";
import type { BillingAdapter, PurchaseResult } from "./billing";

/**
 * TODO(P1): real RevenueCat adapter (native only).
 * `Purchases.configure({apiKey})` on boot, `getOfferings()` for the store products,
 * `purchasePackage()` here, then let the RC webhook flip Subscription.active server-side;
 * `restorePurchases()` for restore.
 */
export class RevenueCatBilling implements BillingAdapter {
  readonly id = "revenuecat";
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  purchase(_plan: PlanId): Promise<PurchaseResult> {
    return Promise.reject(new Error("revenuecat adapter not implemented (P1)"));
  }
  restore(): Promise<void> {
    return Promise.reject(new Error("revenuecat adapter not implemented (P1)"));
  }
}
