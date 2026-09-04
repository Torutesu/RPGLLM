import { expect, test, type Page } from "@playwright/test";
import { strings, T } from "@rpgllm/shared";
import {
  dismissStatCard, gotoApp, post, resetDb, ROUTES, signupAndEnter,
} from "../fixtures";

/**
 * Agent L — engagement surfaces (SCR-042 notifications, SCR-044 achievements, the streak).
 *
 * These are the loops the teardown says keep Status users for ~96 minutes a day, and none of them
 * existed in the MVP. Both cases drive the real UI: the badge has to appear because a character
 * actually replied, and the achievement has to unlock because a post was actually made.
 */

const NOTIFICATIONS = "/notifications";
const ACHIEVEMENTS = "/achievements";

/**
 * A notification row carries `data-testid="notif-<id>"`. The screen's own ids share the prefix, so
 * they are excluded explicitly (same trick as `POST_CELL` in the fixtures).
 */
const NOTIF_ROW = [
  '[data-testid^="notif-"]',
  `:not([data-testid="${T.notifBadge}"])`,
  `:not([data-testid="${T.notifList}"])`,
  `:not([data-testid="${T.notifMarkAll}"])`,
  `:not([data-testid="${T.notifEmpty}"])`,
].join("");

/** Posts once and clears SCR-013 so the next tap is not swallowed by the stat card. */
async function postAndSettle(page: Page, text: string): Promise<void> {
  await post(page, text);
  await dismissStatCard(page);
}

test.beforeEach(async ({ request }) => {
  await resetDb(request);
});

test("ENG-001: a reply raises the notifications badge, the tab shows it, and Mark all read clears it", async ({ page, request }) => {
  await signupAndEnter(page, request);

  // No badge before anything has happened to you.
  await expect(page.getByTestId(T.tabNotifications), "the tab bar must offer Notifications")
    .toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId(T.notifBadge)).toHaveCount(0);

  await postAndSettle(page, "new era starts now");

  // The reply fan-out writes notification rows, so the badge appears without a reload.
  const badge = page.getByTestId(T.notifBadge);
  await expect(badge, "an unread badge must appear once the characters react").toBeVisible({ timeout: 20_000 });
  await expect(badge).toHaveText(/\d/);

  await page.getByTestId(T.tabNotifications).click();
  await expect(page.getByTestId(T.notifList), "SCR-042 must open").toBeVisible({ timeout: 15_000 });

  const rows = page.locator(NOTIF_ROW).filter({ hasText: strings.en.repliedToYou });
  await expect(rows.first(), "the reply must be listed as a notification").toBeVisible({ timeout: 15_000 });

  await page.getByTestId(T.notifMarkAll).click();
  await expect(page.getByTestId(T.notifMarkAll), "Mark all read disappears once nothing is unread")
    .toHaveCount(0, { timeout: 15_000 });

  // Back on the feed the badge is gone.
  await gotoApp(page, ROUTES.feed);
  await expect(page.getByTestId(T.feedList)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId(T.notifBadge), "the badge clears after mark-all-read")
    .toHaveCount(0, { timeout: 15_000 });
});

test("ENG-002: the first post unlocks First words on SCR-044", async ({ page, request }) => {
  await signupAndEnter(page, request);
  await postAndSettle(page, "first words, for the record");

  // Reached the way a player reaches it: profile → achievements.
  await page.getByTestId(T.tabProfile).click();
  const open = page.getByTestId(T.achievementsOpen);
  await expect(open, "the profile must link to SCR-044").toBeVisible({ timeout: 15_000 });
  await open.click();

  await expect(page.getByTestId(T.achievementsList), "SCR-044 must open").toBeVisible({ timeout: 15_000 });
  const tile = page.getByTestId(T.achievement("first_post"));
  await expect(tile, "First words must be on the grid").toBeVisible({ timeout: 15_000 });
  await expect(tile).toContainText(strings.en.ach_first_post_title);
  await expect(tile, "and it must be unlocked after the first post").toContainText(strings.en.unlocked);

  // Something still locked keeps its progress bar rather than disappearing.
  const locked = page.getByTestId(T.achievement("posts_100"));
  await expect(locked).toBeVisible();
  await expect(locked).toContainText("%");
});

test("ENG-003: the daily check-in pays a streak that the notifications header shows", async ({ page, request }) => {
  await signupAndEnter(page, request);
  await gotoApp(page, NOTIFICATIONS);

  await expect(page.getByTestId(T.notifList), "SCR-042 must open directly").toBeVisible({ timeout: 15_000 });
  // Day 1 of the ladder is claimed by the first `/v1/me`, so the chip is already lit.
  await expect(page.getByTestId(T.streakChip), "the streak chip must show the running day count")
    .toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId(T.streakChip)).toHaveText(/\d/);
});

test("ENG-004: an empty notifications list explains itself instead of going blank", async ({ page, request }) => {
  await signupAndEnter(page, request);
  await gotoApp(page, NOTIFICATIONS);
  await expect(page.getByTestId(T.notifList)).toBeVisible({ timeout: 15_000 });

  // Onboarding may already have produced rows; when it has not, the empty state must be the copy.
  const empty = page.getByTestId(T.notifEmpty);
  const rows = page.locator(NOTIF_ROW);
  if ((await rows.count()) === 0) {
    await expect(empty).toBeVisible();
    await expect(empty).toContainText(strings.en.notifEmpty);
  } else {
    await expect(empty).toHaveCount(0);
  }
});

test("ENG-005: achievements are reachable directly and show the collection total", async ({ page, request }) => {
  await signupAndEnter(page, request);
  await gotoApp(page, ACHIEVEMENTS);
  await expect(page.getByTestId(T.achievementsList)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId(T.achievementsList)).toContainText(/\d+\s*\/\s*\d+/);
});
