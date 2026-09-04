import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport:{width:1280,height:800} });
await p.goto("http://localhost:8291/auth", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(1500);
const info = await p.evaluate(() => {
  const out = [];
  document.querySelectorAll("*").forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width > 900 && Math.abs(r.bottom - 455) < 12) out.push({ tag: el.tagName, cls: el.className?.toString?.().slice(0,60), top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), style: (el.getAttribute("style")||"").slice(0,180) });
  });
  return out;
});
console.log(JSON.stringify(info, null, 1));
await b.close();
