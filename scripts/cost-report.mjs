#!/usr/bin/env node
/**
 * S3-5 — the daily cost dashboard (cost-architecture §6.4) as a CLI.
 *
 *   node scripts/cost-report.mjs --days 7                  readable table on stdout
 *   node scripts/cost-report.mjs --days 7 --json           the raw report
 *   node scripts/cost-report.mjs --days 30 --html out.html a self-contained dashboard file
 *
 * Source of the numbers:
 *   - `API_URL` + `ADMIN_TOKEN` set  -> GET {API_URL}/v1/cost/summary?days=N with `x-admin-token`
 *   - otherwise                      -> straight to Postgres with Prisma, through the very same
 *                                       aggregation the API uses (apps/api/src/services/cost.ts,
 *                                       loaded through tsx). There is no second implementation of
 *                                       the maths, so the two paths cannot drift.
 *
 * Zero dependencies beyond what the repo already has; the HTML embeds its own CSS and hand-drawn
 * SVG (no CDN, no fonts, no client-side JS) so it opens from a file:// URL forever.
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/* ------------------------------------------------------------------- args ---- */

function parseArgs(argv) {
  const out = { days: 7, json: false, html: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--days" || a === "-d") { out.days = Number(argv[++i]); continue; }
    if (a === "--json") { out.json = true; continue; }
    if (a === "--html") { out.html = argv[++i]; continue; }
    if (a === "--help" || a === "-h") { out.help = true; continue; }
    if (a.startsWith("--days=")) { out.days = Number(a.slice(7)); continue; }
    if (a.startsWith("--html=")) { out.html = a.slice(7); continue; }
    throw new Error(`unknown argument: ${a}`);
  }
  if (!Number.isFinite(out.days)) out.days = 7;
  return out;
}

const USAGE = `cost-report — LLM spend dashboard (cost-architecture §6.4)

  node scripts/cost-report.mjs [--days N] [--json] [--html FILE]

  --days N     window length in days (default 7, clamped server-side to 90)
  --json       print the report as JSON instead of a table
  --html FILE  also write a self-contained HTML dashboard to FILE

  env  API_URL + ADMIN_TOKEN   read through the API instead of the database
       DATABASE_URL            Postgres URL for the direct path
                               (default postgresql://postgres@127.0.0.1:5432/rpgllm)
`;

/* ----------------------------------------------------------------- source ---- */

