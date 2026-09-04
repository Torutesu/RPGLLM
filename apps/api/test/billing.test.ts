import { createHmac } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ENERGY, PLANS } from "@rpgllm/shared";
import { createClock } from "../src/clock";
import {
  RcSubscriberResZ,
  amountUsdOf,
  applyWebhookEvent,
  bestEntitlement,
  planFromProductId,
  restoreFromRevenueCat,
  storeOf,
  subscriptionPatchFor,
  verifyWebhookSignature,
  type RcEvent,
} from "../src/services/billing";
import { entitlementsFor } from "../src/services/entitlements";
import { adFreeFor, dailyMaxFor } from "../src/services/wallet";
import { call, makeHarness, prisma, resetDatabase, signup, type Harness } from "./helpers";

let h: Harness;

const SECRET = "whsec_test_secret_value";
const savedSecret = process.env.REVENUECAT_WEBHOOK_SECRET;
const savedKey = process.env.REVENUECAT_SECRET_KEY;

beforeAll(() => {
  h = makeHarness();
});
beforeEach(async () => {
  await resetDatabase();
  delete process.env.REVENUECAT_WEBHOOK_SECRET;
  delete process.env.REVENUECAT_SECRET_KEY;
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.REVENUECAT_WEBHOOK_SECRET;
  else process.env.REVENUECAT_WEBHOOK_SECRET = savedSecret;
  if (savedKey === undefined) delete process.env.REVENUECAT_SECRET_KEY;
  else process.env.REVENUECAT_SECRET_KEY = savedKey;
});

/* ------------------------------------------------------------------ helpers ---- */

let eventSeq = 0;
const eventId = (): string => `evt_${++eventSeq}_${Date.now().toString(36)}`;

const hours = (n: number): number => n * 60 * 60 * 1000;

function makeEvent(userId: string, overrides: Partial<RcEvent> = {}): RcEvent {
  return {
    id: eventId(),
    type: "INITIAL_PURCHASE",
    app_user_id: userId,
    original_app_user_id: userId,
    product_id: "plus_monthly",
    store: "APP_STORE",
    environment: "PRODUCTION",
    price: PLANS.plus_monthly.usd,
    currency: "USD",
    expiration_at_ms: Date.now() + hours(24 * 30),
    ...overrides,
  };
}

const sign = (body: string, secret = SECRET): string =>
  createHmac("sha256", secret).update(body, "utf8").digest("hex");

async function postWebhook(
  event: RcEvent,
  opts: { headers?: Record<string, string>; signWith?: string | null } = {},
): Promise<{ status: number; data: Record<string, unknown>; error: { code: string } | null }> {
  const body = JSON.stringify({ api_version: "1.0", event });
  const headers: Record<string, string> = { "content-type": "application/json", ...(opts.headers ?? {}) };
  if (opts.signWith !== null && opts.signWith !== undefined) headers["x-revenuecat-signature"] = sign(body, opts.signWith);
  const res = await h.app.request("/v1/billing/webhook", { method: "POST", headers, body });
  const text = await res.text();
  const parsed = JSON.parse(text) as { data: Record<string, unknown>; error: { code: string } | null };
  return { status: res.status, data: parsed.data, error: parsed.error };
}

const subFor = (userId: string) => prisma.subscription.findUnique({ where: { userId } });
const walletFor = (userId: string) => prisma.wallet.findUnique({ where: { userId } });

/* --------------------------------------------------------------- signature ---- */

