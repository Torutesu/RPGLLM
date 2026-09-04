import { chromium } from "playwright";
const WEB = process.env.WEB || "http://localhost:8291";
const OUT = process.env.OUT || "/tmp/shots-m6";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

// reduced motion + root redirect
const rm = await b.newContext({ viewport:{width:420,height:900}, deviceScaleFactor:2, reducedMotion: "reduce" });
const p1 = await rm.newPage();
await p1.goto(WEB + "/", { waitUntil: "domcontentloaded" });
await p1.waitForTimeout(2500);
await p1.screenshot({ path: `${OUT}/10-reduced-motion-auth.png` });
console.log("reduced-motion url:", p1.url());

// JA
const ja = await b.newContext({ viewport:{width:420,height:900}, deviceScaleFactor:2 });
const p2 = await ja.newPage();
await p2.goto(WEB + "/auth", { waitUntil: "domcontentloaded" });
await p2.getByTestId("locale-toggle").waitFor({state:"visible",timeout:15000});
await p2.getByTestId("locale-toggle").click();
await p2.waitForTimeout(5000);
await p2.screenshot({ path: `${OUT}/11-auth-ja.png` });

// desktop viewport (the E2E one)
const d = await b.newContext({ viewport:{width:1280,height:800} });
const p3 = await d.newPage();
await p3.goto(WEB + "/auth", { waitUntil: "domcontentloaded" });
await p3.waitForTimeout(1500);
await p3.screenshot({ path: `${OUT}/12-auth-desktop.png` });
console.log("done");
await b.close();
