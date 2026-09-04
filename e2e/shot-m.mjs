import { chromium } from "playwright";
const WEB = process.env.WEB || "http://localhost:8082";
const API = (process.env.API || "http://localhost:4000") + "/v1", H = { "content-type": "application/json" };
const OUT = process.env.OUT || "/tmp/shots-m";
const j = async r => { const t = await r.text(); try { return JSON.parse(t) } catch { return t } };
const post = (p, b, a) => fetch(API + p, { method: "POST", headers: { ...H, ...(a ? { authorization: "Bearer " + a } : {}) }, body: JSON.stringify(b) }).then(j);
const get = (p, a) => fetch(API + p, { headers: { authorization: "Bearer " + a } }).then(j);

const email = `m${Date.now()}@test.local`;
const { data: { jwt } } = await post("/auth/email/verify", { email, code: "000000" });
await post("/auth/age-gate", { birthYear: 1995, locale: "en" }, jwt);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const mk = () => browser.newPage({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 });

// logged out: auth
const clean = await mk();
await clean.goto(WEB + "/auth", { waitUntil: "domcontentloaded" });
await clean.waitForTimeout(1500);
await clean.screenshot({ path: `${OUT}/00-auth.png` });
await clean.waitForTimeout(3000);
await clean.screenshot({ path: `${OUT}/00b-auth-later.png` });
await clean.getByTestId("auth-provider-email").click().catch(e=>console.log("emailbtn click fail", e.message));
await clean.waitForTimeout(900);
await clean.screenshot({ path: `${OUT}/00c-auth-email.png` });
console.log("shot auth");

// authed onboarding
const page = await mk();
await page.addInitScript(([k, v]) => localStorage.setItem(k, v), ["rpgllm.jwt", jwt]);
await page.goto(WEB + "/onboarding/scenario", { waitUntil: "domcontentloaded" });
await page.getByTestId("world-card-popstar-era").waitFor({ state: "visible", timeout: 20000 }).catch(()=>{});
await page.waitForTimeout(1400);
await page.screenshot({ path: `${OUT}/01-scenario.png`, fullPage: true });
await page.getByTestId("world-card-popstar-era").click();
await page.waitForTimeout(1600);
await page.screenshot({ path: `${OUT}/02-persona.png`, fullPage: true });
const w = (await get("/worlds", jwt)).data.find(x=>x.slug==="popstar-era");
const d = (await get(`/worlds/${w.id}`, jwt)).data;
const ph = d.presetPersonas[0].handle.replace(/^@/,"");
await page.getByTestId(`persona-${ph}`).click();
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/02b-persona-selected.png`, fullPage: true });
await page.getByTestId("persona-continue").click();
await page.waitForTimeout(1600);
await page.screenshot({ path: `${OUT}/03-first-follower.png`, fullPage: true });
const fh = d.characters.find(c=>c.canBeFirstFollower).handle.replace(/^@/,"");
await page.getByTestId(`follower-${fh}`).click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/03b-follower-selected.png`, fullPage: true });
await page.getByTestId("enter-world").click();
await page.waitForTimeout(280);
await page.screenshot({ path: `${OUT}/04-world-loading.png` });
await page.getByTestId("feed-list").waitFor({state:"visible", timeout: 20000}).catch(()=>{});
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/05-feed.png` });
console.log("done");

// persona editor
const p2 = await mk();
await p2.addInitScript(([k, v]) => localStorage.setItem(k, v), ["rpgllm.jwt", jwt]);
await p2.goto(WEB + "/onboarding/scenario", { waitUntil: "domcontentloaded" });
await p2.getByTestId("world-card-popstar-era").waitFor({ state: "visible", timeout: 20000 }).catch(()=>{});
await p2.getByTestId("world-card-popstar-era").click();
await p2.waitForTimeout(1500);
await p2.getByTestId("persona-create-own").click();
await p2.waitForTimeout(900);
await p2.getByTestId("persona-handle-input").fill("nightowl");
await p2.getByTestId("persona-name-input").fill("Nova");
await p2.waitForTimeout(1200);
await p2.screenshot({ path: `${OUT}/06-persona-edit.png`, fullPage: true });
console.log("shot editor");
await browser.close();
