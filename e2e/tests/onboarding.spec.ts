import { expect, test } from "@playwright/test";
import { strings, T } from "@rpgllm/shared";
import {
  apiEmailAuth, apiSignup, apiUrl, badgeEnergy, bearer, browserToken, cellsOfKind, dismissStatCard,
  enterWorld, errorOf, expectBadgeEnergy, FIRST_FOLLOWER, firstPostFlow, lastAdRequest, loginInBrowser,
  openComposer, openEnergyModal, randomEmail, reactionCount, resetDb, setAdsMode, setEnergy,
  submitComposer, typeInComposer, uiAgeGate, uiEmailLogin, wallet, yearsAgo, syncWallet
} from "../fixtures";

/** CJK range — enough to prove a reply is Japanese and not the English fixture. */
const JAPANESE = /[぀-ゟ゠-ヿ一-鿿]/;

test.beforeEach(async ({ request }) => {
  await resetDb(request);
});

test("E2E-001: under-13 cannot register", async ({ page, request }) => {
  // (a) UI — SCR-002 shows the blocked screen and goes no further
  await uiEmailLogin(page, randomEmail());
  await uiAgeGate(page, yearsAgo(12));
  const blocked = page.getByTestId(T.ageBlocked);
  await expect(blocked, "SCR-002 blocked screen").toBeVisible({ timeout: 15_000 });
  await expect(blocked).toContainText(strings.en.underAge);
  await expect(page.getByTestId(T.feedList), "no feed for a blocked account").toHaveCount(0);

  const uiJwt = await browserToken(page);
  if (uiJwt) {
    const res = await request.get(apiUrl("/v1/me"), { headers: bearer(uiJwt), failOnStatusCode: false });
    expect(res.status(), "/v1/me stays 401 for the blocked account").toBe(401);
  }

  // (b) API — the age gate rejects with 403 UNDER_13 and /me stays 401
  const jwt = await apiEmailAuth(request, randomEmail());
  const gate = await request.post(apiUrl("/v1/auth/age-gate"), {
    headers: bearer(jwt), data: { birthYear: yearsAgo(12), locale: "en" }, failOnStatusCode: false,
  });
  expect(gate.status(), "POST /v1/auth/age-gate with an under-13 birth year").toBe(403);
  expect((await errorOf(gate))?.code).toBe("UNDER_13");

  const me = await request.get(apiUrl("/v1/me"), { headers: bearer(jwt), failOnStatusCode: false });
  expect(me.status(), "/v1/me is 401 until the age gate passes").toBe(401);
});

test("E2E-002: three taps into the world", async ({ page, request }) => {
  const account = await apiSignup(request, { birthYear: yearsAgo(25), locale: "en" });
  await loginInBrowser(page, account.jwt);

  // Popstar Era → @taytay19 → @hivequeenbea → Enter the world (feed asserted ≤10s inside)
  await enterWorld(page);

  await expect(cellsOfKind(page, "ambient"), "5 ambient posts seed the feed")
    .toHaveCount(5, { timeout: 15_000 });
  await expect(
    cellsOfKind(page, "character").filter({ hasText: FIRST_FOLLOWER }),
    `welcome post from @${FIRST_FOLLOWER}`,
  ).toHaveCount(1);

  await expectBadgeEnergy(page, 10);
  expect((await wallet(request, account.jwt)).energy, "/v1/wallet energy after onboarding").toBe(10);
});

test("E2E-011: Japanese locale renders Japanese UI and replies", async ({ page, request }) => {
  const account = await apiSignup(request, { locale: "ja" });
  await loginInBrowser(page, account.jwt);
  await enterWorld(page);

  // UI labels come from packages/shared/src/i18n/ja.ts
  await expect(page.getByTestId(T.tabFeed), "feed tab label in JA").toContainText(strings.ja.feed);
  await expect(page.getByTestId(T.tabDms), "DMs tab label in JA").toContainText(strings.ja.dms);

  const before = await reactionCount(page);
  await openComposer(page);
  await expect(page.getByTestId(T.composeSubmit), "composer submit label in JA")
    .toContainText(strings.ja.post);
  await typeInComposer(page, "新曲、金曜に出します");
  await submitComposer(page);

  await expect
    .poll(() => reactionCount(page), { timeout: 10_000, message: "a character reply must arrive" })
    .toBeGreaterThanOrEqual(before + 1);

  const replies = await cellsOfKind(page, "character").allInnerTexts();
  expect(
    replies.some((t) => JAPANESE.test(t)),
    `a character reply must be Japanese, got: ${replies.join(" | ")}`,
  ).toBe(true);
});

test("E2E-012: the web browser runs E2E-002 and E2E-003, with no Watch-an-ad button", async ({ page, request }) => {
  // A production web build ships without EXPO_PUBLIC_ADS_MODE. The runtime override
  // (apps/mobile/src/env.ts `globalThis.__ADS_MODE`) reproduces that inside the default `chromium`
  // project, and is a harmless no-op in the optional `web-prod` project (E2E_PROD_WEB_URL).
  await setAdsMode(page, "off");

  const account = await apiSignup(request, { locale: "en" });
  await loginInBrowser(page, account.jwt);

  // --- E2E-002 ---
  await enterWorld(page);
  await expect(cellsOfKind(page, "ambient")).toHaveCount(5, { timeout: 15_000 });
  await expect(cellsOfKind(page, "character").filter({ hasText: FIRST_FOLLOWER })).toHaveCount(1);
  await expectBadgeEnergy(page, 10);

  // --- E2E-003 ---
  await firstPostFlow(page);
  await dismissStatCard(page);
  await expectBadgeEnergy(page, 9);

  // --- SCR-032 has no rewarded-ad entry point on web ---
  await openEnergyModal(page);
  await expect(page.getByTestId(T.watchAd), "Watch an ad must not be shown on web").toHaveCount(0);
  await expect(page.getByTestId(T.getPlus), "Get Plus is still offered").toBeVisible();
});

test("E2E-016: minors get non-personalized ads", async ({ page, request }) => {
  const account = await apiSignup(request, { birthYear: yearsAgo(16), locale: "en" });
  expect(account.isMinor, "a 16-year-old must be flagged isMinor").toBe(true);

  await loginInBrowser(page, account.jwt);
  await enterWorld(page);
  await setEnergy(request, account.jwt, 0);
  await syncWallet(page);
  await expect.poll(() => badgeEnergy(page), { timeout: 15_000 }).toBe(0);

  await openEnergyModal(page);
  await page.getByTestId(T.watchAd).click();

  await expect
    .poll(() => lastAdRequest(page), { timeout: 15_000, message: "the mock ad adapter must record its request" })
    .toBeDefined();
  expect((await lastAdRequest(page))?.npa, "minors must request non-personalized ads").toBe(true);

  expect((await wallet(request, account.jwt)).adPersonalized, "/v1/wallet reports non-personalized ads")
    .toBe(false);
});

/* --------------------------------------------------------------- P1 ------- */

// E2E-019: Given 24h away (digest job) / When launching / Then a "While you were away"
// card plus 5 new posts and 1 DM. Needs the digest job + card testid.
test.skip("E2E-019 (P1): away digest", () => {});
