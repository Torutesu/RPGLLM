import { chromium } from "playwright";
const WEB = "http://localhost:8191", API = "http://localhost:4100/v1";
const j = async r => r.json();
const post = (p,b,a)=>fetch(API+p,{method:"POST",headers:{"content-type":"application/json",...(a?{authorization:"Bearer "+a}:{})},body:JSON.stringify(b)}).then(j);
const { data: { jwt } } = await post("/auth/email/verify", { email: `dbg${Date.now()}@test.local`, code: "000000" });
await post("/auth/age-gate", { birthYear: 1995, locale: "en" }, jwt);
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await b.newPage({ viewport:{width:420,height:900} });
await page.addInitScript(([k,v])=>localStorage.setItem(k,v), ["rpgllm.jwt", jwt]);
await page.goto(WEB+"/onboarding/scenario", { waitUntil: "domcontentloaded" });
await page.getByTestId("world-card-popstar-era").waitFor({state:"visible",timeout:20000});
const dump = async (tag) => {
  const info = await page.evaluate(() => {
    const defs = Array.from(document.querySelectorAll('linearGradient')).map(g=>g.id).filter(Boolean);
    const texts = Array.from(document.querySelectorAll('svg text')).map(t=>({ t:t.textContent, fill:t.getAttribute('fill') }));
    return { defs: defs.slice(0,20), texts };
  });
  console.log(tag, JSON.stringify(info));
};
await dump("scenario");
await page.getByTestId("world-card-popstar-era").click();
await page.waitForTimeout(1500);
await dump("persona");
await b.close();
