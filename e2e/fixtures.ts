/**
 * Shared helpers for the E2E suite.
 *
 * Rule of thumb: anything the case under test does not itself assert is done over the API
 * (fast + deterministic); everything the case *is* about is driven through the UI with the
 * ids from `packages/shared/src/testids.ts`.
 */
import { expect, type APIRequestContext, type APIResponse, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { DEV_EMAIL_CODE, T, TEST_AD_TOKEN, type Locale } from "@rpgllm/shared";

export const API_URL = process.env.API_URL ?? "http://localhost:4000";

/** localStorage key the web client keeps the session JWT under (apps/mobile/src/auth/token.ts). */
export const TOKEN_KEY = "rpgllm.jwt";

export const WORLD_SLUG = "popstar-era";
export const PERSONA_HANDLE = "taytay19";
export const FIRST_FOLLOWER = "hivequeenbea";
export const PRESS_HANDLE = "gmz";

export const ROUTES = {
  root: "/",
  auth: "/auth",
  scenario: "/onboarding/scenario",
  feed: "/feed",
  energy: "/energy",
  dms: "/dms",
  post: (id: string) => `/post/${id}`,
} as const;

/* ------------------------------------------------------------------ API ---- */

export const apiUrl = (p: string): string => `${API_URL}${p.startsWith("/") ? p : `/${p}`}`;
export const bearer = (jwt: string): Record<string, string> => ({ authorization: `Bearer ${jwt}` });

export interface ApiError { code: string; message: string }
interface Envelope<T> { data: T; error: ApiError | null }

/** Structural: satisfied by both `APIResponse` (request context) and `Response` (page network). */
export interface ReadableResponse { status(): number; text(): Promise<string> }

export async function unwrap<T>(res: ReadableResponse, what: string): Promise<T> {
  const body = await res.text();
  expect(res.status(), `${what} -> ${res.status()} ${body}`).toBeLessThan(400);
  const json = JSON.parse(body) as Envelope<T>;
  expect(json.error, `${what} returned an error envelope`).toBeNull();
  return json.data;
}

export async function errorOf(res: APIResponse): Promise<ApiError | null> {
  try {
    return (JSON.parse(await res.text()) as Envelope<unknown>).error;
  } catch {
    return null;
  }
}

export interface Wallet {
  energy: number; coffee: number; gems: number; dailyRefillAt: string;
  adRewardsToday: number; adsEnabled: boolean; adPersonalized: boolean; dailyMax: number;
}
export interface Me {
  user: { id: string; locale: Locale; isMinor: boolean; birthYear: number | null };
  wallet: Wallet;
  subscription: { plan: string; active: boolean; renewsAt: string | null } | null;
  persona: { id: string; handle: string; followers: number; aura: number; humor: number; actionCount: number } | null;
}
export interface ApiPost {
  id: string; kind: string; text: string; parentId: string | null;
  author: { handle: string; displayName: string; verified: boolean; isYou: boolean };
  generationId: string | null; createdAt: string;
  replies?: ApiPost[];
}
export interface PostDetail { post: ApiPost; replies: ApiPost[]; moreAvailable: boolean }
export interface GenerationLogRow {
  id: string; generator: string; variantId: string; model: string;
  inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; outputTokens: number;
  costUsd: number | string; escalatedFrom: string | null; safetyVerdict: string | null; createdAt: string;
}

/* --------------------------------------------------------------- signup ---- */

export function randomEmail(): string {
  return `e2e+${randomUUID().slice(0, 8)}@test.local`;
}

/**
 * Email login. `spec/03-api.md` names `POST /auth/:provider` and Agent C pins the verify route to
 * `POST /v1/auth/email`; `packages/shared` also carries `AuthEmailVerifyReqZ`. We try the documented
 * route first and fall back to `/v1/auth/email/verify`, so either naming works.
 */
export async function apiEmailAuth(request: APIRequestContext, email: string): Promise<string> {
  await request.post(apiUrl("/v1/auth/email/start"), { data: { email }, failOnStatusCode: false });
  const tried: string[] = [];
  for (const p of ["/v1/auth/email", "/v1/auth/email/verify"]) {
    const res = await request.post(apiUrl(p), { data: { email, code: DEV_EMAIL_CODE }, failOnStatusCode: false });
    if (res.status() === 404 || res.status() === 405) { tried.push(`${p} -> ${res.status()}`); continue; }
    return (await unwrap<{ jwt: string }>(res, `POST ${p}`)).jwt;
  }
  throw new Error(`no email verify endpoint answered (${tried.join(", ")})`);
}

export interface SignupOptions { email?: string; birthYear?: number; locale?: Locale }
export interface Account { email: string; jwt: string; isMinor: boolean; birthYear: number }

export const yearsAgo = (years: number): number => new Date().getFullYear() - years;

/** Verifies the email code and passes the age gate. Returns the session JWT. */
export async function apiSignup(request: APIRequestContext, opts: SignupOptions = {}): Promise<Account> {
  const email = opts.email ?? randomEmail();
  const locale: Locale = opts.locale ?? "en";
  const birthYear = opts.birthYear ?? yearsAgo(25);
  const jwt = await apiEmailAuth(request, email);
  const res = await request.post(apiUrl("/v1/auth/age-gate"), {
    headers: bearer(jwt), data: { birthYear, locale }, failOnStatusCode: false,
  });
  const { isMinor } = await unwrap<{ isMinor: boolean }>(res, "POST /v1/auth/age-gate");
  return { email, jwt, isMinor, birthYear };
}

/* ------------------------------------------------------------ test hooks ---- */

export async function resetDb(request: APIRequestContext): Promise<void> {
  const res = await request.post(apiUrl("/v1/__test/reset"), { failOnStatusCode: false });
  expect(res.status(), "POST /v1/__test/reset (API needs TEST_HOOKS=1)").toBeLessThan(400);
}

export async function setEnergy(request: APIRequestContext, jwt: string, energy: number): Promise<void> {
  const res = await request.post(apiUrl("/v1/__test/set-energy"), {
    headers: bearer(jwt), data: { energy }, failOnStatusCode: false,
  });
  expect(res.status(), `POST /v1/__test/set-energy {energy:${energy}}`).toBeLessThan(400);
}

/** After changing the wallet through the API, reload the app so SCR-010 shows the server value (the client has no wallet polling). */
export async function syncWallet(page: Page): Promise<void> {
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId(T.feedList), "feed must come back after reload").toBeVisible({ timeout: 15_000 });
}