async function fetchViaApi(apiUrl, adminToken, days) {
  const url = `${apiUrl.replace(/\/$/, "")}/v1/cost/summary?days=${days}`;
  const res = await fetch(url, { headers: { "x-admin-token": adminToken } });
  const text = await res.text();
  if (res.status === 404) {
    throw new Error(`${url} -> 404. The cost routes are admin-only: ADMIN_TOKEN must match the API's, or the API must run with TEST_HOOKS=1.`);
  }
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${text.slice(0, 400)}`);
  const body = JSON.parse(text);
  if (body.error) throw new Error(`${url} -> ${body.error.code}: ${body.error.message}`);
  return body.data;
}

async function fetchViaDatabase(days) {
  const { register } = await import("tsx/esm/api");
  const unregister = register();
  try {
    const service = await import(pathToFileURL(resolve(REPO_ROOT, "apps/api/src/services/cost.ts")).href);
    const { PrismaClient } = await import("@prisma/client");
    const url = process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/rpgllm";
    const prisma = new PrismaClient({ datasources: { db: { url } } });
    try {
      const window = service.costWindow(new Date(), days);
      const report = await service.costReport(prisma, window);
      return { ...report, days: window.days };
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    unregister();
  }
}

async function loadReport(days) {
  const apiUrl = process.env.API_URL;
  const adminToken = process.env.ADMIN_TOKEN;
  if (apiUrl && adminToken) return { report: await fetchViaApi(apiUrl, adminToken, days), source: `API ${apiUrl}` };
  const db = process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/rpgllm";
  return { report: await fetchViaDatabase(days), source: `DB ${db.replace(/:[^:@/]*@/, ":***@")}` };
}

/* ----------------------------------------------------------- formatting ---- */

const usd = (n, digits = 6) => `$${Number(n ?? 0).toFixed(digits)}`;
const pct = (n, digits = 1) => `${(Number(n ?? 0) * 100).toFixed(digits)}%`;
const int = (n) => Number(n ?? 0).toLocaleString("en-US");
const ms = (n) => `${int(Math.round(Number(n ?? 0)))}ms`;
const signedPct = (n) => (n === null || n === undefined ? "—" : `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`);
const safeDiv = (a, b) => (b ? a / b : 0);

function table(headers, rows, align = []) {
  const all = [headers, ...rows].map((r) => r.map((c) => String(c)));
  const widths = headers.map((_, i) => Math.max(...all.map((r) => (r[i] ?? "").length)));
  const line = (cells) =>
    cells.map((c, i) => (align[i] === "r" ? String(c).padStart(widths[i]) : String(c).padEnd(widths[i]))).join("  ");
  const rule = widths.map((w) => "-".repeat(w)).join("  ");
  return [line(headers), rule, ...rows.map((r) => line(r))].join("\n");
}

const ROW_HEADERS = ["key", "calls", "in", "cache w", "cache r", "out", "cost", "fallb", "p50 ms", "p95 ms"];
const ROW_ALIGN = ["l", "r", "r", "r", "r", "r", "r", "r", "r", "r"];
const rowCells = (r) => [
  r.key, int(r.calls), int(r.inputTokens), int(r.cacheWriteTokens), int(r.cacheReadTokens),
  int(r.outputTokens), usd(r.costUsd), int(r.fallbacks), int(r.p50LatencyMs), int(r.p95LatencyMs),
];

function alarmLines(report) {
  const t = report.thresholds ?? { CACHE_HIT_MIN: 0.8, COST_OVER_CHAMPION: 0.3, TTFT_P95_MAX_MS: 3000 };
  const a = report.alarms ?? {};
  const worstArm = (report.variants ?? [])
    .filter((v) => v.costVsChampion !== null)
    .sort((x, y) => y.costVsChampion - x.costVsChampion)[0];
  return [
    [Boolean(a.cacheHitRateLow), `cache hit rate ${pct(report.cacheHitRate, 1)} vs the ${pct(t.CACHE_HIT_MIN, 0)} floor (below it means prompt caching may have silently broken)`],
    [Boolean(a.costPerActionOverChampion), `costliest challenger arm ${worstArm ? `${worstArm.variantId} at ${signedPct(worstArm.costVsChampion)}` : "none"} vs the +${pct(t.COST_OVER_CHAMPION, 0)} ceiling over its champion`],
    [Boolean(a.ttftP95High), `TTFT P95 ${ms(report.ttft?.p95Ms)} vs the ${ms(t.TTFT_P95_MAX_MS)} budget`],
  ];
}

function renderText(report, source) {
  const out = [];
  const down = report.ratings.down;
  const rated = report.ratings.up + down;
  out.push(`LLM cost report — ${report.since} → ${report.until}  (${report.days ?? "?"}d, via ${source})`);
  out.push("");
  out.push(
    table(
      ["metric", "value"],
      [
        ["$/action", usd(report.perAction.usdPerAction)],
        ["$/active user", usd(report.perAction.usdPerActiveUser)],
        ["actions (energy spends)", int(report.perAction.actions)],
        ["generator calls", int(report.totals.calls)],
        ["total cost", usd(report.totals.costUsd)],
        ["cache hit rate", pct(report.cacheHitRate, 2)],
        ["fallback rate", pct(safeDiv(report.totals.fallbacks, report.totals.calls), 2)],
        ["latency P50 / P95", `${ms(report.totals.p50LatencyMs)} / ${ms(report.totals.p95LatencyMs)}`],
        ["TTFT P50 / P95", `${ms(report.ttft?.p50Ms)} / ${ms(report.ttft?.p95Ms)}`],
        ["👍 / 👎", `${int(report.ratings.up)} / ${int(down)}`],
        ["👎 rate (of rated)", pct(safeDiv(down, rated), 2)],
        ["regeneration rate (of calls)", pct(safeDiv(report.ratings.regenerations, report.totals.calls), 2)],
      ],
      ["l", "r"],
    ),
  );

  const alarms = alarmLines(report);
  out.push("");
  out.push("ALARMS (§6.4)");
  for (const [fired, text] of alarms) out.push(`  ${fired ? "!! FIRING" : "   ok    "}  ${text}`);

  for (const [title, rows] of [
    ["BY DAY", report.byDay], ["BY GENERATOR", report.byGenerator],
    ["BY VARIANT", report.byVariant], ["BY MODEL", report.byModel],
    ["TOTALS", [report.totals]],
  ]) {
    out.push("");
    out.push(title);
    out.push(table(ROW_HEADERS, rows.map(rowCells), ROW_ALIGN));
  }

  if (report.perDay?.length) {
    out.push("");
    out.push("PER DAY — $/action, $/DAU, cache, TTFT");
    out.push(
      table(
        ["day", "actions", "DAU", "cost", "$/action", "$/DAU", "cache", "ttft p50", "ttft p95"],
        report.perDay.map((d) => [
          d.day, int(d.actions), int(d.activeUsers), usd(d.costUsd), usd(d.usdPerAction),
          usd(d.usdPerActiveUser), pct(d.cacheHitRate), int(d.ttftP50Ms), int(d.ttftP95Ms),
        ]),
        ["l", "r", "r", "r", "r", "r", "r", "r", "r"],
      ),
    );
  }

  if (report.batch) {
    const b = report.batch;
    out.push("");
    out.push("BATCH TIER (§5.4) — batched vs interactive");
    out.push(
      table(
        ["lane", "calls", "cost", "share of calls", "share of cost"],
        [
          ["batched", int(b.batched.calls), usd(b.batched.costUsd), pct(b.batchedCallShare), pct(b.batchedCostShare)],
          ["interactive", int(b.interactive.calls), usd(b.interactive.costUsd), pct(1 - b.batchedCallShare), pct(1 - b.batchedCostShare)],
        ],
        ["l", "r", "r", "r", "r"],
      ),
    );
    out.push(
      table(
        ["metric", "value"],
        [
          ["batched tokens at list price", usd(b.listPriceUsd)],
          ["actually billed (batch tier)", usd(b.batched.costUsd)],
          ["saved by batching", usd(b.savedUsd)],
          ["realised discount", `${pct(b.realisedDiscount)} (expected ${pct(b.expectedDiscount)})`],
        ],
        ["l", "r"],
      ),
    );
    if (b.byGenerator?.length) {
      out.push(
        table(
          ["generator", "batched calls", "cost", "saved"],
          b.byGenerator.map((g) => [g.generator, int(g.calls), usd(g.costUsd), usd(g.savedUsd)]),
          ["l", "r", "r", "r"],
        ),
      );
    }
  }

  if (report.variants?.length) {
    out.push("");
    out.push("VARIANT ALLOCATION (§6.1 arms)");
    out.push(
      table(
        ["gen", "variant", "", "model", "calls", "alloc", "$/call", "vs champ", "👍", "👎", "regen", "quality"],
        report.variants.map((v) => [
          v.generator, v.variantId, v.isChampion ? "champ" : "", v.model, int(v.calls), pct(v.allocation, 0),
          usd(v.usdPerCall), signedPct(v.costVsChampion), int(v.up), int(v.down), int(v.regenerations),
          v.qualityProxy.toFixed(2),
        ]),
        ["l", "l", "l", "l", "r", "r", "r", "r", "r", "r", "r", "r"],
      ),
    );
  }
  out.push("");
  return out.join("\n");
}

/* ----------------------------------------------------------------- HTML ---- */

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const SERIES = ["#4f7cff", "#e0803a", "#3aa87a", "#b45ad6", "#d05070"];

/** Minimal multi-series line chart. Static SVG — no script, no library. */
function lineChart(points, series, opts = {}) {
  const W = 720, H = 210, PAD = { l: 62, r: 16, t: 14, b: 30 };
  if (points.length === 0) return `<p class="empty">no data in this window</p>`;
  const values = series.flatMap((s) => points.map((p) => s.value(p))).filter((v) => Number.isFinite(v));
  const guides = opts.guide ? [opts.guide.value] : [];
  const max = Math.max(...values, ...guides, opts.minMax ?? 0) || 1;
  const x = (i) => PAD.l + (points.length === 1 ? (W - PAD.l - PAD.r) / 2 : (i * (W - PAD.l - PAD.r)) / (points.length - 1));
  const y = (v) => H - PAD.b - (Math.max(0, v) / max) * (H - PAD.t - PAD.b);

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const v = max * f;
    return `<line x1="${PAD.l}" y1="${y(v)}" x2="${W - PAD.r}" y2="${y(v)}" class="grid"/>
      <text x="${PAD.l - 8}" y="${y(v) + 4}" class="tick" text-anchor="end">${esc(opts.fmt ? opts.fmt(v) : v.toFixed(0))}</text>`;
  }).join("");

  const guide = opts.guide
    ? `<line x1="${PAD.l}" y1="${y(opts.guide.value)}" x2="${W - PAD.r}" y2="${y(opts.guide.value)}" class="alarm-line"/>
       <text x="${W - PAD.r}" y="${y(opts.guide.value) - 6}" class="tick alarm-text" text-anchor="end">${esc(opts.guide.label)}</text>`
    : "";

  const paths = series.map((s, si) => {
    const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(s.value(p)).toFixed(1)}`).join(" ");
    const dots = points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(s.value(p)).toFixed(1)}" r="3" fill="${SERIES[si % SERIES.length]}"/>`).join("");
    return `<path d="${d}" fill="none" stroke="${SERIES[si % SERIES.length]}" stroke-width="2"/>${dots}`;
  }).join("");

  const labels = points.map((p, i) =>
    points.length > 12 && i % Math.ceil(points.length / 12) !== 0
      ? ""
      : `<text x="${x(i).toFixed(1)}" y="${H - 10}" class="tick" text-anchor="middle">${esc(p.label)}</text>`,
  ).join("");

  const legend = series.map((s, si) =>
    `<span class="key"><i style="background:${SERIES[si % SERIES.length]}"></i>${esc(s.name)}</span>`).join("");

  return `<div class="legend">${legend}</div>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.title ?? "chart")}">${ticks}${guide}${paths}${labels}</svg>`;
}

