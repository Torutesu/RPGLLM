import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { PACING, T } from "@rpgllm/shared";
import {
  apiSignup, assignments, badgeEnergy, dismissStatCard, enterWorld, expectBadgeEnergy,
  expectWalletEnergy, FIRST_FOLLOWER, FIRST_POST_TEXT, firstPostFlow, generations, gotoApp,
  loginInBrowser, post, postAndSettle, postCells, postDetail, rateDownFor, repliesBy, replyButton,
  replyCellById, resetDb, ROUTES, submitComposer, typeInComposer, userPostCell,
  type Account, type ApiPost,
} from "../fixtures";

test.beforeEach(async ({ request }) => {
  await resetDb(request);
});

/** The E2E-002 prelude that every case in this file starts from. */
async function enterPopstarEra(page: Page, request: APIRequestContext): Promise<Account> {
  const account = await apiSignup(request, { locale: "en" });
  await loginInBrowser(page, account.jwt);
  await enterWorld(page);
  return account;
}

test("E2E-003: the first post streams replies and shows the stat card", async ({ page, request }) => {
  const account = await enterPopstarEra(page, request);

  const postId = await firstPostFlow(page, FIRST_POST_TEXT);
  expect(postId, "the new post must have an id").toBeTruthy();

  await dismissStatCard(page);
  await expectBadgeEnergy(page, 9);
  await expectWalletEnergy(request, account.jwt, 9);
});

test("E2E-004: replying in a thread gets a response", async ({ page, request }) => {
  const account = await enterPopstarEra(page, request);

  // --- E2E-003 ---
  const postId = await firstPostFlow(page, FIRST_POST_TEXT);
  await dismissStatCard(page);
  await expectBadgeEnergy(page, 9);

  // --- open the post (SCR-012) ---
  await userPostCell(page, FIRST_POST_TEXT).getByTestId(T.postText).first().click();
  await expect(page, "tapping a post cell opens SCR-012")
    .toHaveURL(new RegExp(`/post/${postId}`), { timeout: 15_000 });

  const bea = repliesBy(page, FIRST_FOLLOWER);
  await expect(bea, `@${FIRST_FOLLOWER} must be among the replies`).not.toHaveCount(0, { timeout: 15_000 });
  const beaBefore = await bea.count();

  // --- reply to that reply ---
  await (await replyButton(page, bea.first())).click();
  await expect(page.getByTestId(T.composeInput), "SCR-011 opens with a parentId").toBeVisible();
  await typeInComposer(page, "see you opening night");
  await submitComposer(page);

  await expect
    .poll(() => repliesBy(page, FIRST_FOLLOWER).count(), {
      timeout: 15_000,
      message: `@${FIRST_FOLLOWER} must answer in the thread`,
    })
    .toBeGreaterThan(beaBefore);

  await dismissStatCard(page);
  await expectWalletEnergy(request, account.jwt, 8);
});

test("E2E-005: the 8th action raises an event whose choice produces a result and deltas", async ({ page, request }) => {
  test.slow();
  const account = await enterPopstarEra(page, request);

  // 7 actions
  for (let i = 1; i <= PACING.EVENT_PREFETCH_AT; i++) {
    await postAndSettle(page, `studio day ${i}`);
    await expectBadgeEnergy(page, 10 - i);
  }

  // the 8th action raises the event
  await post(page, "the album is done");
  await dismissStatCard(page);
  await expectBadgeEnergy(page, 10 - PACING.EVENT_EVERY);

  const banner = page.getByTestId(T.eventBanner);
  await expect(banner, "an event banner must be pinned to the feed after 8 actions")
    .toBeVisible({ timeout: 20_000 });
  await banner.click();

  await expect(page.getByTestId(T.eventCard), "SCR-014 event card").toBeVisible();
  await expect(page.getByTestId(T.eventPrompt)).toHaveText(/\S/);
  for (const i of [0, 1, 2]) await expect(page.getByTestId(T.eventChoice(i))).toBeVisible();

  const energyBefore = await badgeEnergy(page);

  // "Drop receipts"
  await page.getByTestId(T.eventChoice(1)).click();
  await expect(page.getByTestId(T.statCard), "the pre-generated result must show within 1s")
    .toBeVisible({ timeout: 1_000 });
  await expect(page.getByTestId(T.statNarrative)).toHaveText(/\S/);

  await page.getByTestId(T.statContinue).click();
  await expect(page.getByTestId(T.statCard)).toBeHidden();

  await expect(
    postCells(page).first().getByTestId(T.postKind("news")),
    "a @gmz news post must sit at the top of the feed",
  ).toBeVisible({ timeout: 20_000 });

  await expectBadgeEnergy(page, energyBefore - 1);
  await expectWalletEnergy(request, account.jwt, energyBefore - 1);
});

