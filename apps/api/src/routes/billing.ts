import { Hono } from "hono";
import { DevPurchaseReqZ, PLANS, RestoreReqZ, type PlanId } from "@rpgllm/shared";
import { billingMode } from "../env";
import { requireAuth } from "../auth";
import { fail, ok, parseBody } from "../http";
import {
  RcWebhookBodyZ,
  applyWebhookEvent,
  restoreFromRevenueCat,
  revenueCatSecretKey,
  verifyWebhookSignature,
} from "../services/billing";
import { entitlementsFor } from "../services/entitlements";
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

  /** E2E-008. Only reachable with BILLING_MODE=test; RevenueCat is the real path. */
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

  /**
   * RevenueCat webhook.
   *
   * Unauthenticated by design (RevenueCat has no session), so the signature is the whole security
   * boundary: an unsigned request is refused unless `BILLING_MODE=test` in a non-production
   * environment. Everything after a valid signature answers 200 — including "I could not match a
   * user" — because a non-2xx makes RevenueCat retry an event that will never apply. The body is
   * read raw first: the HMAC is over the exact bytes RevenueCat signed.
   */
  app.post("/webhook", async (c) => {
    const raw = await c.req.text().catch(() => "");
    const verdict = verifyWebhookSignature(c.req.raw.headers, raw);
    if (!verdict.ok) {
      console.warn(`[billing] rejected webhook: signature ${verdict.reason}`);
      return fail("UNAUTHORIZED", "Invalid webhook signature", 401);
    }

    let json: unknown;
    try {
      json = JSON.parse(raw || "{}");
    } catch {
      return fail("VALIDATION", "Body is not JSON", 400);
    }
    const parsed = RcWebhookBodyZ.safeParse(json);
    if (!parsed.success) return fail("VALIDATION", "Unexpected webhook payload", 400);

    const deps = c.get("deps");
    const result = await applyWebhookEvent(deps.prisma, deps.clock, parsed.data.event);
    // No ids, no emails, no secrets — the event id and its type are enough to trace a delivery.
    console.info(
      `[billing] event ${result.type} ${result.eventId} applied=${String(result.applied)} duplicate=${String(result.duplicate)}${result.reason ? ` reason=${result.reason}` : ""}`,
    );
    return ok({
      received: true,
      applied: result.applied,
      duplicate: result.duplicate,
      eventId: result.eventId,
      type: result.type,
      reason: result.reason,
    });
  });

  /**
   * Guideline 3.1.1 — restore purchases.
   *
   * The request body carries an `rcAppUserId`, but it is **not** trusted: reconciliation only ever
   * runs against ids the server already knows for the authenticated user (their user id, which is
   * what the client identifies RevenueCat with, and any `rcSubscriberId` already on their row).
   * Otherwise restoring would be a way to claim someone else's subscription. Without
   * `REVENUECAT_SECRET_KEY` the local row is returned with `source:"local"` so the client can say
   * so instead of pretending it checked.
   */
  app.post("/restore", requireAuth, async (c) => {
    const body = await parseBody(c.req, RestoreReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const user = c.get("user");

    const existing = await deps.prisma.subscription.findUnique({ where: { userId: user.id } });
    const appUserIds = [user.id, ...(existing?.rcSubscriberId ? [existing.rcSubscriberId] : [])].filter(
      (v, i, a) => a.indexOf(v) === i,
    );
    const claimed = body.value.rcAppUserId;
    const outcome = await restoreFromRevenueCat(deps.prisma, deps.clock, user.id, appUserIds);
    const ent = entitlementsFor(outcome.subscription, deps.clock.now());

    return ok({
      subscription: toApiSubscription(outcome.subscription),
      source: outcome.source,
      configured: revenueCatSecretKey().length > 0,
      note: outcome.note,
      /** `false` tells an honest client that the id it identified the store with is not the one we reconciled. */
      matchedRequestedUser: appUserIds.includes(claimed),
      entitlements: {
        entitled: ent.entitled,
        state: ent.state,
        dailyEnergyMax: ent.dailyEnergyMax,
        adFree: ent.adFree,
        proactiveDMs: ent.proactiveDMs,
        relationshipVibes: ent.relationshipVibes,
      },
    });
  });

  return app;
}
