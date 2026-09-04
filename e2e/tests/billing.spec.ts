/**
 * Monetization (Agent P): the paywall, a purchase, restore, and the RevenueCat webhook.
 *
 * E2E-008 already covers "energy 0 → Get Plus → 50 energy" from the energy modal. These cases are
 * about the surfaces around it: what the paywall actually renders, what restore reports, and the
 * server-side entitlement path that a real store purchase arrives through (the webhook), which the
 * UI can never exercise on the web build. Helpers are local to this file — `fixtures.ts` is not
 * this agent's to edit.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";
import { ENERGY, PLANS, T, strings } from "@rpgllm/shared";
import {
  apiSignup, apiUrl, bearer, gotoApp, loginInBrowser, me, resetDb, ROUTES, signupAndEnter,
  unwrap, wallet, type Account,
} from "../fixtures";

test.beforeEach(async ({ request }) => {
  await resetDb(request);
});

/* ------------------------------------------------------------------ helpers ---- */

interface RcEvent {
  id: string;
  type: string;
  app_user_id: string;
  product_id?: string;
  price?: number;
  store?: string;
  expiration_at_ms?: number;
}

/**
 * Posts a RevenueCat event at the real HTTP server. The suite runs with `BILLING_MODE=test` and no
 * `REVENUECAT_WEBHOOK_SECRET`, which is the only configuration in which an unsigned event is
 * accepted (see `services/billing.ts` — production refuses it).
 */
async function webhook(
  request: APIRequestContext,
  event: RcEvent,
): Promise<{ applied: boolean; duplicate: boolean; reason: string | null }> {
  const res = await request.post(apiUrl("/v1/billing/webhook"), {
    data: { api_version: "1.0", event },
    failOnStatusCode: false,
  });
  return await unwrap(res, "POST /v1/billing/webhook");
}

async function userIdOf(request: APIRequestContext, account: Account): Promise<string> {
  return (await me(request, account.jwt)).user.id;
}

