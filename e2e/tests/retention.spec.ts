import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { T } from "@rpgllm/shared";
import {
  apiSignup, apiUrl, bearer, enterWorld, FIRST_FOLLOWER, gotoApp, loginInBrowser, me, resetDb,
  ROUTES, unwrap, WORLD_SLUG, worldPresets,
} from "../fixtures";

/**
 * S2 — retention & growth (Agent H). Covers the four surfaces the gap analysis called the
 * "beat Status" list: the offline world director (AIF-001), the profile (SCR-026), the
 * relationship memory ledger (AIF-002) and the referral loop.
 *
 * These are new cases, additive to the 16 P0 ones; nothing here touches the existing specs.
 */

interface RunJobRes {
  ran: string[];
  digest: { considered: number; generated: { digestId: string; postIds: string[] }[]; skipped: number } | null;
}

/**
 * The manual scheduler. There is no cron in this build, so the job that would run overnight is
 * driven explicitly here (`force` skips the 12h away window instead of time-travelling the clock,
 * which is process-wide and would leak into the next case).
 */
async function runJob(
  request: APIRequestContext,
  body: { job: "digest" | "memory" | "ambient" | "all"; personaId?: string; force?: boolean },
): Promise<RunJobRes> {
  const res = await request.post(apiUrl("/v1/__test/run-job"), { data: body, failOnStatusCode: false });
  return unwrap<RunJobRes>(res, `POST /v1/__test/run-job ${body.job}`);
}

async function personaIdOf(request: APIRequestContext, jwt: string): Promise<string> {
  const persona = (await me(request, jwt)).persona;
  expect(persona, "a persona must exist after onboarding").not.toBeNull();
  return persona!.id;
}

/** SCR-020 → SCR-021 with the first follower, as in E2E-006. */
async function openDmWithFollower(page: Page): Promise<string> {
  const presets = await worldPresets(page, WORLD_SLUG);
  const follower = presets.followerHandle ?? FIRST_FOLLOWER;
  await page.getByTestId(T.tabDms).click();
  await page.getByTestId(T.dmNew).click();
  const target = page.getByTestId(T.dmChar(follower));
  await expect(target, `@${follower} must be listed as a follower to message`).toBeVisible({ timeout: 15_000 });
  await target.click();
  await expect(page.getByTestId(T.dmInput), "SCR-021 composer").toBeVisible({ timeout: 15_000 });
  return follower;
}

test.beforeEach(async ({ request }) => {
  await resetDb(request);
});

test("S2-1: the offline director leaves a digest that the feed pins and dismisses", async ({ page, request }) => {
  const account = await apiSignup(request, { locale: "en" });
  await loginInBrowser(page, account.jwt);
  await enterWorld(page);

  const personaId = await personaIdOf(request, account.jwt);
  const job = await runJob(request, { job: "digest", personaId, force: true });
  expect(job.digest?.generated.length, "the director must produce one digest").toBe(1);
  expect(job.digest?.generated[0]?.postIds.length ?? 0, "the world moved while you were away").toBeGreaterThan(0);

  await gotoApp(page, ROUTES.feed);
  const card = page.getByTestId(T.digestCard);
  await expect(card, 'SCR-038 "While you were away" must be pinned above the feed').toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId(T.digestHeadline)).toHaveText(/\S/);
  await expect(page.getByTestId(T.digestBody)).toHaveText(/\S/);

  await page.getByTestId(T.digestDismiss).click();
  await expect(card, "dismissing marks it seen").toBeHidden({ timeout: 15_000 });

  // Seen is durable: it does not come back on the next visit.
  await gotoApp(page, ROUTES.feed);
  await expect(page.getByTestId(T.feedList)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId(T.digestCard)).toBeHidden();

  const digest = await unwrap<{ digest: unknown }>(
    await page.request.get(apiUrl(`/v1/digest?personaId=${personaId}`), { headers: bearer(account.jwt), failOnStatusCode: false }),
    "GET /v1/digest",
  );
  expect(digest.digest, "no unseen digest is waiting anymore").toBeNull();
});

test("S2-6: the profile tab shows level, XP and the persona's posts", async ({ page, request }) => {
  const account = await apiSignup(request, { locale: "en" });
  await loginInBrowser(page, account.jwt);
  await enterWorld(page);

  await page.getByTestId(T.tabProfile).click();
  await expect(page.getByTestId(T.profileHandle), "SCR-026 must show the persona handle").toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId(T.profileHandle)).toHaveText(/@\S+/);
  await expect(page.getByTestId(T.profileLevel), "level is visible progression").toHaveText(/\S/);
  await expect(page.getByTestId(T.profileXp), "XP against the shared curve").toHaveText(/\d+\s*XP/);
  await expect(page.getByTestId(T.profilePosts)).toBeVisible();

  // The cast is listed with a link into the memory ledger.
  const presets = await worldPresets(page, WORLD_SLUG);
  const follower = presets.followerHandle ?? FIRST_FOLLOWER;
  await expect(page.getByTestId(T.profileRelationship(follower))).toBeVisible();
});

test("S2-3: the affinity hearts open the memory ledger, with receipts", async ({ page, request }) => {
  const account = await apiSignup(request, { locale: "en" });
  await loginInBrowser(page, account.jwt);
  await enterWorld(page);

  await openDmWithFollower(page);

  // One exchange leaves a memory note whose source is the message that caused it.
  const said = "the album is done and i cannot sleep";
  await page.getByTestId(T.dmInput).fill(said);
  await page.getByTestId(T.dmSend).click();
  await expect
    .poll(() => page.getByTestId(T.dmBubble).count(), { timeout: 20_000, message: "the character must answer" })
    .toBeGreaterThanOrEqual(2);

  await page.getByTestId(T.memoryOpen).click();

  const ledger = page.getByTestId(T.memoryLedger);
  await expect(ledger, "SCR-039 memory ledger").toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId(T.memorySummary)).toBeVisible();

  const entries = page.locator('[data-testid^="memory-entry-"]');
  await expect
    .poll(() => entries.count(), { timeout: 20_000, message: "the character must remember at least one thing" })
    .toBeGreaterThanOrEqual(1);
  await expect(ledger, "the receipt quotes the line that created the memory").toContainText(said);
});

test("S2-5: a referral code can be read and copied from the invite screen", async ({ page, request }) => {
  const account = await apiSignup(request, { locale: "en" });
  await loginInBrowser(page, account.jwt);
  await enterWorld(page);

  await page.getByTestId(T.tabProfile).click();
  await expect(page.getByTestId(T.referralOpen)).toBeVisible({ timeout: 20_000 });
  await page.getByTestId(T.referralOpen).click();

  const code = page.getByTestId(T.referralCode);
  await expect(code, "SCR-041 must show the account's code").toBeVisible({ timeout: 20_000 });
  await expect(code).toHaveText(/^[A-Z0-9]{8}$/);
  const shown = ((await code.textContent()) ?? "").trim();

  await page.getByTestId(T.referralCopy).click();
  await expect(page.getByTestId(T.referralRedeemInput), "a new account can also redeem one").toBeVisible();

  // The code the screen shows is the one the API issues.
  const referral = await unwrap<{ code: string; link: string }>(
    await page.request.get(apiUrl("/v1/referral"), { headers: bearer(account.jwt), failOnStatusCode: false }),
    "GET /v1/referral",
  );
  expect(referral.code).toBe(shown);
  expect(referral.link).toContain(shown);
});
