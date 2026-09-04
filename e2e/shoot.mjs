import { chromium } from "playwright";
const API = "http://localhost:4000/v1", H = { "content-type": "application/json" };
const j = async r => { const t = await r.text(); try { return JSON.parse(t) } catch { return t } };
const post = (p, b, a) => fetch(API + p, { method: "POST", headers: { ...H, ...(a ? { authorization: "Bearer " + a } : {}) }, body: JSON.stringify(b) }).then(j);
const get = (p, a) => fetch(API + p, { headers: { authorization: "Bearer " + a } }).then(j);

const email = `shot${Date.now()}@test.local`;
const { data: { jwt } } = await post("/auth/email/verify", { email, code: "000000" });
await post("/auth/age-gate", { birthYear: 1995, locale: "en" }, jwt);
const worlds = (await get("/worlds", jwt)).data, w = worlds.find(x => x.slug === "popstar-era");
const d = (await get(`/worlds/${w.id}`, jwt)).data, f = d.characters.find(c => c.canBeFirstFollower);
const { data: { persona } } = await post("/personas", { worldId: w.id, handle: "shotuser", displayName: "Tay", firstFollowerId: f.id, idempotencyKey: "s" + Date.now() }, jwt);
for (const text of ["new song Friday", "studio all night again"]) {
  const { data: { post: p } } = await post("/posts", { personaId: persona.id, text }, jwt);
  await fetch(API + `/posts/${p.id}/stream`, { headers: { authorization: "Bearer " + jwt } }).then(r => r.text());
}
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 });
await page.addInitScript(([k, v]) => localStorage.setItem(k, v), ["rpgllm.jwt", jwt]);
for (const [name, route, wait] of [
  ["01-feed", "/feed", "feed-list"], ["02-thread", "/feed", null],
  ["03-profile", "/profile", "profile-handle"], ["04-dms", "/dms", null],
  ["05-settings", "/settings", "settings"], ["06-energy", "/energy", "energy-modal"],
  ["07-paywall", "/paywall", "paywall"], ["08-compose", "/compose", "compose-input"],
]) {
  await page.goto("http://localhost:8082" + route, { waitUntil: "domcontentloaded" });
  if (wait) await page.getByTestId(wait).waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `/tmp/shots/${name}.png` });
  console.log("shot", name);
}
// auth screen, logged out
const clean = await browser.newPage({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 });
await clean.goto("http://localhost:8082/auth", { waitUntil: "domcontentloaded" });
await clean.waitForTimeout(1200);
await clean.screenshot({ path: "/tmp/shots/00-auth.png" });
console.log("shot 00-auth");
await browser.close();
