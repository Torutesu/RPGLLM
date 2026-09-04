import { Hono } from "hono";
import { DevPurchaseReqZ, PLANS, RestoreReqZ, type PlanId } from "@rpgllm/shared";
import { billingMode } from "../env";
import { requireAuth } from "../auth";
import { fail, ok, parseBody } from "../http";
import { toApiSubscription } from "../services/serialize";
import { ensureWallet } from "../services/wallet";
import type { AppEnv } from "../types";

/**
 * Experiment variant naming convention consumed here (Agent B owns the variant ids):
 *   paywall_trial  → a variant containing "7" means a 7-day trial, anything else 0 days
 *   paywall_adfree → a variant matching /on|show|true/ shows the ad-free SKU
 * See build-notes "Agent A".
 */
const trialDaysFrom = (variant: string): number => (/7/.test(variant) ? 7 : 0);
const showAdFreeFrom = (variant: string): boolean => /on|show|true/i.test(variant);

export function billingRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/offerings", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const assignments = deps.gateway.assignments(user.id);
    const trialDays = trialDaysFrom(assignments["paywall_trial"] ?? "");
    const showAdFree = showAdFreeFrom(assignments["paywall_adfree"] ?? "");
    const plans = (Object.keys(PLANS) as PlanId[])
      .filter((id) => (id === "adfree_monthly" ? showAdFree : true))
      .map((id) => ({ id, usd: PLANS[id].usd, period: PLANS[id].period, highlighted: id === "plus_monthly" }));
    return ok({ plans, experiments: { trialDays, showAdFree } });
  });

  /** E2E-008. Only reachable with BILLING_MODE=test; RevenueCat is the P1 path. */
  app.post("/dev-purchase", requireAuth, async (c) => {
    if (billingMode() !== "test") return fail("NOT_FOUND", "Dev purchases are disabled", 404);
    const body = await parseBody(c.req, DevPurchaseReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const user = c.get("user");
    const plan = PLANS[body.value.plan];
    const now = deps.clock.now();
    const renewsAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const subscription = await deps.prisma.subscription.upsert({
      where: { userId: user.id },
      create: { userId: user.id, plan: body.value.plan, active: true, renewsAt, rcSubscriberId: `dev_${user.id}` },
      update: { plan: body.value.plan, active: true, renewsAt },
    });
    await deps.prisma.purchase.create({
      data: {
        userId: user.id,
        sku: plan.id,
        store: "stripe",
        amountUsd: plan.usd.toFixed(2),
        rcEventId: `dev_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
      },
    });

    const { wallet } = await ensureWallet(deps.prisma, deps.clock, user.id);
    const updated = await deps.prisma.$transaction(async (tx) => {
      const w = await tx.wallet.update({ where: { id: wallet.id }, data: { energy: plan.energyDaily } });
      await tx.ledgerEntry.create({
        data: { walletId: wallet.id, currency: "energy", delta: plan.energyDaily - wallet.energy, source: "purchase", ref: plan.id },
      });
      return w;
    });

    return ok({ subscription: toApiSubscription(subscription), energy: updated.energy });
  });

  /** TODO(P1): verify the RevenueCat signature and apply the event to Subscription/Purchase. */
  app.post("/webhook", async (c) => {
    await c.req.text().catch(() => "");
    return ok({ received: true, applied: false, todo: "RevenueCat webhook handling is P1" });
  });

  /** TODO(P1): call the RevenueCat REST API with rcAppUserId and reconcile the subscription. */
  app.post("/restore", requireAuth, async (c) => {
    const body = await parseBody(c.req, RestoreReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const user = c.get("user");
    const subscription = await deps.prisma.subscription.findUnique({ where: { userId: user.id } });
    return ok({ subscription: toApiSubscription(subscription), todo: "RevenueCat restore is P1" });
  });

  return app;
}