describe("RevenueCat webhook signature", () => {
  it("accepts a correct HMAC of the raw body and rejects a wrong one", async () => {
    const { userId } = await signup(h);
    process.env.REVENUECAT_WEBHOOK_SECRET = SECRET;

    const bad = await postWebhook(makeEvent(userId), { signWith: "not-the-secret" });
    expect(bad.status).toBe(401);
    expect(bad.error?.code).toBe("UNAUTHORIZED");
    expect(await subFor(userId)).toBeNull();

    const good = await postWebhook(makeEvent(userId), { signWith: SECRET });
    expect(good.status).toBe(200);
    expect(good.data.applied).toBe(true);
    expect((await subFor(userId))?.active).toBe(true);
  });

  it("accepts the shared-secret Authorization header scheme", () => {
    process.env.REVENUECAT_WEBHOOK_SECRET = SECRET;
    const ok = verifyWebhookSignature(new Headers({ authorization: `Bearer ${SECRET}` }), "{}");
    expect(ok).toEqual({ ok: true, via: "shared-secret" });
    const bad = verifyWebhookSignature(new Headers({ authorization: "Bearer nope" }), "{}");
    expect(bad).toEqual({ ok: false, reason: "mismatch" });
  });

  it("refuses an unsigned event once a secret is configured", async () => {
    const { userId } = await signup(h);
    process.env.REVENUECAT_WEBHOOK_SECRET = SECRET;
    const res = await postWebhook(makeEvent(userId), { signWith: null });
    expect(res.status).toBe(401);
  });

  it("allows the unsigned bypass only under BILLING_MODE=test", async () => {
    const { userId } = await signup(h);
    // vitest runs with BILLING_MODE=test and no secret configured
    const res = await postWebhook(makeEvent(userId), { signWith: null });
    expect(res.status).toBe(200);
    expect(res.data.applied).toBe(true);
  });
});

/* ------------------------------------------------------------ event mapping ---- */