export async function timeTravel(request: APIRequestContext, days: number, jwt?: string): Promise<void> {
  const res = await request.post(apiUrl("/v1/__test/time-travel"), {
    headers: jwt ? bearer(jwt) : undefined, data: { days }, failOnStatusCode: false,
  });
  expect(res.status(), `POST /v1/__test/time-travel {days:${days}}`).toBeLessThan(400);
}

export type LlmMode = "replay" | "live" | "fail";
export async function setLlmMode(request: APIRequestContext, mode: LlmMode): Promise<void> {
  const res = await request.post(apiUrl("/v1/__test/llm-mode"), { data: { mode }, failOnStatusCode: false });
  expect(res.status(), `POST /v1/__test/llm-mode {mode:"${mode}"}`).toBeLessThan(400);
}

/**
 * TEST_HOOKS-only view of GenerationLog. Requested from Agent A in build-notes.md — there is no
 * public endpoint for logs and E2E-009/013/014 assert on them.
 */
export async function generations(
  request: APIRequestContext, jwt: string, query: { postId?: string; generator?: string; userId?: string },
): Promise<GenerationLogRow[]> {
  const qs = new URLSearchParams(Object.entries(query).filter((e): e is [string, string] => e[1] !== undefined));
  const res = await request.get(apiUrl(`/v1/__test/generations?${qs.toString()}`), {
    headers: bearer(jwt), failOnStatusCode: false,
  });
  const data = await unwrap<{ logs: GenerationLogRow[] } | GenerationLogRow[]>(res, `GET /v1/__test/generations?${qs}`);
  return Array.isArray(data) ? data : data.logs;
}

/* ------------------------------------------------------------- API reads ---- */

export async function me(request: APIRequestContext, jwt: string): Promise<Me> {
  return unwrap<Me>(await request.get(apiUrl("/v1/me"), { headers: bearer(jwt), failOnStatusCode: false }), "GET /v1/me");
}

export async function wallet(request: APIRequestContext, jwt: string): Promise<Wallet> {
  return unwrap<Wallet>(await request.get(apiUrl("/v1/wallet"), { headers: bearer(jwt), failOnStatusCode: false }), "GET /v1/wallet");
}

