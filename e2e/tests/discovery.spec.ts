import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { T } from "@rpgllm/shared";
import {
  apiUrl, bearer, browserToken, dismissStatCard, gotoApp, postAndSettle, resetDb, ROUTES,
  setEnergy, signupAndEnter, type Account,
} from "../fixtures";

/**
 * Agent K — feed & discovery (SCR-046 Explore, SCR-047 character pages, the rewritten SCR-010).
 *
 * The MVP feed was a wall of same-sized text with no sense of a world around it. These cases hold
 * the three things that changed: the feed knows which story it is in and what is loud in it,
 * every post carries a picture often enough to have rhythm, and every character is a place you can
 * go rather than a name on a screen.
 */

const EXPLORE = "/explore";

/** The header, the strip and the world chip are all in the feed's own header block. */
const feedHeader = (page: Page) => page.getByTestId(T.feedHeader);

/** Reads `/v1/trending` with the browser's own bearer, so a case can name a real topic. */
async function trendingFor(page: Page): Promise<{
  topics: { label: string; posts: number; heat: number; postId: string | null }[];
  risingCharacters: { handle: string; displayName: string; delta: number }[];
  yourRank: { percentile: number; followers: number; trending: boolean };
}> {
  const jwt = await browserToken(page);
  const res = await page.request.get(apiUrl("/v1/trending"), { headers: jwt ? bearer(jwt) : {} });
  expect(res.ok(), "GET /v1/trending must answer").toBeTruthy();
  return ((await res.json()) as { data: Awaited<ReturnType<typeof trendingFor>> }).data;
}

/** Enough posts that the world has something to trend on and enough cells to have a rhythm. */
async function liveInTheWorld(page: Page, request: APIRequestContext, account: Account): Promise<void> {
  await setEnergy(request, account.jwt, 20);
  await page.reload();
  await expect(page.getByTestId(T.feedList)).toBeVisible({ timeout: 15_000 });
  for (const text of [
    "the second chorus is the whole song",
    "the second chorus again, sorry",
    "midnight rehearsal ran long",
  ]) {
    await postAndSettle(page, text);
  }
}

test.beforeEach(async ({ request }) => {
  await resetDb(request);
});

test("DISC-001: the feed says which world you are in and what is loud in it", async ({ page, request }) => {
  const account = await signupAndEnter(page, request);
  await liveInTheWorld(page, request, account);

  // The header survives the rewrite with everything the old one had, plus the world.
  await expect(feedHeader(page), "SCR-010 must have a real header").toBeVisible();
  await expect(page.getByTestId(T.worldChip), "the world chip tells you which story you are in").toBeVisible();
  await expect(page.getByTestId(T.energyBadge)).toBeVisible();
  await expect(page.getByTestId(T.settingsBtn)).toBeVisible();
  await expect(page.getByTestId(T.composeFab)).toBeVisible();

  // Every cell is timestamped — the single cheapest signal that a feed is alive.
  await expect.poll(() => page.getByTestId(T.postTime).count(), {
    timeout: 15_000, message: "posts must carry a relative timestamp",
  }).toBeGreaterThan(0);

  // The trending strip is built from the world's own text.
  const trending = await trendingFor(page);
  expect(trending.topics.length, "posting about one thing twice must produce a topic").toBeGreaterThan(0);
  await expect(feedHeader(page).getByTestId(T.trendingList)).toBeVisible({ timeout: 15_000 });
  await expect(feedHeader(page).getByTestId(T.trendingTopic(trending.topics[0]!.label))).toBeVisible();
});

test("DISC-002: posts carry procedural media, and it is the same picture on every render", async ({ page, request }) => {
  const account = await signupAndEnter(page, request);
  await liveInTheWorld(page, request, account);

  const media = page.locator('[data-testid^="post-media-"]');
  await expect.poll(() => media.count(), {
    timeout: 20_000,
    message: "the feed must carry at least one picture — that is what stops it being a wall of text",
  }).toBeGreaterThan(0);

  const first = media.first();
  const id = await first.getAttribute("data-testid");
  expect(id).toBeTruthy();

  // Media is drawn from the post id alone, so a reload must produce the identical element.
  await gotoApp(page, ROUTES.feed);
  await expect(page.getByTestId(T.feedList)).toBeVisible({ timeout: 15_000 });
  await expect(
    page.locator(`[data-testid="${id}"]`),
    "the same post must draw the same picture after a reload",
  ).toHaveCount(1, { timeout: 15_000 });
});