/** Stacked horizontal bars: the four token kinds per generator (§6.4 "token composition"). */
function tokenComposition(rows) {
  if (rows.length === 0) return `<p class="empty">no data in this window</p>`;
  const kinds = [
    ["input", "inputTokens"], ["cache write", "cacheWriteTokens"],
    ["cache read", "cacheReadTokens"], ["output", "outputTokens"],
  ];
  const max = Math.max(...rows.map((r) => kinds.reduce((s, [, k]) => s + r[k], 0)), 1);
  const legend = kinds.map(([name], i) => `<span class="key"><i style="background:${SERIES[i]}"></i>${esc(name)}</span>`).join("");
  const bars = rows.map((r) => {
    const total = kinds.reduce((s, [, k]) => s + r[k], 0);
    let off = 0;
    const segs = kinds.map(([name, k], i) => {
      const w = (r[k] / max) * 100;
      const seg = `<span class="seg" style="width:${w.toFixed(3)}%;background:${SERIES[i]}" title="${esc(name)}: ${int(r[k])}"></span>`;
      off += w;
      return seg;
    }).join("");
    return `<tr><th scope="row">${esc(r.key)}</th><td class="barcell"><span class="bar">${segs}</span></td><td class="num">${int(total)}</td><td class="num">${usd(r.costUsd)}</td></tr>`;
  }).join("");
  return `<div class="legend">${legend}</div>
<table class="grid-table"><thead><tr><th>generator</th><th>token composition</th><th class="num">tokens</th><th class="num">cost</th></tr></thead><tbody>${bars}</tbody></table>`;
}