describe("RevenueCat event mapping", () => {
  it("INITIAL_PURCHASE grants the plan, records the price and tops the tank to 50", async () => {
    const { token, userId } = await signup(h);
    await call(h, "POST", "/v1/__test/set-energy", { token, body: { energy: 0 } });

    const event = makeEvent(userId);
    const res = await postWebhook(event, { signWith: null });
    expect(res.data.applied).toBe(true);

    const sub = await subFor(userId);
    expect(sub?.plan).toBe("plus_monthly");
    expect(sub?.active).toBe(true);
    expect(sub?.renewsAt).not.toBeNull();
    expect(await walletFor(userId).then((w) => w?.energy)).toBe(PLANS.plus_monthly.energyDaily);

    const purchase = await prisma.purchase.findUnique({ where: { rcEventId: event.id } });
    expect(purchase?.sku).toBe("plus_monthly");
    expect(purchase?.store).toBe("app_store");
    expect(Number(purchase?.amountUsd)).toBeCloseTo(PLANS.plus_monthly.usd, 2);
  });

  it("RENEWAL pushes renewsAt out and tops the tank up again", async () => {
    const { token, userId } = await signup(h);
    await postWebhook(makeEvent(userId), { signWith: null });
    await call(h, "POST", "/v1/__test/set-energy", { token, body: { energy: 3 } });

    const later = Date.now() + hours(24 * 60);
    await postWebhook(makeEvent(userId, { type: "RENEWAL", expiration_at_ms: later }), { signWith: null });

    const sub = await subFor(userId);
    expect(sub?.active).toBe(true);
    expect(sub?.renewsAt?.getTime()).toBe(later);
    expect(await walletFor(userId).then((w) => w?.energy)).toBe(PLANS.plus_monthly.energyDaily);
  });

  it("PRODUCT_CHANGE moves the row to the new plan", async () => {
    const { userId } = await signup(h);
    await postWebhook(makeEvent(userId), { signWith: null });
    await postWebhook(
      makeEvent(userId, { type: "PRODUCT_CHANGE", product_id: "plus_monthly", new_product_id: "plus_yearly" }),
      { signWith: null },
    );
    expect((await subFor(userId))?.plan).toBe("plus_yearly");
  });

  it("CANCELLATION keeps the subscription until the period end", async () => {
    const { userId } = await signup(h);
    const until = Date.now() + hours(24 * 10);
    await postWebhook(makeEvent(userId, { expiration_at_ms: until }), { signWith: null });
    await postWebhook(makeEvent(userId, { type: "CANCELLATION", expiration_at_ms: until, price: 0 }), { signWith: null });

    const sub = await subFor(userId);
    expect(sub?.active).toBe(true);
    expect(entitlementsFor(sub, new Date()).entitled).toBe(true);
    expect(entitlementsFor(sub, new Date(until + 1000)).entitled).toBe(false);
  });

  it("EXPIRATION in the future waits for the period end; in the past it is dead on arrival", async () => {
    const a = await signup(h);
    const future = Date.now() + hours(24 * 3);
    await postWebhook(makeEvent(a.userId, { expiration_at_ms: future }), { signWith: null });
    await postWebhook(makeEvent(a.userId, { type: "EXPIRATION", expiration_at_ms: future, price: 0 }), { signWith: null });
    const stillOn = await subFor(a.userId);
    expect(stillOn?.active).toBe(true);
    expect(entitlementsFor(stillOn, new Date()).dailyEnergyMax).toBe(PLANS.plus_monthly.energyDaily);
    expect(entitlementsFor(stillOn, new Date(future + 1)).dailyEnergyMax).toBe(ENERGY.FREE_DAILY);

    const b = await signup(h);
    const past = Date.now() - hours(1);
    await postWebhook(makeEvent(b.userId), { signWith: null });
    await postWebhook(makeEvent(b.userId, { type: "EXPIRATION", expiration_at_ms: past, price: 0 }), { signWith: null });
    const over = await subFor(b.userId);
    expect(over?.active).toBe(false);
    expect(entitlementsFor(over, new Date()).entitled).toBe(false);
  });

  it("BILLING_ISSUE keeps entitlements until renewsAt (billing retry / grace)", async () => {
    const { userId } = await signup(h);
    await postWebhook(makeEvent(userId), { signWith: null });

    const graceEnd = Date.now() + hours(48);
    await postWebhook(
      makeEvent(userId, {
        type: "BILLING_ISSUE",
        price: 0,
        expiration_at_ms: Date.now() - hours(1),
        grace_period_expiration_at_ms: graceEnd,
      }),
      { signWith: null },
    );

    const sub = await subFor(userId);
    expect(sub?.active).toBe(true);
    expect(sub?.renewsAt?.getTime()).toBe(graceEnd);
    // inside the grace window the user keeps everything…
    expect(entitlementsFor(sub, new Date()).entitled).toBe(true);
    expect(entitlementsFor(sub, new Date()).dailyEnergyMax).toBe(PLANS.plus_monthly.energyDaily);
    // …and loses it the moment the retry window closes, with no further webhook needed.
    expect(entitlementsFor(sub, new Date(graceEnd + 1)).entitled).toBe(false);
  });

  it("REFUND revokes immediately and claws the tank back to the free ceiling", async () => {
    const { userId } = await signup(h);
    await postWebhook(makeEvent(userId), { signWith: null });
    expect(await walletFor(userId).then((w) => w?.energy)).toBe(PLANS.plus_monthly.energyDaily);

    const refund = makeEvent(userId, { type: "REFUND", price: PLANS.plus_monthly.usd });
    await postWebhook(refund, { signWith: null });

    const sub = await subFor(userId);
    expect(sub?.active).toBe(false);
    expect(sub?.renewsAt).toBeNull();
    expect(entitlementsFor(sub, new Date()).entitled).toBe(false);
    expect(await walletFor(userId).then((w) => w?.energy)).toBe(ENERGY.FREE_DAILY);
    const row = await prisma.purchase.findUnique({ where: { rcEventId: refund.id } });
    expect(Number(row?.amountUsd)).toBeLessThan(0);
  });

  it("TRANSFER moves the entitlement to the receiving account and deactivates the old one", async () => {
    const from = await signup(h);
    const to = await signup(h);
    await postWebhook(makeEvent(from.userId), { signWith: null });

    await postWebhook(
      makeEvent(to.userId, {
        type: "TRANSFER",
        price: 0,
        transferred_from: [from.userId],
        transferred_to: [to.userId],
      }),
      { signWith: null },
    );

    expect((await subFor(from.userId))?.active).toBe(false);
    const moved = await subFor(to.userId);
    expect(moved?.plan).toBe("plus_monthly");
    expect(moved?.active).toBe(true);
  });

  it("SUBSCRIBER_ALIAS re-points the subscriber id without changing the plan", async () => {
    const { userId } = await signup(h);
    await postWebhook(makeEvent(userId), { signWith: null });
    const before = await subFor(userId);

    await postWebhook(
      makeEvent(userId, { type: "SUBSCRIBER_ALIAS", price: 0, aliases: [userId, "rc_alias_1"] }),
      { signWith: null },
    );
    const after = await subFor(userId);
    expect(after?.plan).toBe(before?.plan);
    expect(after?.active).toBe(before?.active);
    expect(after?.rcSubscriberId).toBe(userId);
  });

  it("an event for an unknown app user is acknowledged but changes nothing", async () => {
    const res = await postWebhook(makeEvent("no-such-user"), { signWith: null });
    expect(res.status).toBe(200);
    expect(res.data.applied).toBe(false);
    expect(res.data.reason).toBe("unknown_user");
    expect(await prisma.purchase.count()).toBe(0);
  });
});