test("DISC-003: tapping a trending topic filters the feed, and tapping it again restores it", async ({ page, request }) => {
  const account = await signupAndEnter(page, request);
  await liveInTheWorld(page, request, account);

  const trending = await trendingFor(page);
  const topic = trending.topics.find((t) => t.posts >= 2) ?? trending.topics[0];
  expect(topic, "the world must be talking about something").toBeTruthy();

  const cells = page.locator('[data-testid^="post-"]:not([data-testid^="post-kind-"])'
    + ':not([data-testid="post-text"]):not([data-testid="post-author"])'
    + ':not([data-testid="post-time"]):not([data-testid^="post-media-"])');
  const before = await cells.count();
  expect(before).toBeGreaterThan(0);

  const chip = feedHeader(page).getByTestId(T.trendingTopic(topic!.label));
  await chip.click();
  await expect.poll(() => cells.count(), {
    timeout: 10_000, message: "a topic filter must narrow the feed",
  }).toBeLessThan(before);
  await expect.poll(() => cells.count()).toBeGreaterThan(0);

  await chip.click();
  await expect.poll(() => cells.count(), {
    timeout: 10_000, message: "tapping the topic again must restore the whole feed",
  }).toBe(before);
});

test("DISC-004: Explore ranks you in the world and shows who is rising with you", async ({ page, request }) => {
  const account = await signupAndEnter(page, request);
  await liveInTheWorld(page, request, account);

  await page.getByTestId(T.tabExplore).click();
  await expect(page, "the Explore tab must open SCR-046").toHaveURL(new RegExp(EXPLORE), { timeout: 15_000 });

  const rank = page.getByTestId(T.trendingRank);
  await expect(rank, "SCR-046 must tell you where you stand").toBeVisible({ timeout: 15_000 });
  const rankText = (await rank.textContent()) ?? "";
  const percent = Number(rankText.match(/(\d+)\s*%/)?.[1] ?? Number.NaN);
  expect(percent, "the rank must be a real percentile").toBeGreaterThan(0);
  expect(percent, "a new account is small, but never dead last in its own world").toBeLessThan(100);

  const trending = await trendingFor(page);
  expect(trending.risingCharacters.length, "the cast must have opinions about you by now").toBeGreaterThan(0);
  // Explore is pushed over the feed, which stays mounted underneath — so the strip's ids appear
  // twice in the DOM and the Explore copy is the later one.
  await expect(page.getByTestId(T.trendingList).last()).toBeVisible();
  await expect(page.getByTestId(T.trendingTopic(trending.topics[0]!.label)).last()).toBeVisible();

  // The rising rail is the way into a character's page.
  const rising = trending.risingCharacters[0]!;
  const railCard = page.getByTestId(T.risingCharacter(rising.handle));
  await railCard.scrollIntoViewIfNeeded();
  await railCard.click();
  await expect(page).toHaveURL(new RegExp(`/character/${rising.handle}`), { timeout: 15_000 });
  await expect(page.getByTestId(T.characterProfile)).toBeVisible({ timeout: 15_000 });
});

test("DISC-005: a character has a page — bio, whether they follow you, their posts, and block", async ({ page, request }) => {
  const account = await signupAndEnter(page, request);
  await liveInTheWorld(page, request, account);

  const trending = await trendingFor(page);
  const who = trending.risingCharacters[0]!;

  await gotoApp(page, `/character/${who.handle}`);
  const profile = page.getByTestId(T.characterProfile);
  await expect(profile, "SCR-047 must open by handle").toBeVisible({ timeout: 15_000 });
  await expect(profile).toContainText(who.displayName);
  await expect(profile).toContainText(`@${who.handle}`);
  await expect(page.getByTestId(T.characterFollowState), "the page must say whether they follow you")
    .toBeVisible();

  const posts = page.getByTestId(T.characterPosts);
  await expect(posts).toBeVisible();
  await expect.poll(() => posts.locator('[data-testid^="post-"]').count(), {
    timeout: 15_000, message: "a character's page must show what they have been saying",
  }).toBeGreaterThan(0);

  // Blocking from the page empties it, and the server keeps them out of the feed afterwards.
  await page.getByRole("button", { name: /block/i }).first().click();
  await expect.poll(() => posts.locator('[data-testid^="post-"]').count(), {
    timeout: 15_000, message: "a blocked character keeps their page but loses their posts",
  }).toBe(0);

  await gotoApp(page, ROUTES.feed);
  await expect(page.getByTestId(T.feedList)).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.locator('[data-testid^="post-"]').filter({ hasText: `@${who.handle}` }).count(), {
    timeout: 15_000, message: "a blocked character must be gone from the feed",
  }).toBe(0);
});

test("DISC-006: tapping an author's avatar in the feed opens their page", async ({ page, request }) => {
  const account = await signupAndEnter(page, request);
  await dismissStatCard(page, 3_000);

  const trending = await trendingFor(page);
  const who = trending.risingCharacters[0]!;
  const link = page.getByRole("button", { name: new RegExp(`@${who.handle}$`) }).first();
  await expect(link, "every character in the feed must be a door to their page").toBeVisible({ timeout: 15_000 });
  await link.click();

  await expect(page).toHaveURL(new RegExp(`/character/${who.handle}`), { timeout: 15_000 });
  await expect(page.getByTestId(T.characterProfile)).toBeVisible({ timeout: 15_000 });
});