export async function postDetail(request: APIRequestContext, jwt: string, postId: string): Promise<PostDetail> {
  return unwrap<PostDetail>(
    await request.get(apiUrl(`/v1/posts/${postId}`), { headers: bearer(jwt), failOnStatusCode: false }),
    `GET /v1/posts/${postId}`,
  );
}

export async function assignments(request: APIRequestContext, jwt: string): Promise<Record<string, string>> {
  return unwrap<Record<string, string>>(
    await request.get(apiUrl("/v1/experiments/assignments"), { headers: bearer(jwt), failOnStatusCode: false }),
    "GET /v1/experiments/assignments",
  );
}

export async function dmThreads(
  request: APIRequestContext, jwt: string, personaId: string,
): Promise<{ threads: Array<{ id: string; character: { handle: string } }> }> {
  return unwrap<{ threads: Array<{ id: string; character: { handle: string } }> }>(
    await request.get(apiUrl(`/v1/dms?personaId=${personaId}`), { headers: bearer(jwt), failOnStatusCode: false }),
    "GET /v1/dms",
  );
}

export async function dmThread(
  request: APIRequestContext, jwt: string, threadId: string,
): Promise<{ messages: Array<{ id: string; fromCharacter: boolean; text: string }>; relationship: { affinity: number } }> {
  return unwrap(
    await request.get(apiUrl(`/v1/dms/${threadId}`), { headers: bearer(jwt), failOnStatusCode: false }),
    `GET /v1/dms/${threadId}`,
  );
}

/* --------------------------------------------------------------- browser ---- */

/** Seeds the session token before any page script runs, so the app boots authenticated. */
export async function loginInBrowser(page: Page, jwt: string): Promise<void> {
  await page.addInitScript(
    ([key, value]: [string, string]) => {
      try { window.localStorage.setItem(key, value); } catch { /* private mode */ }
    },
    [TOKEN_KEY, jwt] as [string, string],
  );
}

export async function browserToken(page: Page): Promise<string | null> {
  return page.evaluate((key: string) => {
    try { return window.localStorage.getItem(key); } catch { return null; }
  }, TOKEN_KEY);
}

/** Overrides the build-time ads flag at runtime (apps/mobile/src/env.ts `globalThis.__ADS_MODE`). */
export async function setAdsMode(page: Page, mode: string): Promise<void> {
  await page.addInitScript((m: string) => {
    (globalThis as unknown as { __ADS_MODE?: string }).__ADS_MODE = m;
  }, mode);
}

export async function gotoApp(page: Page, route: string): Promise<void> {
  await page.goto(route, { waitUntil: "domcontentloaded" });
}

async function appear(loc: Locator, timeout = 15_000): Promise<boolean> {
  try { await loc.waitFor({ state: "visible", timeout }); return true; } catch { return false; }
}

/** SCR-002 email sign-in, driven through the UI (used by the cases that test the auth screen). */
export async function uiEmailLogin(page: Page, email: string): Promise<void> {
  await gotoApp(page, ROUTES.auth);
  await page.getByTestId(T.authEmailBtn).click();
  await page.getByTestId(T.authEmailInput).fill(email);
  const code = page.getByTestId(T.authCodeInput);
  // SCR-002 may show the code field together with the email field (single step) or after the first submit (two steps)
  if (await code.isVisible()) {
    await code.fill(DEV_EMAIL_CODE);
    await page.getByTestId(T.authSubmit).click();
    return;
  }
  await page.getByTestId(T.authSubmit).click();
  await expect(code, "SCR-002 must ask for the 6-digit code").toBeVisible({ timeout: 15_000 });
  await code.fill(DEV_EMAIL_CODE);
  await page.getByTestId(T.authSubmit).click();
}

/** SCR-002 birth-year step. */
export async function uiAgeGate(page: Page, birthYear: number): Promise<void> {
  const year = page.getByTestId(T.ageYearInput);
  await expect(year, "SCR-002 must show the birth-year picker for a new account").toBeVisible({ timeout: 15_000 });
  await year.fill(String(birthYear));
  await page.getByTestId(T.ageContinue).click();
}

export interface EnterWorldOptions {
  worldSlug?: string; personaHandle?: string; followerHandle?: string;
}