/* ------------------------------------------------------------- idempotency ---- */

describe("webhook idempotency", () => {
  it("replaying the same event id changes nothing", async () => {
    const { token, userId } = await signup(h);
    const event = makeEvent(userId);
    await postWebhook(event, { signWith: null });
    await call(h, "POST", "/v1/__test/set-energy", { token, body: { energy: 2 } });

    const replay = await postWebhook(event, { signWith: null });
    expect(replay.status).toBe(200);
    expect(replay.data.duplicate).toBe(true);
    expect(replay.data.applied).toBe(false);

    // the second delivery must not re-grant energy, and must not duplicate the receipt
    expect(await walletFor(userId).then((w) => w?.energy)).toBe(2);
    expect(await prisma.purchase.count({ where: { rcEventId: event.id } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { source: "purchase" } })).toBe(1);
  });

  it("a refund replayed after the tank refilled does not claw back twice", async () => {
    const { token, userId } = await signup(h);
    await postWebhook(makeEvent(userId), { signWith: null });
    const refund = makeEvent(userId, { type: "REFUND", price: PLANS.plus_monthly.usd });
    await postWebhook(refund, { signWith: null });
    await call(h, "POST", "/v1/__test/set-energy", { token, body: { energy: 9 } });

    await postWebhook(refund, { signWith: null });
    expect(await walletFor(userId).then((w) => w?.energy)).toBe(9);
  });
});

/* ------------------------------------------------------------- entitlements ---- */

describe("entitlements are decided in exactly one place", () => {
  it("dailyMaxFor / adFreeFor agree with entitlementsFor in every state", async () => {
    const now = new Date("2026-09-04T12:00:00.000Z");
    const past = new Date(now.getTime() - hours(1));
    const future = new Date(now.getTime() + hours(1));
    const base = { id: "s", userId: "u", rcSubscriberId: "rc" };

    const rows = [
      null,
      { ...base, plan: "plus_monthly" as const, active: true, renewsAt: future },
      { ...base, plan: "plus_monthly" as const, active: true, renewsAt: past },
      { ...base, plan: "plus_monthly" as const, active: true, renewsAt: null },
      { ...base, plan: "plus_monthly" as const, active: false, renewsAt: future },
      { ...base, plan: "adfree_monthly" as const, active: true, renewsAt: future },
    ];

    for (const row of rows) {
      const ent = entitlementsFor(row, now);
      expect(dailyMaxFor(row, now)).toBe(ent.dailyEnergyMax);
      expect(adFreeFor(row, now)).toBe(ent.adFree);
    }

    // and the values themselves are the product rules
    expect(entitlementsFor(rows[1] ?? null, now).dailyEnergyMax).toBe(PLANS.plus_monthly.energyDaily);
    expect(entitlementsFor(rows[2] ?? null, now).dailyEnergyMax).toBe(ENERGY.FREE_DAILY);
    expect(entitlementsFor(rows[4] ?? null, now).adFree).toBe(false);
    const adfree = entitlementsFor(rows[5] ?? null, now);
    expect(adfree.adFree).toBe(true);
    expect(adfree.proactiveDMs).toBe(false);
    expect(adfree.dailyEnergyMax).toBe(PLANS.adfree_monthly.energyDaily);
  });

  it("the wallet's daily max follows the subscription lapsing", async () => {
    const { token, userId } = await signup(h);
    await postWebhook(makeEvent(userId, { expiration_at_ms: Date.now() + hours(2) }), { signWith: null });

    const before = await call<{ dailyMax: number; adsEnabled: boolean }>(h, "GET", "/v1/wallet", { token });
    expect(before.data.dailyMax).toBe(PLANS.plus_monthly.energyDaily);
    expect(before.data.adsEnabled).toBe(false);

    h.clock.offsetDays(1); // past the period end, with no EXPIRATION webhook at all
    const after = await call<{ dailyMax: number; adsEnabled: boolean }>(h, "GET", "/v1/wallet", { token });
    expect(after.data.dailyMax).toBe(ENERGY.FREE_DAILY);
    expect(after.data.adsEnabled).toBe(true);
    h.clock.reset();
  });
});

