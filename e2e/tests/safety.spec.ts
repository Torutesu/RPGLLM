import { expect, test } from "@playwright/test";
import { SAFETY_BLOCK_TEST_PHRASES, strings, T } from "@rpgllm/shared";
import {
  apiSignup, badgeEnergy, cellsOfKind, enterWorld, generations, loginInBrowser, openComposer,
  reactionCount, resetDb, setEnergy, setLlmMode, submitComposer, typeInComposer, userPostCell,
  wallet,
} from "../fixtures";

test.beforeEach(async ({ request }) => {
  await resetDb(request);
});

test.afterEach(async ({ request }) => {
  await setLlmMode(request, "replay");
});

test("E2E-009: blocked input is refused and costs no energy", async ({ page, request }) => {
  test.setTimeout(180_000);

  const account = await apiSignup(request, { locale: "en" });
  await loginInBrowser(page, account.jwt);
  await enterWorld(page);
  await setEnergy(request, account.jwt, 5);
  await expect.poll(() => badgeEnergy(page), { timeout: 15_000 }).toBe(5);

  await openComposer(page);
  const error = page.getByTestId(T.safetyError);

  // every phrase in the shared block list — EN and JA alike
  for (const phrase of SAFETY_BLOCK_TEST_PHRASES) {
    await typeInComposer(page, phrase);
    const pending = page.waitForResponse(
      (r) => /\/v1\/posts(\?|$)/.test(r.url()) && r.request().method() === "POST",
      { timeout: 30_000 },
    );
    await submitComposer(page);
    const res = await pending;
    expect(res.status(), `POST /v1/posts must be 422 for: "${phrase}"`).toBe(422);
    const body = JSON.parse(await res.text()) as { error?: { code?: string } | null };
    expect(body.error?.code, `error code for: "${phrase}"`).toBe("SAFETY_BLOCKED");

    await expect(error, `inline guideline notice for: "${phrase}"`).toBeVisible({ timeout: 10_000 });
    await expect(error).toContainText(strings.en.safetyBlocked);
    await typeInComposer(page, "");
  }

  await page.getByTestId(T.composeCancel).click();
  await expect(page.getByTestId(T.composeInput)).toBeHidden();

  // nothing was created and nothing was spent
  await expect(cellsOfKind(page, "user"), "no post is created by a blocked action").toHaveCount(0);
  expect((await wallet(request, account.jwt)).energy, "energy is untouched by blocked input").toBe(5);
  await expect.poll(() => badgeEnergy(page), { timeout: 10_000 }).toBe(5);

  // one G8 block verdict logged per attempt
  const blocked = (await generations(request, account.jwt, { generator: "G8" }))
    .filter((l) => l.safetyVerdict === "block");
  expect(blocked.length, "one G8 GenerationLog with verdict=block per blocked attempt")
    .toBe(SAFETY_BLOCK_TEST_PHRASES.length);
});

test("E2E-010: a total LLM outage degrades gracefully and is never charged", async ({ page, request }) => {
  const account = await apiSignup(request, { locale: "en" });
  await loginInBrowser(page, account.jwt);
  await enterWorld(page);

  const energyBefore = (await wallet(request, account.jwt)).energy;
  expect(energyBefore).toBe(10);
  const reactionsBefore = await reactionCount(page);

  await setLlmMode(request, "fail");

  const text = "everything is fine";
  await openComposer(page);
  await typeInComposer(page, text);
  await submitComposer(page);

  // the post itself is still created
  const cell = userPostCell(page, text);
  await expect(cell, "the user post survives the outage").toBeVisible({ timeout: 20_000 });
  await expect(cell.getByTestId(T.postKind("user"))).toBeVisible();

  // canned fallback replies + the fallback notice
  await expect(page.getByTestId(T.fallbackToast), "a fallback toast tells the user the world lagged")
    .toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId(T.fallbackToast)).toContainText(strings.en.fallbackNotice);
  await expect
    .poll(() => reactionCount(page), { timeout: 20_000, message: "canned character replies still appear" })
    .toBeGreaterThan(reactionsBefore);

  // and the action is refunded
  await expect.poll(() => badgeEnergy(page), { timeout: 20_000, message: "no energy is charged on fallback" })
    .toBe(energyBefore);
  expect((await wallet(request, account.jwt)).energy, "/v1/wallet is unchanged").toBe(energyBefore);
});