/** Reads the seeded world's first preset persona and first eligible follower through the API (bearer from the browser). */
export async function worldPresets(page: Page, worldSlug: string): Promise<{ personaHandle: string | null; followerHandle: string | null }> {
  const jwt = await browserToken(page);
  const headers = jwt ? bearer(jwt) : {};
  try {
    const worlds = await page.request.get(apiUrl("/v1/worlds"), { headers, failOnStatusCode: false });
    if (!worlds.ok()) return { personaHandle: null, followerHandle: null };
    const list = ((await worlds.json()) as { data: { id: string; slug: string }[] }).data;
    const world = list.find((w) => w.slug === worldSlug);
    if (!world) return { personaHandle: null, followerHandle: null };
    const detail = await page.request.get(apiUrl(`/v1/worlds/${world.id}`), { headers, failOnStatusCode: false });
    if (!detail.ok()) return { personaHandle: null, followerHandle: null };
    const d = ((await detail.json()) as { data: { characters: { handle: string; canBeFirstFollower: boolean }[]; presetPersonas: { handle: string }[] } }).data;
    const strip = (h: string) => h.replace(/^@/, "");
    return {
      personaHandle: d.presetPersonas[0] ? strip(d.presetPersonas[0].handle) : null,
      followerHandle: d.characters.find((c) => c.canBeFirstFollower) ? strip(d.characters.find((c) => c.canBeFirstFollower)!.handle) : null,
    };
  } catch {
    return { personaHandle: null, followerHandle: null };
  }
}

/** SCR-003 → SCR-004 → SCR-006 → SCR-010, entirely through the UI (the "3 taps" of E2E-002). */
export async function enterWorld(page: Page, opts: EnterWorldOptions = {}): Promise<void> {
  const worldSlug = opts.worldSlug ?? WORLD_SLUG;
  // Preset handles come from the seeded world (original characters), not from hardcoded names.
  const presets = await worldPresets(page, worldSlug);
  const personaHandle = opts.personaHandle ?? presets.personaHandle ?? PERSONA_HANDLE;
  const followerHandle = opts.followerHandle ?? presets.followerHandle ?? FIRST_FOLLOWER;

  await gotoApp(page, ROUTES.root);
  const card = page.getByTestId(T.worldCard(worldSlug));
  if (!(await appear(card, 15_000))) {
    // an authenticated boot should land on SCR-003 by itself; navigate directly if it does not
    await gotoApp(page, ROUTES.scenario);
    await expect(card, "SCR-003 must offer the preset worlds").toBeVisible({ timeout: 15_000 });
  }
  await card.click();

  const preset = page.getByTestId(T.personaPreset(personaHandle));
  await expect(preset, "SCR-004 must offer the preset personas").toBeVisible({ timeout: 15_000 });
  await preset.click();
  await page.getByTestId(T.personaContinue).click();

  const follower = page.getByTestId(T.follower(followerHandle));
  await expect(follower, "SCR-006 must offer the first-follower cards").toBeVisible({ timeout: 15_000 });
  await follower.click();
  await page.getByTestId(T.enterWorld).click();

  // SCR-006 → "Planting the first ripple…" overlay → SCR-010, ≤10s per E2E-002
  await expect(page.getByTestId(T.feedList), "feed must appear within 10s of Enter the world")
    .toBeVisible({ timeout: 10_000 });
}

/** Signup + browser login + world entry — the common prelude of most cases. */
export async function signupAndEnter(
  page: Page, request: APIRequestContext, opts: SignupOptions & EnterWorldOptions = {},
): Promise<Account> {
  const account = await apiSignup(request, opts);
  await loginInBrowser(page, account.jwt);
  await enterWorld(page, opts);
  return account;
}

/* ------------------------------------------------------------------ feed ---- */

/**
 * A feed/thread cell carries `data-testid="post-<id>"`. The inner labels (`post-text`,
 * `post-author`, `post-kind-*`) share the prefix, so they are excluded explicitly.
 */
export const POST_CELL =
  '[data-testid^="post-"]:not([data-testid^="post-kind-"]):not([data-testid="post-text"]):not([data-testid="post-author"])';

/** Any character reaction rendered either as a feed cell of kind `character` or a thread reply. */
export const REACTION =
  `[data-testid="${T.postKind("character")}"], [data-testid^="reply-"]:not([data-testid="${T.replyBtn}"])`;

export function postCells(page: Page): Locator {
  return page.locator(POST_CELL);
}

