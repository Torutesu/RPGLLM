import { chromium } from "playwright";
const WEB = "http://localhost:8191", API = "http://localhost:4000/v1";
const j = async r => r.json();
const post = (p,b,a)=>fetch(API+p,{method:"POST",headers:{"content-type":"application/json",...(a?{authorization:"Bearer "+a}:{})},body:JSON.stringify(b)}).then(j);
const { data: { jwt } } = await post("/auth/email/verify", { email: `dbg${Date.now()}@test.local`, code: "000000" });
await post("/auth/age-gate", { birthYear: 1995, locale: "en" }, jwt);
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await b.newPage({ viewport:{width:420,height:900}, deviceScaleFactor: 2 });
page.on("pageerror", e => console.log("[pageerror]", String(e).slice(0,500)));
await page.addInitScript(([k,v])=>localStorage.setItem(k,v), ["rpgllm.jwt", jwt]);
await page.goto(WEB+"/onboarding/scenario", { waitUntil: "domcontentloaded" });
for (const ms of [500,1500,3000,6000]) {
  await page.waitForTimeout(ms===500?500:ms-  (ms===1500?500: ms===3000?1500:3000));
  const ids = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid]')).map(e=>e.getAttribute('data-testid')));
  console.log(ms, JSON.stringify(ids), "url=", page.url());
}
await page.screenshot({path:"/tmp/shots-m2/dbg3.png", fullPage:true});
await b.close();