test("E2E-013: every action leaves a GenerationLog and an experiment assignment", async ({ page, request }) => {
  const account = await enterPopstarEra(page, request);

  // --- E2E-003 ---
  const postId = await firstPostFlow(page, FIRST_POST_TEXT);
  await dismissStatCard(page);
  await expectBadgeEnergy(page, 9);

  const assigned = await assignments(request, account.jwt);
  expect(Object.keys(assigned).length, "GET /v1/experiments/assignments must not be empty")
    .toBeGreaterThan(0);

  const detail = await postDetail(request, account.jwt, postId);
  const replies = detail.replies.filter((r: ApiPost) => r.kind === "character");
  expect(replies.length, "the post must have character replies").toBeGreaterThanOrEqual(2);
  for (const reply of replies) {
    expect(reply.generationId, `reply ${reply.id} must carry its generationId`).toBeTruthy();
  }

  const g1 = (await generations(request, account.jwt, { postId })).filter((l) => l.generator === "G1");
  expect(g1.length, "exactly one G1 GenerationLog for the post").toBe(1);

  const log = g1[0];
  if (!log) throw new Error("unreachable: G1 log asserted above");
  expect(log.inputTokens, "inputTokens").toBeGreaterThan(0);
  expect(log.outputTokens, "outputTokens").toBeGreaterThan(0);
  expect(log.cacheReadTokens, "cacheReadTokens").toBeGreaterThanOrEqual(0);
  expect(log.cacheWriteTokens, "cacheWriteTokens").toBeGreaterThanOrEqual(0);
  expect(Number(log.costUsd), "costUsd must be priced even in replay mode").toBeGreaterThan(0);
  expect(Object.values(assigned), "variantId must match the user's assignment").toContain(log.variantId);
});

test("E2E-014: 👎 replaces the reply using a higher tier", async ({ page, request }) => {
  const account = await enterPopstarEra(page, request);

  // --- E2E-003 ---
  const postId = await firstPostFlow(page, FIRST_POST_TEXT);
  await dismissStatCard(page);

  const detail = await postDetail(request, account.jwt, postId);
  const reply = detail.replies.find((r: ApiPost) => r.kind === "character");
  if (!reply) throw new Error("E2E-003 must leave at least one character reply to rate");

  await gotoApp(page, ROUTES.post(postId));
  const cell = replyCellById(page, reply.id);
  await expect(cell, `reply ${reply.id} must be rendered in the thread`).toBeVisible({ timeout: 15_000 });
  const before = (await cell.innerText()).trim();

  await (await rateDownFor(page, reply)).click();

  await expect
    .poll(async () => (await replyCellById(page, reply.id).innerText().catch(() => "")).trim(), {
      timeout: 2_000,
      intervals: [100, 150, 200, 250, 250, 250, 250, 250],
      message: "the reply must be replaced within 2s",
    })
    .not.toBe(before);

  const escalated = (await generations(request, account.jwt, { postId: reply.id }))
    .filter((l) => l.escalatedFrom);
  expect(escalated.length, "the regeneration must log escalatedFrom").toBeGreaterThan(0);
  expect(
    escalated.some((l) => l.escalatedFrom === reply.generationId),
    `escalatedFrom must point at the original log ${reply.generationId}`,
  ).toBe(true);
});

/* --------------------------------------------------------------- P1 ------- */

// E2E-017: Given E2E-003 / When "Load more reactions" / Then 2 more replies arrive and the
// button disappears (one shot per post).
test.skip("E2E-017 (P1): load more generates extra replies", () => {});

// E2E-020: Given 200 AmbientPost rows / When scrolling 50 items / Then zero online G2 calls
// in GenerationLog.
test.skip("E2E-020 (P1): the ambient pool serves the feed without LLM calls", () => {});