export function cellsOfKind(page: Page, kind: string): Locator {
  return postCells(page).filter({ has: page.getByTestId(T.postKind(kind)) });
}

export function userPostCell(page: Page, text: string): Locator {
  return cellsOfKind(page, "user").filter({ hasText: text }).first();
}

export function cellByAuthor(page: Page, kind: string, handle: string): Locator {
  return cellsOfKind(page, kind).filter({ hasText: handle }).first();
}

export async function postIdOf(cell: Locator): Promise<string> {
  const tid = await cell.getAttribute("data-testid");
  expect(tid, "post cell must carry a post-<id> data-testid").toBeTruthy();
  return String(tid).slice("post-".length);
}

export function reactionCount(page: Page): Promise<number> {
  return page.locator(REACTION).count();
}

/* ------------------------------------------------------------ SCR-012 ---- */

/** Cells in a thread: feed-style `post-<id>` cells and/or `reply-<id>` rows. */
export function replyCells(page: Page): Locator {
  return page.locator(`${POST_CELL}, [data-testid^="reply-"]:not([data-testid="${T.replyBtn}"])`);
}

export function replyCellById(page: Page, id: string): Locator {
  return page.locator(`[data-testid="${T.post(id)}"], [data-testid="${T.threadReply(id)}"]`).first();
}

export function repliesBy(page: Page, handle: string): Locator {
  return replyCells(page).filter({ hasText: handle });
}

/**
 * The 👎 button for a reply. `T.rateDown(id)` is keyed on the post id in the client we assume;
 * the generation id is accepted too, and finally any rate-down inside the reply cell.
 */
export async function rateDownFor(
  page: Page, reply: { id: string; generationId: string | null },
): Promise<Locator> {
  for (const key of [reply.id, reply.generationId]) {
    if (!key) continue;
    const byId = page.getByTestId(T.rateDown(key));
    if ((await byId.count()) > 0) return byId.first();
  }
  const scoped = replyCellById(page, reply.id).locator('[data-testid^="rate-down-"]');
  expect(await scoped.count(), `no rate-down button for reply ${reply.id}`).toBeGreaterThan(0);
  return scoped.first();
}

/** The Reply button for a thread, preferring one rendered inside `scope`. */
export async function replyButton(page: Page, scope?: Locator): Promise<Locator> {
  if (scope) {
    const inner = scope.getByTestId(T.replyBtn);
    if ((await inner.count()) > 0) return inner.first();
  }
  return page.getByTestId(T.replyBtn).first();
}

/* -------------------------------------------------------------- composer ---- */

export async function openComposer(page: Page): Promise<void> {
  const input = page.getByTestId(T.composeInput);
  if (await input.isVisible().catch(() => false)) return;
  await page.getByTestId(T.composeFab).click();
  await expect(input, "SCR-011 composer must open").toBeVisible();
}

export async function typeInComposer(page: Page, text: string): Promise<void> {
  await page.getByTestId(T.composeInput).fill(text);
}

export async function submitComposer(page: Page): Promise<void> {
  await page.getByTestId(T.composeSubmit).click();
}

/** Composes and submits a post; returns the id of the resulting user cell. Leaves modals as-is. */
export async function post(page: Page, text: string): Promise<string> {
  await openComposer(page);
  await typeInComposer(page, text);
  await submitComposer(page);
  const cell = userPostCell(page, text);
  await expect(cell, `posted text must appear in the feed: "${text}"`).toBeVisible({ timeout: 15_000 });
  return postIdOf(cell);
}

/** Same as `post`, then dismisses the stat card so the next action can start. */
export async function postAndSettle(page: Page, text: string): Promise<string> {
  const id = await post(page, text);
  await dismissStatCard(page);
  return id;
}

/** SCR-013 Continue, when the card is showing. Returns whether a card was dismissed. */
export async function dismissStatCard(page: Page, timeout = 15_000): Promise<boolean> {
  const cont = page.getByTestId(T.statContinue);
  if (!(await appear(cont, timeout))) return false;
  await cont.click();
  await expect(page.getByTestId(T.statCard)).toBeHidden();
  return true;
}

/* ---------------------------------------------------------------- energy ---- */

export async function badgeEnergy(page: Page): Promise<number> {
  const txt = (await page.getByTestId(T.energyBadge).textContent()) ?? "";
  const m = txt.match(/-?\d+/);
  return m ? Number(m[0]) : Number.NaN;
}

