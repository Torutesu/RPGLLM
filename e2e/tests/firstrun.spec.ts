import { expect, test, type Page } from "@playwright/test";
import { strings, T } from "@rpgllm/shared";
import {
  apiSignup, enterWorld, gotoApp, loginInBrowser, resetDb, ROUTES, WORLD_SLUG, worldPresets,
} from "../fixtures";

/**
 * Agent M — the first 90 seconds (SCR-002 → SCR-003 → SCR-004/005 → SCR-006 → SCR-010).
 *
 * These cases pin the two things the redesign must never break: the cold open above the sign-in
 * must never block the sign-in, and the "3 taps into the world" path must still finish in the few
 * seconds the P0 cases allow — including the custom-persona detour that E2E-002 skips.
 */

const INTRO_KEY = "rpgllm.introSeen";

const introSeen = (page: Page): Promise<string | null> =>
  page.evaluate((k: string) => {
    try {
      return window.localStorage.getItem(k);
    } catch {
      return null;
    }
  }, INTRO_KEY);

test.beforeEach(async ({ request }) => {
  await resetDb(request);
});

test("M-001: the cold open plays above a sign-in that is never blocked", async ({ page }) => {
  await gotoApp(page, ROUTES.auth);

  // The CTA is reachable immediately — the deck is above the fold, not an overlay.
  const cta = page.getByTestId(T.authEmailBtn);
  await expect(cta, "SCR-002 must offer email sign-in on arrival").toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(strings.en.tagline, { exact: true }), "the promise line").toBeVisible();

  // Slide 1 is on screen, and the deck advances on its own to slide 2.
  await expect(page.getByText(strings.en.whoToPlay, { exact: true })).toBeVisible();
  await expect(page.getByText(strings.en.remembers, { exact: true }), "the deck auto-advances")
    .toBeVisible({ timeout: 15_000 });

  // …and the sign-in still works while it runs.
  await cta.click();
  await expect(page.getByTestId(T.authEmailInput)).toBeVisible();
  await expect(page.getByTestId(T.authCodeInput)).toBeVisible();
  await expect(page.getByTestId(T.authSubmit)).toBeEnabled();
});

test("M-002: the intro is remembered, and a returning visitor still lands on the sign-in", async ({ page }) => {
  await gotoApp(page, ROUTES.auth);
  await expect(page.getByTestId(T.authEmailBtn)).toBeVisible({ timeout: 15_000 });

  await expect
    .poll(() => introSeen(page), { timeout: 20_000, message: "the deck must record that it was watched" })
    .toBe("1");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId(T.authEmailBtn), "second visit still opens on the sign-in")
    .toBeVisible({ timeout: 15_000 });
  // Compact deck: only the first slide, and it does not advance any more.
  await expect(page.getByText(strings.en.remembers, { exact: true })).toHaveCount(0);
  await expect(await introSeen(page)).toBe("1");
});

test("M-003: the sign-in speaks the chosen language", async ({ page }) => {
  await gotoApp(page, ROUTES.auth);
  await expect(page.getByTestId(T.authEmailBtn)).toBeVisible({ timeout: 15_000 });

  await page.getByTestId(T.localeToggle).click();
  await expect(page.getByTestId(T.authEmailBtn), "the CTA is translated")
    .toContainText(strings.ja.continueWithEmail);
  await expect(page.getByText(strings.ja.tagline, { exact: true })).toBeVisible();
});

test("M-004: build your own persona, then enter the world", async ({ page, request }) => {
  const account = await apiSignup(request, { locale: "en" });
  await loginInBrowser(page, account.jwt);

  await gotoApp(page, ROUTES.scenario);
  const card = page.getByTestId(T.worldCard(WORLD_SLUG));
  await expect(card, "SCR-003 must offer the preset worlds").toBeVisible({ timeout: 15_000 });
  await card.click();

  await page.getByTestId(T.personaCreateOwn).click();

  const handle = page.getByTestId(T.personaHandleInput);
  await expect(handle, "SCR-005 must open the editor").toBeVisible({ timeout: 15_000 });

  // A taken handle is called out; a free one is confirmed.
  const presets = await worldPresets(page, WORLD_SLUG);
  if (presets.personaHandle) {
    await handle.fill(presets.personaHandle);
    await expect(page.getByText(strings.en.handleTaken, { exact: true }), "a taken handle is refused")
      .toBeVisible({ timeout: 15_000 });
  }
  await handle.fill("mynewname");
  await expect(page.getByText(strings.en.handleAvailable, { exact: true }), "a free handle is confirmed")
    .toBeVisible({ timeout: 15_000 });

  await page.getByTestId(T.personaNameInput).fill("Nova Reyes");
  await page.getByTestId(T.personaBioInput).fill("still deciding who to be");
  await page.getByTestId(T.personaSave).click();

  const followerHandle = presets.followerHandle;
  expect(followerHandle, "the world must offer a first follower").toBeTruthy();
  const follower = page.getByTestId(T.follower(String(followerHandle)));
  await expect(follower, "SCR-006 must offer the first-follower cards").toBeVisible({ timeout: 15_000 });
  await follower.click();

  // Choosing one previews what changes.
  await expect(page.getByText(strings.en.follows, { exact: false }).first()).toBeVisible();

  await page.getByTestId(T.enterWorld).click();
  await expect(page.getByTestId(T.feedList), "the feed must arrive within 10s of Enter the world")
    .toBeVisible({ timeout: 10_000 });
  // The themed overlay is a beat, not a gate: it is gone the moment the feed is up.
  await expect(page.getByTestId(T.worldLoading)).toHaveCount(0);
});

test("M-005: the preset path still enters the world in three taps", async ({ page, request }) => {
  const account = await apiSignup(request, { locale: "en" });
  await loginInBrowser(page, account.jwt);
  await enterWorld(page);
  await expect(page.getByTestId(T.feedList)).toBeVisible();
  await expect(page.getByTestId(T.worldLoading)).toHaveCount(0);
});
