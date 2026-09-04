import { expect, test } from "@playwright/test";
import { ENERGY, PLANS, T } from "@rpgllm/shared";
import {
  apiSignup, badgeEnergy, dismissStatCard, energyModalValue, enterWorld, expectWalletEnergy, gotoApp,
  loginInBrowser, me, openComposer, openEnergyModal, resetDb, ROUTES, setEnergy, submitComposer,
  timeTravel, typeInComposer, userPostCell, wallet, watchAd, syncWallet
} from "../fixtures";

test.beforeEach(async ({ request }) => {
  await resetDb(request);
});

test("E2E-007: energy 0 → watch an ad → the post goes through", async ({ page, request }) => {
  const account = await apiSignup(request, { locale: "en" });
  await loginInBrowser(page, account.jwt);
  await enterWorld(page);

  await setEnergy(request, account.jwt, 0);

  await syncWallet(page);
  await gotoApp(page, ROUTES.feed);
  await expect.poll(() => badgeEnergy(page), { timeout: 15_000 }).toBe(0);

  // pressing Post with an empty tank opens SCR-032 instead of posting
  const text = "back from the studio";
  await openComposer(page);
  await typeInComposer(page, text);
  await submitComposer(page);
  await expect(page.getByTestId(T.energyModal), "SCR-032 must open when energy is 0")
    .toBeVisible({ timeout: 15_000 });
  expect((await wallet(request, account.jwt)).energy, "nothing is spent while the modal is up").toBe(0);

  const reward = await watchAd(page);
  expect(reward.energy, "a completed test ad grants +1 energy").toBe(ENERGY.AD_REWARD);
  expect(reward.adRewardsToday, "first ad of the day").toBe(1);

  await expect(page.getByTestId(T.energyModal), "the modal closes after the reward").toBeHidden({ timeout: 15_000 });
  await expect(userPostCell(page, text), "the pending post is sent once energy is available")
    .toBeVisible({ timeout: 20_000 });

  await dismissStatCard(page);
  await expectWalletEnergy(request, account.jwt, 0); // +1 from the ad, −1 for the post
});

test("E2E-008: buying Plus grants 50 energy and hides ads", async ({ page, request }) => {
  const account = await apiSignup(request, { locale: "en" });
  await loginInBrowser(page, account.jwt);
  await enterWorld(page);

  await setEnergy(request, account.jwt, 0);

  await syncWallet(page);
  await gotoApp(page, ROUTES.feed);
  await expect.poll(() => badgeEnergy(page), { timeout: 15_000 }).toBe(0);
  expect((await me(request, account.jwt)).subscription?.active ?? false, "not subscribed yet").toBe(false);

  await openEnergyModal(page);
  await page.getByTestId(T.getPlus).click();

  await expect(page.getByTestId(T.paywall), "SCR-030 paywall").toBeVisible({ timeout: 15_000 });
  await page.getByTestId(T.plan(PLANS.plus_monthly.id)).click();
  await page.getByTestId(T.paywallContinue).click();
  await expect(page.getByTestId(T.paywallSuccess), "the test purchase must succeed")
    .toBeVisible({ timeout: 30_000 });

  await expect
    .poll(async () => (await wallet(request, account.jwt)).energy, { timeout: 20_000, message: "Plus tops the tank up" })
    .toBe(ENERGY.PLUS_DAILY);

  const meRes = await me(request, account.jwt);
  expect(meRes.subscription?.active, "/v1/me subscription.active").toBe(true);
  expect(meRes.subscription?.plan).toBe(PLANS.plus_monthly.id);
  expect(meRes.wallet.adsEnabled, "Plus turns ads off").toBe(false);

  await gotoApp(page, ROUTES.energy);
  await expect(page.getByTestId(T.energyModal)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId(T.watchAd), "no rewarded ad for Plus subscribers").toHaveCount(0);
  await expect.poll(() => energyModalValue(page), { timeout: 15_000 }).toBe(ENERGY.PLUS_DAILY);
});

test("E2E-015: the daily refill tops a free tank back up", async ({ page, request }) => {
  const account = await apiSignup(request, { locale: "en" });
  await loginInBrowser(page, account.jwt);
  await enterWorld(page);

  await setEnergy(request, account.jwt, 0);

  await syncWallet(page);
  await expect
    .poll(async () => (await wallet(request, account.jwt)).energy, { timeout: 15_000 })
    .toBe(0);

  await timeTravel(request, 1, account.jwt);

  await gotoApp(page, ROUTES.energy);
  await expect(page.getByTestId(T.energyModal), "SCR-032 Get Energy").toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => energyModalValue(page), { timeout: 20_000, message: "the free daily refill restores 10" })
    .toBe(ENERGY.FREE_DAILY);
  await expect(page.getByTestId(T.refillTimer), "the countdown resets to the next refill")
    .toBeVisible();
  await expect(page.getByTestId(T.refillTimer)).toHaveText(/\S/);

  expect((await wallet(request, account.jwt)).energy).toBe(ENERGY.FREE_DAILY);
});