function breakdownTable(rows) {
  const body = rows.map((r) => `<tr><th scope="row">${esc(r.key)}</th>${[
    int(r.calls), int(r.inputTokens), int(r.cacheWriteTokens), int(r.cacheReadTokens), int(r.outputTokens),
    usd(r.costUsd), int(r.fallbacks), int(r.p50LatencyMs), int(r.p95LatencyMs),
  ].map((c) => `<td class="num">${esc(c)}</td>`).join("")}</tr>`).join("");
  return `<table class="grid-table"><thead><tr><th>key</th><th class="num">calls</th><th class="num">input</th><th class="num">cache w</th><th class="num">cache r</th><th class="num">output</th><th class="num">cost</th><th class="num">fallbacks</th><th class="num">p50</th><th class="num">p95</th></tr></thead><tbody>${body}</tbody></table>`;
}

function variantTable(variants) {
  if (!variants?.length) return `<p class="empty">no arms served in this window</p>`;
  const body = variants.map((v) => {
    const over = v.costVsChampion !== null && v.costVsChampion > 0.3;
    return `<tr>
      <th scope="row">${esc(v.generator)}</th>
      <td>${esc(v.variantId)}${v.isChampion ? ' <span class="badge">champion</span>' : ""}</td>
      <td>${esc(v.model)}</td>
      <td class="num">${int(v.calls)}</td>
      <td class="num">${pct(v.allocation, 0)}</td>
      <td class="num">${usd(v.usdPerCall)}</td>
      <td class="num${over ? " bad" : ""}">${esc(signedPct(v.costVsChampion))}</td>
      <td class="num">${int(v.up)} / ${int(v.down)}</td>
      <td class="num">${int(v.regenerations)}</td>
      <td class="num">${v.qualityProxy.toFixed(2)}</td>
    </tr>`;
  }).join("");
  return `<table class="grid-table"><thead><tr><th>gen</th><th>arm</th><th>model</th><th class="num">calls</th><th class="num">alloc</th><th class="num">$/call</th><th class="num">vs champion</th><th class="num">👍/👎</th><th class="num">regens</th><th class="num">quality</th></tr></thead><tbody>${body}</tbody></table>`;
}

