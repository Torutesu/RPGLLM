/**
 * S1 store-compliance cases (Agent G): report, block, settings/consent/legal, account deletion.
 * App Store Guidelines 1.2 (UGC report+block) and 5.1.1(v) (in-app account deletion), plus the
 * GDPR/APPI consent surface. Helpers local to this file — `fixtures.ts` belongs to Agent D.
 */
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { REPORT_REASONS, T, strings } from "@rpgllm/shared";
import {
  apiUrl, bearer, gotoApp, postAndSettle, postCells, resetDb, ROUTES, signupAndEnter, unwrap,
} from "../fixtures";

interface ReportRow {
  id: string; target: string; targetId: string; reason: string; note: string; snapshot: string; status: string;
  generationId: string | null;
}

/** The moderation queue (TEST_HOOKS-gated read added by Agent G). */
async function openReports(request: APIRequestContext, jwt: string): Promise<ReportRow[]> {
  const res = await request.get(apiUrl("/v1/moderation/reports?status=open"), {
    headers: bearer(jwt), failOnStatusCode: false,
  });
  return (await unwrap<{ reports: ReportRow[] }>(res, "GET /v1/moderation/reports")).reports;
}

const overflowIn = (scope: Locator): Locator => scope.locator('[data-testid^="overflow-"]').first();

/**
 * Who the DM picker offers — the persona's followers. Read from the server rather than from the
 * world seed so the case follows whichever first follower onboarding actually picked.
 */
async function dmFollowers(request: APIRequestContext, jwt: string, personaId: string): Promise<{ handle: string }[]> {
  const res = await request.get(apiUrl(`/v1/dms?personaId=${personaId}`), { headers: bearer(jwt), failOnStatusCode: false });
  return (await unwrap<{ followers: { handle: string }[] }>(res, "GET /v1/dms")).followers;
}

async function personaId(request: APIRequestContext, jwt: string): Promise<string> {
  const res = await request.get(apiUrl("/v1/me"), { headers: bearer(jwt), failOnStatusCode: false });
  const data = await unwrap<{ persona: { id: string } | null }>(res, "GET /v1/me");
  expect(data.persona, "the account must have a persona after onboarding").not.toBeNull();
  return String(data.persona?.id);
}

/** Any feed/thread cell whose text mentions `@handle`. */
const cellsByHandle = (page: Page, handle: string): Locator =>
  postCells(page).filter({ hasText: `@${handle}` });

const REPLY_CELL = `[data-testid^="reply-"]:not([data-testid="${T.replyBtn}"])`;

test.beforeEach(async ({ request }) => {
  await resetDb(request);
});

test("S1-2a: a character reply can be reported from the feed overflow", async ({ page, request }) => {
  test.setTimeout(120_000);
  const account = await signupAndEnter(page, request);
  await postAndSettle(page, "new song Friday");

  const reply = page.locator(REPLY_CELL).first();
  await expect(reply, "a character reply must be in the feed").toBeVisible({ timeout: 15_000 });
  const replyText = ((await reply.getByTestId(T.postText).first().textContent()) ?? "").trim();
  expect(replyText.length, "the reply must have text to snapshot").toBeGreaterThan(0);

  await overflowIn(reply).click();

  // SCR-037: every reason from the shared list is offered
  for (const reason of REPORT_REASONS) {
    await expect(page.getByTestId(T.reportReason(reason)), `reason ${reason} must be offered`).toBeVisible();
  }
  await page.getByTestId(T.reportReason("harassment")).click();
  await page.getByTestId(T.reportNote).fill("this got cruel");
  await page.getByTestId(T.reportSubmit).click();

  await expect(page.getByTestId(T.reportDone)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId(T.reportDone)).toContainText(strings.en.reportDone);

  // the report is stored with a server-side snapshot, not the client's copy
  await expect.poll(async () => (await openReports(request, account.jwt)).length, { timeout: 15_000 }).toBe(1);
  const [row] = await openReports(request, account.jwt);
  expect(row?.reason).toBe("harassment");
  expect(row?.note).toBe("this got cruel");
  expect(row?.status).toBe("open");
  expect(row?.snapshot ?? "", "the snapshot must quote the reported text").toContain(replyText);
});