/* ------------------------------------------------------------------ mapping ---- */

describe("product and payload mapping", () => {
  it("maps store product ids onto plans", () => {
    expect(planFromProductId("plus_monthly")).toBe("plus_monthly");
    expect(planFromProductId("com.rpgllm.status.plus.yearly")).toBe("plus_yearly");
    expect(planFromProductId("com.rpgllm.status.adfree.monthly")).toBe("adfree_monthly");
    expect(planFromProductId("com.rpgllm.status.coffee.2")).toBeNull();
    expect(planFromProductId(undefined)).toBeNull();
  });

  it("normalises the store name and the amount", () => {
    expect(storeOf({ id: "x", type: "RENEWAL", store: "PLAY_STORE" })).toBe("play");
    expect(storeOf({ id: "x", type: "RENEWAL", store: "APP_STORE" })).toBe("app_store");
    expect(storeOf({ id: "x", type: "RENEWAL" })).toBe("unknown");
    expect(amountUsdOf({ id: "x", type: "REFUND", price: 14.99 })).toBe(-14.99);
    expect(amountUsdOf({ id: "x", type: "EXPIRATION" })).toBe(0);
  });

  it("never grants an entitlement for a consumable", () => {
    const patch = subscriptionPatchFor(
      { id: "x", type: "NON_RENEWING_PURCHASE", product_id: "coffee_2", price: 0.99 },
      null,
      new Date(),
    );
    expect(patch).toBeNull();
  });
});

/* ------------------------------------------------------------------ restore ---- */

