import { chromium } from "playwright-core";
const WEB = "http://localhost:8082";
const API = "http://localhost:4000/v1";
const log = [];
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME });

async function scenario(name, { adsMode, birthYear, locale }, fn) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => log.push(`PAGEERROR[${name}] ${e.message}`));
  if (adsMode) await page.addInitScript(`window.__ADS_MODE = ${JSON.stringify(adsMode)};`);
  await page.request.post(`${API}/__test/reset`);
  const tid = (t) => page.getByTestId(t);
  try {
    await page.goto(WEB + "/", { waitUntil: "networkidle" });
    await tid("auth-provider-email").click();
    await tid("auth-email-input").fill("e2e@example.com");
    await tid("auth-code-input").fill("000000");
    if (locale === "ja") await tid("locale-toggle").click();
    await tid("auth-submit").click();
    await tid("age-year-input").waitFor({ timeout: 8000 });
    await tid("age-year-input").fill(String(birthYear));
    await tid("age-continue").click();
    await fn(page, tid);
    log.push(`PASS ${name}`);
  } catch (e) {
    log.push(`FAIL ${name}: ${String(e).slice(0, 250)}`);
  }
  await ctx.close();
}

await scenario("E2E-001 under-13 blocked", { birthYear: 2016 }, async (page, tid) => {
  await tid("age-blocked").waitFor({ timeout: 6000 });
  const me = await page.request.get(`${API}/me`);
  log.push(`  blocked view shown; /me status=${me.status()}`);
});

await scenario("E2E-011 JA locale UI", { birthYear: 2000, locale: "ja" }, async (page, tid) => {
  await tid("world-card-popstar-era").waitFor({ timeout: 8000 });
  const heading = await page.locator("text=ストーリーを選ぶ").count();
  if (!heading) throw new Error("JA heading missing on scenario picker");
});

await scenario("E2E-012 no watch-ad on web without ADS test mode", { birthYear: 2000 }, async (page, tid) => {
  await tid("world-card-popstar-era").click();
  await tid("persona-taytay19").click();
  await tid("persona-continue").click();
  await tid("follower-hivequeenbea").click();
  await tid("enter-world").click();
  await tid("feed-list").waitFor({ timeout: 12000 });
  await tid("energy-badge").click();
  await tid("energy-modal").waitFor({ timeout: 6000 });
  if (await tid("watch-ad").count()) throw new Error("watch-ad visible on web without ADS_MODE=test");
  if (!(await tid("get-plus").count())) throw new Error("get-plus missing");
  if (!(await tid("use-coffee").count())) throw new Error("use-coffee missing");
});

await scenario("E2E-016 minor gets npa=1", { adsMode: "test", birthYear: 2012 }, async (page, tid) => {
  await tid("world-card-popstar-era").click();
  await tid("persona-taytay19").click();
  await tid("persona-continue").click();
  await tid("follower-hivequeenbea").click();
  await tid("enter-world").click();
  await tid("feed-list").waitFor({ timeout: 12000 });
  await tid("energy-badge").click();
  await tid("watch-ad").waitFor({ timeout: 6000 });
  await tid("watch-ad").click();
  await page.waitForTimeout(1200);
  const req = await page.evaluate(() => window.__lastAdRequest);
  log.push(`  __lastAdRequest=${JSON.stringify(req)}`);
  if (!req || req.npa !== true) throw new Error("npa not set for minor");
});

console.log(log.join("\n"));
await browser.close();
