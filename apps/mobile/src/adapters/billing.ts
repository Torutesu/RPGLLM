import { Platform } from "react-native";
import type { PlanId } from "@rpgllm/shared";
import { api } from "../api/client";
import { BILLING_MODE } from "../env";
import { RevenueCatBilling } from "./revenuecat";
import type { Subscription } from "../api/types";

export type PurchaseResult = { subscription: Subscription; energy: number };

/**
 * One plan as the *store* describes it. `priceString` is the store's own localized string
 * ("¥1,500", "US$14.99") — never format a price ourselves when the store gave us one, because it is
 * the only string that matches what the payment sheet will charge.
 */
export interface StoreOffering {
  planId: PlanId;
  /** localized price from the store, or null when we only have the catalogue price */
  priceString: string | null;
  /** free-trial length the *store* attaches to this product (0 when there is none) */
  trialDays: number;
}

export interface BillingAdapter {
  readonly id: string;
  /** Called on sign-in with the account id, and with null on sign-out. */
  identify(userId: string | null): Promise<void>;
  /** Store products for the paywall, or null when this adapter has no store to ask. */
  offerings(): Promise<StoreOffering[] | null>;
  purchase(plan: PlanId): Promise<PurchaseResult>;
  restore(): Promise<void>;
}

/**
 * A user backing out of the payment sheet is not an error — the paywall must close quietly instead
 * of showing "something went wrong". Every adapter throws this and nothing else for that case.
 */
export class PurchaseCancelledError extends Error {
  readonly cancelled = true;
  constructor() {
    super("purchase cancelled");
    this.name = "PurchaseCancelledError";
  }
}

export const isPurchaseCancelled = (e: unknown): boolean =>
  e instanceof PurchaseCancelledError ||
  (typeof e === "object" && e !== null && (e as { cancelled?: unknown }).cancelled === true);

/** BILLING_MODE=test — the server grants the subscription directly. Also the web path. */
export class DevBilling implements BillingAdapter {
  readonly id = "dev";
  async identify(): Promise<void> {
    /* the session JWT is the identity in dev mode */
  }
  async offerings(): Promise<StoreOffering[] | null> {
    return null; // no store to ask — the paywall falls back to GET /v1/billing/offerings
  }
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

/** Test seam: drop the memoized adapter (used when the mode changes at runtime). */
export function resetBilling(): void {
  cached = null;
}