describe("restore", () => {
  it("falls back to the local row and says so when no secret key is configured", async () => {
    const { token, userId } = await signup(h);
    await postWebhook(makeEvent(userId), { signWith: null });

    const res = await call<{ subscription: { plan: string; active: boolean } | null; source: string; configured: boolean }>(
      h, "POST", "/v1/billing/restore", { token, body: { rcAppUserId: userId } },
    );
    expect(res.status).toBe(200);
    expect(res.data.source).toBe("local");
    expect(res.data.configured).toBe(false);
    expect(res.data.subscription?.plan).toBe("plus_monthly");
    expect(res.data.subscription?.active).toBe(true);
  });

  it("reports the free state for an account that owns nothing", async () => {
    const { token, userId } = await signup(h);
    const res = await call<{ subscription: unknown; entitlements: { entitled: boolean; dailyEnergyMax: number } }>(
      h, "POST", "/v1/billing/restore", { token, body: { rcAppUserId: userId } },
    );
    expect(res.data.subscription).toBeNull();
    expect(res.data.entitlements.entitled).toBe(false);
    expect(res.data.entitlements.dailyEnergyMax).toBe(ENERGY.FREE_DAILY);
  });

  it("never reconciles against an app-user id the caller made up", async () => {
    const victim = await signup(h);
    await postWebhook(makeEvent(victim.userId), { signWith: null });
    const attacker = await signup(h);

    const res = await call<{ subscription: unknown; matchedRequestedUser: boolean }>(
      h, "POST", "/v1/billing/restore", { token: attacker.token, body: { rcAppUserId: victim.userId } },
    );
    expect(res.data.subscription).toBeNull();
    expect(res.data.matchedRequestedUser).toBe(false);
    expect(await subFor(attacker.userId)).toBeNull();
  });

  it("reconciles the local row from a RevenueCat subscriber payload", async () => {
    const { userId } = await signup(h);
    process.env.REVENUECAT_SECRET_KEY = "sk_test_key";
    const expires = new Date(Date.now() + hours(24 * 20));

    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          subscriber: {
            original_app_user_id: userId,
            entitlements: { plus: { expires_date: expires.toISOString(), product_identifier: "plus_yearly" } },
            subscriptions: { plus_yearly: { expires_date: expires.toISOString(), store: "app_store" } },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const outcome = await restoreFromRevenueCat(prisma, createClock(), userId, [userId], fakeFetch);
    expect(outcome.source).toBe("revenuecat");
    expect(outcome.subscription?.plan).toBe("plus_yearly");
    expect(outcome.subscription?.active).toBe(true);
    expect(outcome.subscription?.renewsAt?.getTime()).toBe(expires.getTime());
  });

  it("clears a stale local subscription when RevenueCat reports no entitlement", async () => {
    const { userId } = await signup(h);
    await postWebhook(makeEvent(userId), { signWith: null });
    process.env.REVENUECAT_SECRET_KEY = "sk_test_key";

    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ subscriber: { entitlements: {}, subscriptions: {} } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    const outcome = await restoreFromRevenueCat(prisma, createClock(), userId, [userId], fakeFetch);
    expect(outcome.source).toBe("revenuecat");
    expect(outcome.subscription?.active).toBe(false);
  });

  it("keeps the local row when RevenueCat cannot be reached", async () => {
    const { userId } = await signup(h);
    await postWebhook(makeEvent(userId), { signWith: null });
    process.env.REVENUECAT_SECRET_KEY = "sk_test_key";

    const fakeFetch: typeof fetch = async () => {
      throw new Error("network down");
    };
    const outcome = await restoreFromRevenueCat(prisma, createClock(), userId, [userId], fakeFetch);
    expect(outcome.source).toBe("local");
    expect(outcome.subscription?.active).toBe(true);
    expect(outcome.note).toBe("RevenueCat is unreachable");
  });

  it("prefers the entitlement that is still live, and honours its grace window", () => {
    const now = new Date("2026-09-04T00:00:00.000Z");
    const payload = RcSubscriberResZ.parse({
      subscriber: {
        entitlements: {
          old: { expires_date: "2026-08-01T00:00:00Z", product_identifier: "plus_weekly" },
          current: { expires_date: "2026-09-03T00:00:00Z", product_identifier: "plus_monthly" },
        },
        subscriptions: {
          plus_monthly: { expires_date: "2026-09-03T00:00:00Z", grace_period_expires_date: "2026-09-10T00:00:00Z" },
        },
      },
    });
    const best = bestEntitlement(payload, now);
    expect(best?.plan).toBe("plus_monthly");
    expect(best?.active).toBe(true);
    expect(best?.expiresAt?.toISOString()).toBe("2026-09-10T00:00:00.000Z");
  });
});

/* ------------------------------------------------------------- dev purchase ---- */

describe("dev-purchase still works (E2E-008)", () => {
  it("activates Plus and fills the tank", async () => {
    const { token, userId } = await signup(h);
    await call(h, "POST", "/v1/__test/set-energy", { token, body: { energy: 0 } });
    const res = await call<{ subscription: { plan: string; active: boolean }; energy: number }>(
      h, "POST", "/v1/billing/dev-purchase", { token, body: { plan: "plus_monthly" } },
    );
    expect(res.status).toBe(200);
    expect(res.data.energy).toBe(PLANS.plus_monthly.energyDaily);
    expect(entitlementsFor(await subFor(userId), new Date()).entitled).toBe(true);
  });
});

/* --------------------------------------------------------- direct unit check ---- */

describe("applyWebhookEvent as a function", () => {
  it("is safe to call twice concurrently for the same event", async () => {
    const { userId } = await signup(h);
    const event = makeEvent(userId);
    const clock = createClock();
    const [a, b] = await Promise.all([
      applyWebhookEvent(prisma, clock, event),
      applyWebhookEvent(prisma, clock, event),
    ]);
    const applied = [a, b].filter((r) => r.applied);
    expect(applied).toHaveLength(1);
    expect(await prisma.purchase.count({ where: { rcEventId: event.id } })).toBe(1);
  });
});
