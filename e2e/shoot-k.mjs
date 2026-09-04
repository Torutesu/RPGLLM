import { chromium } from "playwright";
const API = "http://localhost:4010/v1", H = { "content-type": "application/json" };
const j = async r => { const t = await r.text(); try { return JSON.parse(t) } catch { return t } };
const post = (p, b, a) => fetch(API + p, { method: "POST", headers: { ...H, ...(a ? { authorization: "Bearer " + a } : {}) }, body: JSON.stringify(b) }).then(j);
const get = (p, a) => fetch(API + p, { headers: { authorization: "Bearer " + a } }).then(j);

const email = `shot${Date.now()}@test.local`;
const { data: { jwt } } = await post("/auth/email/verify", { email, code: "000000" });
await post("/auth/age-gate", { birthYear: 1995, locale: "en" }, jwt);
const worlds = (await get("/worlds", jwt)).data, w = worlds.find(x => x.slug === "popstar-era");
const d = (await get(`/worlds/${w.id}`, jwt)).data, f = d.characters.find(c => c.canBeFirstFollower);
const { data: { persona } } = await post("/personas", { worldId: w.id, handle: `shot${Math.floor(Math.random() * 9999)}`, displayName: "Tay", firstFollowerId: f.id, idempotencyKey: "s" + Date.now() }, jwt);
await post("/__test/set-energy", { energy: 40 }, jwt);
for (const text of ["new song Friday", "studio all night again", "the second chorus is the whole song", "receipts are coming", "midnight rehearsal ran long", "the second chorus again", "back in the b room", "the Ledger Awards seating chart", "one more take", "we go again tonight", "listen to the bridge", "nothing to say yet"]) {
  const { data: { post: p } } = await post("/posts", { personaId: persona.id, text }, jwt);
  await fetch(API + `/posts/${p.id}/stream`, { headers: { authorization: "Bearer " + jwt } }).then(r => r.text());
}
const trending = await get(`/trending?personaId=${persona.id}`, jwt);
console.log("rank", JSON.stringify(trending.data.yourRank), "topics", trending.data.topics.map(t => t.label).join(" | "));
const feed = await get(`/feed?personaId=${persona.id}`, jwt);
const hash = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 } return h >>> 0 };
const hasMedia = p => p.kind !== "user" && p.kind !== "system" && p.parentId === null && hash(p.id) % (p.kind === "news" ? 2 : 4) === 0;
const withMedia = feed.data.posts.filter(hasMedia);
console.log("posts with media:", withMedia.length, "/", feed.data.posts.length, withMedia.map(p => p.kind).join(","));
const firstChar = feed.data.posts.find(p => !p.author.isYou)?.author.handle ?? f.handle;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 });
await page.addInitScript(([k, v]) => localStorage.setItem(k, v), ["rpgllm.jwt", jwt]);
for (const [name, route, wait] of [
  ["01-feed", "/feed", "feed-list"],
  ["03-explore", "/explore", "trending-list"],
  ["04-character", `/character/${firstChar}`, "character-profile"],
]) {
  await page.goto("http://localhost:8092" + route, { waitUntil: "domcontentloaded" });
  if (wait) await page.getByTestId(wait).waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `/tmp/shots-k/${name}.png` });
  console.log("shot", name);
}
// second feed frame, scrolled, so the media rhythm is visible
await page.goto("http://localhost:8092/feed", { waitUntil: "domcontentloaded" });
await page.getByTestId("feed-list").waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1200);

if (withMedia.length) {
  const target = page.getByTestId(`post-media-${withMedia[0].id}`);
  await target.scrollIntoViewIfNeeded({ timeout: 10000 }).catch(e => console.log("scroll failed", e.message));
  await page.waitForTimeout(900);
  console.log("media visible:", await target.isVisible().catch(() => false));
} else {
  await page.mouse.wheel(0, 1600);
}
await page.waitForTimeout(600);
await page.screenshot({ path: "/tmp/shots-k/02-feed-scrolled.png" });
console.log("shot 02-feed-scrolled");
const kindOf = p => { const h = hash(p.id); const pal = p.kind === "news" ? ["leak", "chart"] : ["art", "chart", "leak"]; return pal[(h >>> 8) % pal.length] };
for (const p of withMedia) {
  const el = page.getByTestId(`post-media-${p.id}`);
  await el.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  await el.screenshot({ path: `/tmp/shots-k/media-${kindOf(p)}-${p.id.slice(-4)}.png` }).catch(e => console.log("el shot failed", e.message));
  console.log("media", kindOf(p), p.kind);
}
await browser.close();
