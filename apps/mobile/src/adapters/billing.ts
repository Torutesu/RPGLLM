import { Platform } from "react-native";
import type { PlanId } from "@rpgllm/shared";
import { api } from "../api/client";
import { BILLING_MODE } from "../env";
import { RevenueCatBilling } from "./revenuecat";
import type { Subscription } from "../api/types";

export type PurchaseResult = { subscription: Subscription; energy: number };

export interface BillingAdapter {
  readonly id: string;
  purchase(plan: PlanId): Promise<PurchaseResult>;
  restore(): Promise<void>;
}

/** BILLING_MODE=test — the server grants the subscription directly. */
export class DevBilling implements BillingAdapter {
  readonly id = "dev";
  async purchase(plan: PlanId): Promise<PurchaseResult> {
    const res = await api.devPurchase(plan);
    return { subscription: res.subscription, energy: res.energy };
  }
  async restore(): Promise<void> {
    /* nothing to restore in dev mode */
  }
}

let cached: BillingAdapter | null = null;
export function getBilling(): BillingAdapter {
  if (!cached) {
    cached = Platform.OS !== "web" && BILLING_MODE === "revenuecat" ? new RevenueCatBilling() : new DevBilling();
  }
  return cached;
}
