import { chromium } from "playwright";
const API = "http://localhost:4000/v1", H = { "content-type": "application/json" };
const j = async r => { const t = await r.text(); try { return JSON.parse(t) } catch { return t } };
const post = (p, b, a) => fetch(API + p, { method: "POST", headers: { ...H, ...(a ? { authorization: "Bearer " + a } : {}) }, body: JSON.stringify(b) }).then(j);
const get = (p, a) => fetch(API + p, { headers: { authorization: "Bearer " + a } }).then(j);

const email = `fin${Date.now()}@test.local`;
const { data: { jwt } } = await post("/auth/email/verify", { email, code: "000000" });
await post("/auth/age-gate", { birthYear: 1995, locale: "en" }, jwt);
const worlds = (await get("/worlds", jwt)).data, w = worlds.find(x => x.slug === "popstar-era");
const d = (await get(`/worlds/${w.id}`, jwt)).data, f = d.characters.find(c => c.canBeFirstFollower);
const { data: { persona } } = await post("/personas", { worldId: w.id, handle: `fin${Math.floor(Math.random()*99999)}`, displayName: "Tay", firstFollowerId: f.id, idempotencyKey: "f" + Date.now() }, jwt);
for (const text of ["new song Friday", "studio all night again", "the album is done", "listen to the bridge"]) {
  const { data: { post: p } } = await post("/posts", { personaId: persona.id, text }, jwt);
  await fetch(API + `/posts/${p.id}/stream`, { headers: { authorization: "Bearer " + jwt } }).then(r => r.text());
}
const threads = (await get(`/dms?personaId=${persona.id}`, jwt)).data;
const target = threads.followers?.[0];
if (target) {
  const { data: { thread } } = await post("/dms", { personaId: persona.id, characterId: target.id }, jwt);
  const { data } = await post(`/dms/${thread.id}/messages`, { text: "did you see the news?" }, jwt);
  if (data?.streamUrl) await fetch(API + data.streamUrl.replace("/v1", ""), { headers: { authorization: "Bearer " + jwt } }).then(r => r.text()).catch(() => {});
}
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 });
await page.addInitScript(([k, v]) => localStorage.setItem(k, v), ["rpgllm.jwt", jwt]);
const shots = [
  ["01-feed", "/feed", "feed-list"], ["02-explore", "/explore", null],
  ["03-notifications", "/notifications", null], ["04-profile", "/profile", "profile-handle"],
  ["05-dms", "/dms", null], ["06-achievements", "/achievements", null],
  ["07-settings", "/settings", "settings"], ["08-energy", "/energy", "energy-modal"],
  ["09-paywall", "/paywall", "paywall"],
];
for (const [name, route, wait] of shots) {
  await page.goto("http://localhost:8082" + route, { waitUntil: "domcontentloaded" });
  if (wait) await page.getByTestId(wait).waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `/tmp/final/${name}.png` });
  console.log("shot", name);
}
const clean = await browser.newPage({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 });
await clean.goto("http://localhost:8082/auth", { waitUntil: "domcontentloaded" });
await clean.waitForTimeout(2000);
await clean.screenshot({ path: "/tmp/final/00-auth.png" });
console.log("shot 00-auth");
await browser.close();