test("S1-2b: blocking a character removes it from the feed and the DM picker until unblocked", async ({ page, request }) => {
  test.setTimeout(120_000);
  const account = await signupAndEnter(page, request);
  const pid = await personaId(request, account.jwt);
  const followers = await dmFollowers(request, account.jwt, pid);
  expect(followers.length, "onboarding must leave at least one follower").toBeGreaterThan(0);
  const handle = String(followers[0]?.handle).replace(/^@+/, "");

  const authored = cellsByHandle(page, handle);
  await expect(authored.first(), "the first follower posts in the feed").toBeVisible({ timeout: 15_000 });

  // block through the overflow → report screen
  await overflowIn(authored.first()).click();
  await page.getByTestId(T.blockOpen).click();
  await page.getByTestId(T.blockConfirm).click();
  await expect(page.getByText(`${strings.en.blocked} @${handle}`)).toBeVisible({ timeout: 15_000 });

  // ...and the cells are gone, on this render and after a reload (the server filters the read)
  await gotoApp(page, ROUTES.feed);
  await expect(page.getByTestId(T.feedList)).toBeVisible({ timeout: 15_000 });
  // the rest of the world is still there — otherwise "no cells for @handle" would be vacuous
  await expect.poll(() => postCells(page).count(), {
    timeout: 15_000, message: "the feed must still show the other characters",
  }).toBeGreaterThan(0);
  await expect.poll(() => cellsByHandle(page, handle).count(), {
    timeout: 15_000, message: "a blocked character must not appear in the feed",
  }).toBe(0);

  // ...and out of the "New message" picker
  await page.getByTestId(T.tabDms).click();
  await page.getByTestId(T.dmNew).click();
  await expect.poll(() => page.getByTestId(T.dmChar(handle)).count(), {
    timeout: 15_000, message: "a blocked character must not be offered in the DM picker",
  }).toBe(0);

  // unblock from SCR-033 → Safety
  await gotoApp(page, "/settings");
  await page.getByTestId(T.settingsBlocked).click();
  const unblock = page.getByTestId(T.unblock(handle));
  await expect(unblock, "the blocked list must show the character").toBeVisible({ timeout: 15_000 });
  await unblock.click();
  await expect(unblock).toHaveCount(0, { timeout: 15_000 });

  await gotoApp(page, ROUTES.feed);
  await expect(page.getByTestId(T.feedList)).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => cellsByHandle(page, handle).count(), {
    timeout: 15_000, message: "unblocking must bring the character back",
  }).toBeGreaterThan(0);
});

test("S1-3/6: settings exposes the legal links and the analytics consent toggle", async ({ page, request }) => {
  test.setTimeout(120_000);
  await signupAndEnter(page, request);

  await page.getByTestId(T.settingsBtn).click();
  await expect(page.getByTestId(T.settings), "SCR-033 must open from the feed").toBeVisible({ timeout: 15_000 });

  // S1-3 legal links (EULA / privacy / guidelines / support)
  for (const [id, copy] of [
    [T.settingsTerms, strings.en.terms],
    [T.settingsPrivacy, strings.en.privacy],
    [T.settingsGuidelines, strings.en.guidelines],
  ] as const) {
    await expect(page.getByTestId(id), `${id} must render`).toBeVisible();
    await expect(page.getByTestId(id)).toContainText(copy);
  }
  await expect(page.getByTestId(T.settingsManageSub)).toBeVisible();
  await expect(page.getByTestId(T.settingsRestore)).toBeVisible();
  await expect(page.getByTestId(T.settingsExport)).toBeVisible();

  // S1-6 consent: off by default for a fresh adult account, on after the toggle
  // The label comes from i18n (`off`/`on`), not a hardcoded literal, so assert against the strings.
  const toggle = page.getByTestId(T.settingsConsent);
  await expect(toggle).toContainText(strings.en.off);
  const consent = page.waitForResponse(
    (r) => r.url().includes("/v1/account/consent") && r.request().method() === "POST",
    { timeout: 20_000 },
  );
  await toggle.click();
  const res = await consent;
  expect(res.status(), "POST /v1/account/consent").toBe(200);
  expect(await unwrap<{ analytics: boolean; locked: boolean }>(res, "consent")).toEqual({ analytics: true, locked: false });
  await expect(toggle).toContainText(strings.en.on);
});

test("S1-1: the account can be deleted in-app and the session stops working", async ({ page, request }) => {
  test.setTimeout(120_000);
  const account = await signupAndEnter(page, request);

  await page.getByTestId(T.settingsBtn).click();
  await expect(page.getByTestId(T.settings)).toBeVisible({ timeout: 15_000 });
  await page.getByTestId(T.settingsDelete).click();

  const input = page.getByTestId(T.deleteConfirmInput);
  await expect(input, "deletion must require typing DELETE").toBeVisible({ timeout: 15_000 });
  const confirm = page.getByTestId(T.deleteConfirm);
  await expect(confirm, "the confirm button stays disabled until DELETE is typed").toBeDisabled();
  await input.fill("DELETE");
  await confirm.click();

  await expect(page.getByTestId(T.deleteDone)).toBeVisible({ timeout: 15_000 });

  // the app returns to SCR-002 and forgets the session
  await expect(page.getByTestId(T.authEmailBtn), "the app must return to the auth screen").toBeVisible({ timeout: 15_000 });

  // the old token is refused (410 ACCOUNT_DELETED)
  const refused = await request.get(apiUrl("/v1/account/export"), { headers: bearer(account.jwt), failOnStatusCode: false });
  expect(refused.status()).toBe(410);
  expect((JSON.parse(await refused.text()) as { error: { code: string } }).error.code).toBe("ACCOUNT_DELETED");
});
