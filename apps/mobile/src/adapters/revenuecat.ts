import { Platform } from "react-native";
import Purchases, {
  LOG_LEVEL,
  type PurchasesOffering,
  type PurchasesPackage,
  type PurchasesStoreProduct,
} from "react-native-purchases";
import { PLANS, type PlanId } from "@rpgllm/shared";
import { api } from "../api/client";
import { RC_ANDROID_KEY, RC_IOS_KEY } from "../env";
import { PurchaseCancelledError, type BillingAdapter, type PurchaseResult, type StoreOffering } from "./billing";

/**
 * RevenueCat, for real (native only).
 *
 * Web never loads this file: `revenuecat.web.ts` sits next to it and Metro prefers the `.web`
 * variant when it bundles for the browser, so the native SDK is not in the web export at all and
 * `getBilling()` keeps handing the web build `DevBilling`.
 *
 * The purchase itself happens on the device and against the store; the *entitlement* is granted
 * server-side by the RevenueCat webhook (`POST /v1/billing/webhook`). Because the webhook is
 * asynchronous and the paywall must not lie, `purchase()` finishes by asking our own API to
 * reconcile (`POST /v1/billing/restore`, which reads the RevenueCat REST API) and then reads
 * `GET /v1/me`. Whichever of the two paths lands first, the number the user sees is the server's.
 */
const apiKey = (): string => (Platform.OS === "ios" ? RC_IOS_KEY : RC_ANDROID_KEY);

/** Product identifier → our plan id. The store products are named after the `PLANS` keys. */
function planOfProduct(product: PurchasesStoreProduct): PlanId | null {
  const id = product.identifier;
  if (id in PLANS) return id as PlanId;
  const bare = id.split(".").pop() ?? "";
  if (bare in PLANS) return bare as PlanId;
  if (/ad[_.-]?free/i.test(id)) return "adfree_monthly";
  if (/week/i.test(id)) return "plus_weekly";
  if (/(year|annual)/i.test(id)) return "plus_yearly";
  if (/month/i.test(id)) return "plus_monthly";
  return null;
}

/** RevenueCat reports an intro offer in ISO-8601 periods (`P1W`, `P7D`, `P1M`). */
export function trialDaysOf(product: PurchasesStoreProduct): number {
  const intro = product.introPrice;
  if (!intro) return 0;
  if (intro.price > 0) return 0; // a discounted intro price is not a free trial
  const unit = String(intro.periodUnit ?? "").toUpperCase();
  const count = Number(intro.periodNumberOfUnits ?? 0);
  if (!Number.isFinite(count) || count <= 0) return 0;
  if (unit.startsWith("DAY")) return count;
  if (unit.startsWith("WEEK")) return count * 7;
  if (unit.startsWith("MONTH")) return count * 30;
  if (unit.startsWith("YEAR")) return count * 365;
  return 0;
}

const isCancelled = (e: unknown): boolean => {
  if (typeof e !== "object" || e === null) return false;
  const err = e as { userCancelled?: unknown; code?: unknown };
  if (err.userCancelled === true) return true;
  // PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR — string in the JS bridge, "1" on older builds
  return typeof err.code === "string" && /cancel/i.test(err.code);
};

export class RevenueCatBilling implements BillingAdapter {
  readonly id = "revenuecat";
  private configured = false;
  private currentUserId: string | null = null;

  /** `Purchases.configure` is idempotent per app-user id; calling it twice is what RC recommends. */
  private ensureConfigured(userId: string | null): void {
    const key = apiKey();
    if (!key) throw new Error("RevenueCat public key is not configured");
    if (!this.configured) {
      void Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.WARN : LOG_LEVEL.ERROR);
      Purchases.configure({ apiKey: key, appUserID: userId });
      this.configured = true;
      this.currentUserId = userId;
    }
  }

  /**
   * Sign-in / sign-out. The app-user id is the account id, which is exactly what the webhook and
   * `POST /v1/billing/restore` match on server-side — the two must never drift apart.
   */
  async identify(userId: string | null): Promise<void> {
    if (!apiKey()) return;
    this.ensureConfigured(userId);
    if (userId === this.currentUserId) return;
    if (userId === null) {
      await Purchases.logOut();
      this.currentUserId = null;
      return;
    }
    await Purchases.logIn(userId);
    this.currentUserId = userId;
  }

  async offerings(): Promise<StoreOffering[] | null> {
    if (!apiKey()) return null;
    this.ensureConfigured(this.currentUserId);
    let offering: PurchasesOffering | null = null;
    try {
      const all = await Purchases.getOfferings();
      offering = all.current;
    } catch {
      return null; // the store is unreachable — the paywall falls back to the API catalogue
    }
    if (!offering) return null;
    const out: StoreOffering[] = [];
    for (const pkg of offering.availablePackages) {
      const planId = planOfProduct(pkg.product);
      if (!planId) continue;
      out.push({ planId, priceString: pkg.product.priceString, trialDays: trialDaysOf(pkg.product) });
    }
    return out.length > 0 ? out : null;
  }

  private async packageFor(plan: PlanId): Promise<PurchasesPackage> {
    const all = await Purchases.getOfferings();
    const offering = all.current;
    if (!offering) throw new Error("no RevenueCat offering is current");
    const match = offering.availablePackages.find((p) => planOfProduct(p.product) === plan);
    if (!match) throw new Error(`no package for ${plan} in offering ${offering.identifier}`);
    return match;
  }

  async purchase(plan: PlanId): Promise<PurchaseResult> {
    this.ensureConfigured(this.currentUserId);
    const pkg = await this.packageFor(plan);
    try {
      await Purchases.purchasePackage(pkg);
    } catch (e) {
      if (isCancelled(e)) throw new PurchaseCancelledError();
      throw e instanceof Error ? e : new Error("purchase failed");
    }
    return await this.syncFromServer();
  }

  async restore(): Promise<void> {
    this.ensureConfigured(this.currentUserId);
    await Purchases.restorePurchases();
    await api.restorePurchases(this.currentUserId ?? "");
  }

  /** The server is the only source of truth for what the user now owns and how much energy it gave. */
  private async syncFromServer(): Promise<PurchaseResult> {
    try {
      await api.restorePurchases(this.currentUserId ?? "");
    } catch {
      /* the webhook will still land; /v1/me below tells us where we stand right now */
    }
    const me = await api.me();
    if (!me.subscription) throw new Error("the purchase has not reached the server yet");
    return { subscription: me.subscription, energy: me.wallet.energy };
  }
}
