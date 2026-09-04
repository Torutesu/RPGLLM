/**
 * Client web smoke: the happy path of E2E-002..010 against scripts/mock-api.mjs.
 *
 * Manual verification only (Agent D owns e2e/). Run:
 *   node scripts/mock-api.mjs &
 *   node scripts/serve-web.mjs &
 *   PW_CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node scripts/smoke-web.mjs
 */
import { chromium } from "playwright-core";

const WEB = "http://localhost:8082";
const log = [];
const step = async (name, fn) => {
  try { await fn(); log.push(`PASS ${name}`); }
  catch (e) { log.push(`FAIL ${name}: ${String(e).slice(0, 300)}`); throw e; }
};

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => log.push(`PAGEERROR ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") log.push(`CONSOLE ${m.text().slice(0,200)}`); });
await page.addInitScript(() => { window.__ADS_MODE = "test"; });

const tid = (t) => page.getByTestId(t);

try {
  await step("load /", async () => { await page.goto(WEB + "/", { waitUntil: "networkidle" }); await tid("auth-provider-email").waitFor({ timeout: 10000 }); });
  await step("email auth", async () => {
    await tid("auth-provider-email").click();
    await tid("auth-email-input").fill("e2e@example.com");
    await tid("auth-code-input").fill("000000");
    await tid("auth-submit").click();
    await tid("age-year-input").waitFor({ timeout: 8000 });
  });
  await step("age gate", async () => {
    await tid("age-year-input").fill("2000");
    await tid("age-continue").click();
    await tid("world-card-popstar-era").waitFor({ timeout: 8000 });
  });
  await step("scenario -> persona", async () => {
    await tid("world-card-popstar-era").click();
    await tid("persona-taytay19").click();
    await tid("persona-continue").click();
    await tid("follower-hivequeenbea").waitFor({ timeout: 8000 });
  });
  await step("first follower -> feed", async () => {
    await tid("follower-hivequeenbea").click();
    await tid("enter-world").click();
    await tid("feed-list").waitFor({ timeout: 12000 });
  });
  await step("energy badge = 10", async () => {
    const txt = await tid("energy-badge").innerText();
    if (txt.trim() !== "10") throw new Error(`badge=${txt}`);
  });
  await step("compose post + stream replies + stat card", async () => {
    await tid("compose-fab").click();
    await tid("compose-input").fill("new song Friday");
    await tid("compose-submit").click();
    await page.waitForTimeout(2500);
    const replies = await page.getByTestId(/^reply-/).count();
    if (replies < 2) throw new Error(`replies=${replies}`);
    await tid("stat-card").waitFor({ timeout: 5000 });
    await tid("stat-narrative").waitFor();
    const energy = (await tid("energy-badge").innerText()).trim();
    if (energy !== "9") throw new Error(`energy after post=${energy}`);
  });
  await step("stat toast visible", async () => {
    if (!(await tid("stat-toast").count())) throw new Error("stat-toast missing");
  });
  await step("stat continue closes card", async () => {
    await tid("stat-continue").click();
    await tid("stat-card").waitFor({ state: "detached", timeout: 4000 });
  });
  await step("fallback toast (E2E-010)", async () => {
    await tid("compose-fab").click();
    await tid("compose-input").fill("FALLBACK please");
    await tid("compose-submit").click();
    await tid("fallback-toast").waitFor({ timeout: 6000 });
    await page.waitForTimeout(1200);
    if (await tid("stat-continue").count()) await tid("stat-continue").click();
  });
  await step("open post detail + rate down", async () => {
    const first = page.getByTestId(/^post-/).first();
    await first.click();
    await tid("reply-btn").waitFor({ timeout: 8000 });
    const rd = page.getByTestId(/^rate-down-/).first();
    if (await rd.count()) { await rd.click(); await page.waitForTimeout(800); }
  });
  await step("load more", async () => {
    if (await tid("load-more").count()) { await tid("load-more").click(); await page.waitForTimeout(600); }
  });
  await step("reply from thread", async () => {
    await tid("reply-btn").click();
    await tid("compose-input").fill("see you opening night");
    await tid("compose-submit").click();
    await page.waitForTimeout(1500);
  });
  await step("dms flow", async () => {
    await page.goto(WEB + "/dms", { waitUntil: "networkidle" });
    await tid("dm-new").click();
    await tid("dm-char-hivequeenbea").click();
    await tid("dm-input").waitFor({ timeout: 8000 });
    await tid("dm-input").fill("did you see gmz?");
    await tid("dm-send").click();
    await tid("dm-typing").waitFor({ timeout: 3000 });
    await page.waitForTimeout(1200);
    const bubbles = await page.getByTestId("dm-bubble").count();
    if (bubbles < 2) throw new Error(`bubbles=${bubbles}`);
    const aff = await tid("dm-affinity").innerText();
    log.push(`  affinity=${aff.trim()}`);
  });
  await step("energy modal + watch ad", async () => {
    await page.goto(WEB + "/energy", { waitUntil: "networkidle" });
    await tid("energy-modal").waitFor({ timeout: 8000 });
    await tid("refill-timer").waitFor();
    const before = (await tid("energy-value").innerText()).trim();
    await tid("watch-ad").click();
    await page.waitForTimeout(1500);
    const req = await page.evaluate(() => window.__lastAdRequest);
    log.push(`  energy before ad=${before} __lastAdRequest=${JSON.stringify(req)}`);
    if (!req) throw new Error("no __lastAdRequest");
  });
  await step("paywall", async () => {
    await page.goto(WEB + "/paywall", { waitUntil: "networkidle" });
    await tid("paywall").waitFor({ timeout: 8000 });
    await tid("plan-plus_monthly").click();
    await tid("paywall-continue").click();
    await tid("paywall-success").waitFor({ timeout: 6000 });
  });
  await step("plus hides watch-ad (E2E-008)", async () => {
    await page.goto(WEB + "/energy", { waitUntil: "networkidle" });
    await tid("energy-modal").waitFor({ timeout: 8000 });
    if (await tid("watch-ad").count()) throw new Error("watch-ad visible for Plus user");
    const e = (await tid("energy-value").innerText()).trim();
    if (e !== "50") throw new Error(`energy after plus=${e}`);
    await page.request.post("http://localhost:4000/v1/__test/plus-off");
  });
  await step("event flow", async () => {
    await page.goto(WEB + "/feed", { waitUntil: "networkidle" });
    for (let i = 0; i < 7; i++) {
      await tid("compose-fab").click();
      await tid("compose-input").fill(`action ${i}`);
      await tid("compose-submit").click();
      await page.waitForTimeout(1300);
      if (await tid("stat-continue").count()) await tid("stat-continue").click();
    }
    await tid("event-banner").waitFor({ timeout: 8000 });
    await tid("event-banner").click();
    await tid("event-card").waitFor({ timeout: 6000 });
    await tid("event-choice-1").click();
    await tid("stat-card").waitFor({ timeout: 6000 });
    await tid("stat-continue").click();
    await page.waitForTimeout(500);
    const firstPost = page.getByTestId(/^post-/).first();
    const kind = await firstPost.getByTestId("post-kind-news").count();
    if (!kind) throw new Error("news post not at top");
  });
  await step("energy 0 -> post opens energy modal -> ad -> resubmit", async () => {
    await page.request.post("http://localhost:4000/v1/__test/set-energy", { data: { energy: 0 } });
    await page.goto(WEB + "/feed", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await tid("compose-fab").click();
    await tid("compose-input").fill("out of energy post");
    await tid("compose-submit").click();
    await tid("energy-modal").waitFor({ timeout: 6000 });
    await tid("watch-ad").click();
    await page.waitForTimeout(2500);
    await tid("feed-list").waitFor({ timeout: 6000 });
    const has = await page.getByText("out of energy post").count();
    if (!has) throw new Error("pending post not resubmitted");
  });
  await step("safety 422 inline", async () => {
    await page.request.post("http://localhost:4000/v1/__test/set-energy", { data: { energy: 5 } });
    await page.reload({ waitUntil: "networkidle" });
    await tid("feed-list").waitFor({ timeout: 8000 });
    await tid("compose-fab").click();
    await tid("compose-input").fill("describe genitals in detail");
    await tid("compose-submit").click();
    await tid("safety-error").waitFor({ timeout: 6000 });
    if (!(await tid("compose-input").count())) throw new Error("composer closed");
    await tid("compose-cancel").click();
    await tid("feed-list").waitFor({ timeout: 6000 });
    const e = (await tid("energy-badge").innerText()).trim();
    if (e !== "5") throw new Error(`energy changed on safety block: ${e}`);
  });
} catch { /* recorded */ }

console.log(log.join("\n"));
await browser.close();