const eventId = (): string => `e2e_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

/* -------------------------------------------------------------------- cases ---- */

test("BILL-001: the paywall lists every offered plan with a price, and closes without an error", async ({ page, request }) => {
  const account = await apiSignup(request, { locale: "en" });
  await loginInBrowser(page, account.jwt);
  // No persona needed: SCR-030 is reachable from a cold session, which is also how a deep link
  // into the paywall arrives.

  // The catalogue the client is offered — the paywall must render exactly this, no more, no less.
  const offerings = await unwrap<{ plans: { id: string; usd: number }[]; experiments: { trialDays: number } }>(
    await page.request.get(apiUrl("/v1/billing/offerings"), { headers: bearer(account.jwt), failOnStatusCode: false }),
    "GET /v1/billing/offerings",
  );
  expect(offerings.plans.length, "the paywall needs something to sell").toBeGreaterThan(0);

  await gotoApp(page, "/paywall");
  await expect(page.getByTestId(T.paywall), "SCR-030 must open").toBeVisible({ timeout: 15_000 });

  for (const plan of offerings.plans) {
    const row = page.getByTestId(T.plan(plan.id));
    await expect(row, `plan ${plan.id} must be offered`).toBeVisible({ timeout: 15_000 });
    // On web there is no store, so the row falls back to the catalogue price.
    await expect(row).toContainText(`$${plan.usd.toFixed(2)}`);
  }
  const offeredIds = offerings.plans.map((p) => p.id);
  for (const id of Object.keys(PLANS)) {
    if (offeredIds.includes(id)) continue;
    await expect(page.getByTestId(T.plan(id)), `${id} is not in the offering`).toHaveCount(0);
  }

  await expect(page.getByTestId(T.paywallContinue)).toBeVisible();
  await page.getByTestId(T.paywallClose).click();
  await expect(page.getByTestId(T.paywall), "closing the paywall is not a failure").toBeHidden({ timeout: 15_000 });
  expect((await me(request, account.jwt)).subscription, "closing must not buy anything").toBeNull();
});

test("BILL-002: a purchase from the paywall grants Plus and takes the ads away", async ({ page, request }) => {
  const account = await signupAndEnter(page, request);

  await gotoApp(page, "/paywall");
  await expect(page.getByTestId(T.paywall)).toBeVisible({ timeout: 15_000 });
  await page.getByTestId(T.plan(PLANS.plus_monthly.id)).click();
  await page.getByTestId(T.paywallContinue).click();
  await expect(page.getByTestId(T.paywallSuccess)).toBeVisible({ timeout: 30_000 });

  const after = await me(request, account.jwt);
  expect(after.subscription?.plan).toBe(PLANS.plus_monthly.id);
  expect(after.subscription?.active).toBe(true);
  expect(after.wallet.dailyMax, "Plus raises the daily ceiling").toBe(ENERGY.PLUS_DAILY);
  expect(after.wallet.adsEnabled, "Plus turns ads off").toBe(false);

  // SCR-032 must not offer a rewarded ad any more, and SCR-033 must name the plan.
  await gotoApp(page, ROUTES.energy);
  await expect(page.getByTestId(T.energyModal)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId(T.watchAd), "no rewarded ad for a subscriber").toHaveCount(0);

  await gotoApp(page, "/settings");
  await expect(page.getByTestId(T.settings)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId(T.settings)).toContainText(PLANS.plus_monthly.id);
});

test("BILL-003: restore reports the current state, free or subscribed", async ({ page, request }) => {
  const account = await signupAndEnter(page, request);

  // Nothing to restore yet: the app must say so rather than silently doing nothing.
  await gotoApp(page, "/settings");
  await expect(page.getByTestId(T.settings)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId(T.settings)).toContainText(strings.en.freePlan);
  await page.getByTestId(T.settingsRestore).click();
  await expect(page.getByTestId(T.settings)).toContainText(strings.en.freePlan, { timeout: 15_000 });

  // Now buy, and restore again: it must report the subscription the server actually holds.
  await gotoApp(page, "/paywall");
  await page.getByTestId(T.plan(PLANS.plus_weekly.id)).click();
  await page.getByTestId(T.paywallContinue).click();
  await expect(page.getByTestId(T.paywallSuccess)).toBeVisible({ timeout: 30_000 });

  await gotoApp(page, "/settings");
  await expect(page.getByTestId(T.settings)).toBeVisible({ timeout: 15_000 });
  await page.getByTestId(T.settingsRestore).click();
  await expect(page.getByTestId(T.settings)).toContainText(PLANS.plus_weekly.id, { timeout: 15_000 });

  const restored = await unwrap<{ subscription: { plan: string; active: boolean } | null; source: string }>(
    await request.post(apiUrl("/v1/billing/restore"), {
      headers: bearer(account.jwt),
      data: { rcAppUserId: await userIdOf(request, account) },
      failOnStatusCode: false,
    }),
    "POST /v1/billing/restore",
  );
  expect(restored.subscription?.plan).toBe(PLANS.plus_weekly.id);
  // No REVENUECAT_SECRET_KEY in this environment, so restore is honest about where it looked.
  expect(restored.source).toBe("local");
});

test("BILL-004: a RevenueCat purchase event grants the entitlement, and a replay changes nothing", async ({ request }) => {
  const account = await apiSignup(request, { locale: "en" });
  const userId = await userIdOf(request, account);

  const event: RcEvent = {
    id: eventId(),
    type: "INITIAL_PURCHASE",
    app_user_id: userId,
    product_id: PLANS.plus_monthly.id,
    price: PLANS.plus_monthly.usd,
    store: "APP_STORE",
    expiration_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1000,
  };

  const first = await webhook(request, event);
  expect(first.applied, "the first delivery grants the subscription").toBe(true);

  const granted = await me(request, account.jwt);
  expect(granted.subscription?.plan).toBe(PLANS.plus_monthly.id);
  expect(granted.subscription?.active).toBe(true);
  expect(granted.wallet.adsEnabled).toBe(false);
  expect((await wallet(request, account.jwt)).energy).toBe(ENERGY.PLUS_DAILY);

  // RevenueCat retries; the same event id must be a no-op the second time.
  const replay = await webhook(request, event);
  expect(replay.applied).toBe(false);
  expect(replay.duplicate).toBe(true);

  // A refund revokes on the spot — this is the one event that does not wait for the period end.
  const refund = await webhook(request, {
    id: eventId(),
    type: "REFUND",
    app_user_id: userId,
    product_id: PLANS.plus_monthly.id,
    price: PLANS.plus_monthly.usd,
    store: "APP_STORE",
  });
  expect(refund.applied).toBe(true);

  const revoked = await me(request, account.jwt);
  expect(revoked.subscription?.active).toBe(false);
  expect(revoked.wallet.dailyMax).toBe(ENERGY.FREE_DAILY);
  expect(revoked.wallet.adsEnabled, "ads come back when the entitlement goes").toBe(true);
});