function tile(label, value, sub, tone = "") {
  return `<div class="tile ${tone}"><div class="tile-label">${esc(label)}</div><div class="tile-value">${esc(value)}</div><div class="tile-sub">${esc(sub ?? "")}</div></div>`;
}

function renderHtml(report, source) {
  const days = report.perDay ?? [];
  const points = days.map((d) => ({ ...d, label: d.day.slice(5) }));
  const alarms = alarmLines(report);
  const firing = alarms.filter(([f]) => f);
  const down = report.ratings.down;
  const rated = report.ratings.up + down;
  const t = report.thresholds ?? { CACHE_HIT_MIN: 0.8, TTFT_P95_MAX_MS: 3000 };

  const banner = firing.length
    ? `<div class="banner bad"><strong>${firing.length} alarm${firing.length > 1 ? "s" : ""} firing</strong><ul>${firing.map(([, m]) => `<li>${esc(m)}</li>`).join("")}</ul></div>`
    : `<div class="banner ok"><strong>All §6.4 alarms clear</strong> — cache ≥ ${pct(t.CACHE_HIT_MIN, 0)}, no arm &gt; +30% over champion, TTFT P95 ≤ ${ms(t.TTFT_P95_MAX_MS)}.</div>`;

  return `<title>LLM Cost Dashboard</title>
<style>
  :root{
    --bg:#f7f7f5; --card:#ffffff; --ink:#16161a; --muted:#6b6b76; --line:#e2e2dd;
    --ok:#2f7d5a; --bad:#c0392b; --okbg:#e8f5ee; --badbg:#fdecea;
  }
  @media (prefers-color-scheme: dark){
    :root:not([data-theme="light"]){
      --bg:#131316; --card:#1b1b1f; --ink:#ececf0; --muted:#9a9aa6; --line:#2c2c33;
      --ok:#63c79a; --bad:#f08076; --okbg:#152a21; --badbg:#2c1a19;
    }
  }
  :root[data-theme="dark"]{
    --bg:#131316; --card:#1b1b1f; --ink:#ececf0; --muted:#9a9aa6; --line:#2c2c33;
    --ok:#63c79a; --bad:#f08076; --okbg:#152a21; --badbg:#2c1a19;
  }
  *{box-sizing:border-box}
  body{background:var(--bg);color:var(--ink);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;margin:0;padding:28px 20px 64px}
  main{max-width:1080px;margin:0 auto}
  h1{font-size:22px;margin:0 0 4px}
  h2{font-size:15px;margin:0 0 12px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
  .sub{color:var(--muted);margin:0 0 20px;font-size:13px}
  section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px;margin-bottom:18px}
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
  .tile{border:1px solid var(--line);border-radius:10px;padding:12px 14px;background:var(--bg)}
  .tile-label{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em}
  .tile-value{font-size:22px;font-weight:700;margin-top:4px;font-variant-numeric:tabular-nums}
  .tile-sub{color:var(--muted);font-size:12px;margin-top:2px;min-height:18px}
  .tile.bad .tile-value{color:var(--bad)}
  .tile.ok .tile-value{color:var(--ok)}
  .banner{border-radius:10px;padding:12px 16px;margin-bottom:18px;border:1px solid var(--line)}
  .banner.ok{background:var(--okbg);border-color:var(--ok)}
  .banner.bad{background:var(--badbg);border-color:var(--bad)}
  .banner ul{margin:6px 0 0 18px;padding:0}
  svg{width:100%;height:auto;display:block}
  .grid{stroke:var(--line);stroke-width:1}
  .tick{fill:var(--muted);font-size:11px}
  .alarm-line{stroke:var(--bad);stroke-width:1.5;stroke-dasharray:5 4}
  .alarm-text{fill:var(--bad)}
  .legend{display:flex;flex-wrap:wrap;gap:14px;margin-bottom:8px;color:var(--muted);font-size:12px}
  .key{display:inline-flex;align-items:center;gap:6px}
  .key i{width:10px;height:10px;border-radius:2px;display:inline-block}
  .scroll{overflow-x:auto}
  table.grid-table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;font-size:13px}
  table.grid-table th,table.grid-table td{border-bottom:1px solid var(--line);padding:7px 10px;text-align:left;white-space:nowrap}
  table.grid-table thead th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.03em}
  table.grid-table td.num,table.grid-table th.num{text-align:right}
  td.bad{color:var(--bad);font-weight:700}
  .badge{background:var(--okbg);color:var(--ok);border:1px solid var(--ok);border-radius:999px;padding:0 7px;font-size:11px}
  .bar{display:flex;height:14px;border-radius:3px;overflow:hidden;min-width:200px;background:var(--line)}
  .seg{display:block;height:100%}
  .barcell{width:60%}
  .empty{color:var(--muted);font-style:italic}
  footer{color:var(--muted);font-size:12px;text-align:center;margin-top:24px}
</style>
<main>
  <h1>LLM cost dashboard</h1>
  <p class="sub">${esc(report.since)} → ${esc(report.until)} · ${esc(String(report.days ?? days.length))} day window · source: ${esc(source)} · generated ${esc(new Date().toISOString())}</p>
  ${banner}

  <section>
    <h2>Headline</h2>
    <div class="tiles">
      ${tile("$ / action", usd(report.perAction.usdPerAction), `${int(report.perAction.actions)} energy spends`)}
      ${tile("$ / active user", usd(report.perAction.usdPerActiveUser), "distinct users with a call")}
      ${tile("total cost", usd(report.totals.costUsd, 4), `${int(report.totals.calls)} generator calls`)}
      ${tile("cache hit rate", pct(report.cacheHitRate, 1), `floor ${pct(t.CACHE_HIT_MIN, 0)}`, report.alarms?.cacheHitRateLow ? "bad" : "ok")}
      ${tile("TTFT P95", ms(report.ttft?.p95Ms), `P50 ${ms(report.ttft?.p50Ms)} · budget ${ms(t.TTFT_P95_MAX_MS)}`, report.alarms?.ttftP95High ? "bad" : "ok")}
      ${tile("latency P50 / P95", `${ms(report.totals.p50LatencyMs)} / ${ms(report.totals.p95LatencyMs)}`, "end to end")}
      ${tile("fallback rate", pct(safeDiv(report.totals.fallbacks, report.totals.calls), 2), `${int(report.totals.fallbacks)} refunded actions`)}
      ${tile("👎 rate", pct(safeDiv(down, rated), 1), `${int(down)} of ${int(rated)} rated`)}
      ${tile("regeneration rate", pct(safeDiv(report.ratings.regenerations, report.totals.calls), 2), `${int(report.ratings.regenerations)} escalated calls`)}
    </div>
  </section>

  <section>
    <h2>$ / action and $ / DAU over time</h2>
    ${lineChart(points, [
      { name: "$/action", value: (p) => p.usdPerAction },
      { name: "$/active user", value: (p) => p.usdPerActiveUser },
    ], { title: "cost per action and per active user", fmt: (v) => usd(v, 4) })}
  </section>

  <section>
    <h2>Cache hit rate</h2>
    ${lineChart(points, [{ name: "cache hit rate", value: (p) => p.cacheHitRate }], {
      title: "cache hit rate", fmt: (v) => pct(v, 0), minMax: 1,
      guide: { value: t.CACHE_HIT_MIN, label: `alarm ${pct(t.CACHE_HIT_MIN, 0)}` },
    })}
  </section>

  <section>
    <h2>Time to first token</h2>
    ${lineChart(points, [
      { name: "TTFT P50", value: (p) => p.ttftP50Ms },
      { name: "TTFT P95", value: (p) => p.ttftP95Ms },
    ], { title: "time to first token", fmt: (v) => `${Math.round(v)}ms`, guide: { value: t.TTFT_P95_MAX_MS, label: `alarm ${ms(t.TTFT_P95_MAX_MS)}` } })}
  </section>

  <section>
    <h2>Token composition per generator</h2>
    <div class="scroll">${tokenComposition(report.byGenerator)}</div>
  </section>

  <section>
    <h2>Variant allocation</h2>
    <div class="scroll">${variantTable(report.variants)}</div>
    <p class="sub" style="margin:12px 0 0">quality proxy = 1 − (👎 + regenerations) / calls. “vs champion” compares $/call with the generator's champion arm; over +30% raises the §6.4 alarm.</p>
  </section>

  <section>
    <h2>By day</h2>
    <div class="scroll">${breakdownTable(report.byDay)}</div>
  </section>

  <section>
    <h2>By generator</h2>
    <div class="scroll">${breakdownTable(report.byGenerator)}</div>
  </section>

  <section>
    <h2>By variant</h2>
    <div class="scroll">${breakdownTable(report.byVariant)}</div>
  </section>

  <section>
    <h2>By model</h2>
    <div class="scroll">${breakdownTable(report.byModel)}</div>
  </section>

  <footer>cost-architecture §6.4 · generated by scripts/cost-report.mjs · no external assets</footer>
</main>`;
}

/* ------------------------------------------------------------------ main ---- */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }
  const { report, source } = await loadReport(args.days);
  if (args.html) {
    const path = resolve(process.cwd(), args.html);
    writeFileSync(path, renderHtml(report, source), "utf8");
    if (!args.json) process.stderr.write(`wrote ${path}\n`);
  }
  process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : renderText(report, source));
}

main().catch((err) => {
  process.stderr.write(`cost-report: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