export async function expectBadgeEnergy(page: Page, n: number, timeout = 15_000): Promise<void> {
  await expect
    .poll(() => badgeEnergy(page), { timeout, message: `energy badge should read ${n}` })
    .toBe(n);
}

export async function expectWalletEnergy(
  request: APIRequestContext, jwt: string, n: number, timeout = 15_000,
): Promise<void> {
  await expect
    .poll(async () => (await wallet(request, jwt)).energy, { timeout, message: `/v1/wallet energy should be ${n}` })
    .toBe(n);
}

/** Opens SCR-032 (Get Energy) from the feed badge. */
export async function openEnergyModal(page: Page): Promise<void> {
  const modal = page.getByTestId(T.energyModal);
  if (await modal.isVisible().catch(() => false)) return;
  await page.getByTestId(T.energyBadge).click();
  await expect(modal, "SCR-032 Get Energy must open").toBeVisible();
}

/** Reads the "n / max" figure inside SCR-032. */
export async function energyModalValue(page: Page): Promise<number> {
  const txt = (await page.getByTestId(T.energyValue).textContent()) ?? "";
  const m = txt.match(/-?\d+/);
  return m ? Number(m[0]) : Number.NaN;
}

export interface AdReward { energy: number; adRewardsToday: number }

/** Watches the mock rewarded ad (`TEST_AD_TOKEN`) and returns the reward the server granted. */
export async function watchAd(page: Page): Promise<AdReward> {
  const reward = page.waitForResponse(
    (r) => r.url().includes("/v1/wallet/ad-reward") && r.request().method() === "POST",
    { timeout: 20_000 },
  );
  await page.getByTestId(T.watchAd).click();
  const res = await reward;
  expect(res.status(), `POST /v1/wallet/ad-reward (mock token ${TEST_AD_TOKEN})`).toBeLessThan(400);
  return unwrap<AdReward>(res, "POST /v1/wallet/ad-reward");
}

export async function lastAdRequest(page: Page): Promise<{ npa: boolean } | undefined> {
  return page.evaluate(() => (globalThis as unknown as { __lastAdRequest?: { npa: boolean } }).__lastAdRequest);
}

/* ------------------------------------------------------- shared flow: 003 ---- */

export const FIRST_POST_TEXT = "new song Friday";

/**
 * The full E2E-003 body: post, first character reply ≤1.5s, ≥2 reactions ≤5s, SCR-013 stat card
 * with aura/followers/humor + a non-empty narrative, energy 9. Shared verbatim with E2E-012 so the
 * two cases cannot drift apart. Returns the new post id; leaves the stat card open.
 */
export async function firstPostFlow(page: Page, text: string = FIRST_POST_TEXT): Promise<string> {
  const before = await reactionCount(page);

  await openComposer(page);
  await typeInComposer(page, text);
  const t0 = Date.now();
  await submitComposer(page);

  // first reply within 1.5s of submit
  await expect
    .poll(() => reactionCount(page), {
      timeout: 1_500,
      intervals: [50, 100, 150, 200, 250, 250, 250],
      message: "first character reply must be visible within 1.5s of submit",
    })
    .toBeGreaterThanOrEqual(before + 1);

  // ≥2 replies within 5s of submit
  await expect
    .poll(() => reactionCount(page), {
      timeout: Math.max(500, 5_000 - (Date.now() - t0)),
      message: "at least 2 character replies must arrive within 5s of submit",
    })
    .toBeGreaterThanOrEqual(before + 2);

  const cell = userPostCell(page, text);
  await expect(cell).toBeVisible();
  const postId = await postIdOf(cell);

  // SCR-013
  const card = page.getByTestId(T.statCard);
  await expect(card, "SCR-013 stat card must appear after the action").toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId(T.statAura)).toBeVisible();
  await expect(page.getByTestId(T.statFollowers)).toBeVisible();
  await expect(page.getByTestId(T.statHumor)).toBeVisible();
  for (const id of [T.statAura, T.statFollowers, T.statHumor]) {
    await expect(page.getByTestId(id), `${id} must show a value`).toHaveText(/\S/);
  }
  await expect(page.getByTestId(T.statNarrative), "narrative must be 1-2 sentences, not empty")
    .toHaveText(/\S/);

  return postId;
}
