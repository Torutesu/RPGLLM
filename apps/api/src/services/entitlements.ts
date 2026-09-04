import type { Subscription } from "@prisma/client";
import { ENERGY, PLANS, type PlanId } from "@rpgllm/shared";

/**
 * Entitlements — the single answer to "what is this user allowed to do".
 *
 * Every other module (wallet, ads, proactive DMs, relationship vibes) asks this file; nothing else
 * reads `Subscription.plan` to decide a limit. `services/wallet.ts`'s `dailyMaxFor` / `adFreeFor`
 * are thin wrappers over `entitlementsFor` so the rule cannot drift between call sites.
 *
 * The schema (`prisma/schema.prisma`, which this agent must not change) gives us exactly three
 * columns to express state with: `plan`, `active` and `renewsAt`. So the model is:
 *
 *   active = false                      → nothing. Used for an immediate revocation (REFUND).
 *   active = true,  renewsAt = null     → entitled, no known period end (dev purchases, lifetime).
 *   active = true,  renewsAt > now      → entitled. This is *also* how a cancelled-but-not-yet-
 *                                         expired subscription, a grace period and a billing-retry
 *                                         subscription are stored: the store keeps serving the user
 *                                         until the period end it told us about.
 *   active = true,  renewsAt <= now     → the period ran out and no RENEWAL arrived. Not entitled.
 *
 * That last row is what makes "an expiration drops entitlements at the period end, not instantly"
 * and "a user in billing retry keeps entitlements until renewsAt" the *same* rule, and it also
 * fails safe: if the EXPIRATION webhook is lost, access still lapses at `renewsAt`.
 */
export type EntitlementState = "free" | "active" | "expired" | "revoked";

export interface Entitlements {
  /** the plan the row names, even when it is no longer in force (useful for "resubscribe" copy) */
  plan: PlanId | null;
  /** true when the plan's benefits apply right now */
  entitled: boolean;
  state: EntitlementState;
  /** energy the wallet refills to each day */
  dailyEnergyMax: number;
  /** true when rewarded ads must not be offered */
  adFree: boolean;
  /** AIF: characters may open a DM without the user acting first */
  proactiveDMs: boolean;
  /** the player may steer a character's relationship setting */
  relationshipVibes: boolean;
  /** end of the paid period, when one is known */
  renewsAt: Date | null;
}

const FREE: Omit<Entitlements, "plan" | "state" | "renewsAt"> = {
  entitled: false,
  dailyEnergyMax: ENERGY.FREE_DAILY,
  adFree: false,
  proactiveDMs: false,
  relationshipVibes: false,
};

/** Plus tiers unlock the gated *features*; the ad-free SKU only removes ads. */
const isPlus = (plan: PlanId): boolean => plan.startsWith("plus_");

export const planOf = (sub: Subscription | null): PlanId | null => {
  if (!sub) return null;
  return sub.plan in PLANS ? (sub.plan as PlanId) : null;
};

/**
 * The one entitlement lookup. `now` is passed by every caller that has a `Clock`, so
 * `/__test/time-travel` moves entitlements too.
 */
export function entitlementsFor(sub: Subscription | null, now: Date = new Date()): Entitlements {
  const plan = planOf(sub);
  if (!sub || !plan) return { ...FREE, plan: null, state: "free", renewsAt: null };
  if (!sub.active) return { ...FREE, plan, state: "revoked", renewsAt: sub.renewsAt };
  if (sub.renewsAt && sub.renewsAt.getTime() <= now.getTime()) {
    return { ...FREE, plan, state: "expired", renewsAt: sub.renewsAt };
  }
  const def = PLANS[plan];
  return {
    plan,
    entitled: true,
    state: "active",
    dailyEnergyMax: def.energyDaily,
    adFree: def.adFree,
    proactiveDMs: isPlus(plan),
    relationshipVibes: isPlus(plan),
    renewsAt: sub.renewsAt,
  };
}

/** Convenience for code that only wants the number. */
export const dailyEnergyMaxFor = (sub: Subscription | null, now?: Date): number =>
  entitlementsFor(sub, now).dailyEnergyMax;
