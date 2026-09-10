import { gemEconomics } from "./run.js";
import type { Answer, VerifyReport } from "./types.js";

/**
 * The self-contained page. One file, no assets, no network — it is going to be opened from a
 * terminal on somebody's laptop and possibly forwarded, so it carries everything it needs.
 *
 * Its reason to exist beyond the terminal output is the last section: question 1 cannot be
 * settled by a number, so the page puts the Japanese and the English halves of the same world in
 * two columns with the checklist beside them, and a person answers it in one screen.
 */

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const usd = (n: number, d = 4): string => `$${n.toFixed(d)}`;
const pct = (n: number, d = 1): string => `${(n * 100).toFixed(d)}%`;
const num = (n: number | null, d = 2): string => (n === null ? "—" : n.toFixed(d));

function rows(cells: ReadonlyArray<ReadonlyArray<string>>): string {
  return cells.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("");
}

function tableOf(headers: readonly string[], body: ReadonlyArray<ReadonlyArray<string>>): string {
  return `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows(body)}</tbody></table>`;
}

const VERDICT_CLASS: Record<Answer["verdict"], string> = {
  pass: "ok",
  fail: "bad",
  human: "warn",
  unknown: "muted",
};
const VERDICT_TEXT: Record<Answer["verdict"], string> = {
  pass: "PASS",
  fail: "FAIL",
  human: "NEEDS A HUMAN",
  unknown: "NO DATA",
};

const CSS = `
:root{--fg:#16181c;--bg:#fff;--mut:#667;--line:#e3e6ea;--ok:#0a7c42;--bad:#b3261e;--warn:#8a5a00;--live:#0a7c42;--stub:#8a5a00}
*{box-sizing:border-box}
body{margin:0;font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Hiragino Sans","Noto Sans JP",sans-serif;color:var(--fg);background:var(--bg)}
main{max-width:1180px;margin:0 auto;padding:24px 20px 80px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:36px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line)}
h3{font-size:14px;margin:22px 0 8px}
.banner{padding:14px 18px;border-radius:8px;color:#fff;font-weight:700;letter-spacing:.02em}
.banner.live{background:var(--live)}.banner.stub{background:var(--stub)}.banner.broken{background:var(--bad)}
.banner small{display:block;font-weight:400;opacity:.92;margin-top:4px;letter-spacing:0}
.meta{color:var(--mut);margin:10px 0 0}
table{border-collapse:collapse;width:100%;margin:8px 0;font-variant-numeric:tabular-nums}
th,td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-weight:600;color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:.04em}
td+td,th+th{text-align:right}
td:first-child{white-space:nowrap}
.q{border:1px solid var(--line);border-radius:8px;padding:14px 16px;margin:10px 0}
.tag{display:inline-block;padding:2px 8px;border-radius:99px;font-size:12px;font-weight:700;color:#fff}
.tag.ok{background:var(--ok)}.tag.bad{background:var(--bad)}.tag.warn{background:var(--warn)}.tag.muted{background:#889}
.head{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;margin:8px 0}
.lim{color:var(--mut);font-size:13px}
ul{margin:6px 0 0 18px;padding:0}
.pair{display:grid;grid-template-columns:150px 1fr 1fr;gap:0;border-top:1px solid var(--line)}
.pair>div{padding:8px 10px;border-bottom:1px solid var(--line)}
.pair .f{color:var(--mut);font-size:12px;background:#fafbfc}
.pair .ja{border-left:1px solid var(--line)}
.pair .same{background:#fff4f4}
.pairhead{display:grid;grid-template-columns:150px 1fr 1fr;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut)}
.pairhead>div{padding:6px 10px}
pre{white-space:pre-wrap;word-break:break-word;margin:0;font:inherit}
.check{background:#fbfbfd;border:1px solid var(--line);border-radius:8px;padding:12px 16px}
.muted{color:var(--mut)}
.big{font-size:26px;font-weight:700;font-variant-numeric:tabular-nums}
@media(prefers-color-scheme:dark){
:root{--fg:#e6e8ea;--bg:#131518;--mut:#98a0aa;--line:#2a2f36}
.pair .f{background:#181b1f}.pair .same{background:#3a2020}.check{background:#181b1f}
}
`;

export function renderHtml(report: VerifyReport): string {
  const gems = gemEconomics(report.spend.usdPerWorld);
  const bannerClass = report.mode === "stub" ? "stub" : report.evidence.live ? "live" : "broken";
  const bannerText =
    report.mode === "stub"
      ? "STUB RUN — NOT LIVE"
      : report.evidence.live
        ? "LIVE RUN"
        : "NOT A LIVE RUN — this run claimed live and did not deliver it";
  const bannerSub =
    report.mode === "stub"
      ? "Generated against the stub gateway: the deterministic blueprint put through the transformation a good live run would make, returned with live-shaped metas. Every number below exercises the harness; none of it is evidence about a model."
      : report.evidence.live
        ? `${report.evidence.calls} model calls, ${report.evidence.models.join(", ")}. Judge: ${report.judgeSource}.`
        : report.evidence.reasons.join(" · ");

  const answers = report.answers
    .map(
      (a) => `<div class="q">
      <span class="tag ${VERDICT_CLASS[a.verdict]}">${VERDICT_TEXT[a.verdict]}</span>
      <strong> ${esc(a.question)}</strong>
      <div class="head">${esc(a.headline)}</div>
      <div>${a.detail.map((d) => esc(d)).join(" ")}</div>
      <div class="lim">Cannot settle: ${a.limits.map((l) => esc(l)).join(" ")}</div>
    </div>`,
    )
    .join("");

  const spendRows = report.spend.stages.map((s) => [
    esc(s.stage),
    String(s.calls),
    esc(s.models.join(", ")),
    String(s.usage.inputTokens),
    String(s.usage.cacheWriteTokens),
    String(s.usage.cacheReadTokens),
    String(s.usage.outputTokens),
    String(s.fallbacks),
    usd(s.costUsd),
    usd(report.spend.worlds === 0 ? 0 : s.costUsd / report.spend.worlds),
  ]);

  const distinctRows = report.distinctness.pairs.map((p) => [
    esc(p.genre),
    num(p.live?.bibleLineOverlap ?? null),
    `<span class="muted">${num(p.blueprint?.bibleLineOverlap ?? null)}</span>`,
    num(p.live?.castCardOverlap ?? null),
    `<span class="muted">${num(p.blueprint?.castCardOverlap ?? null)}</span>`,
    num(p.live?.handleOverlap ?? null),
    num(p.live?.displayNameOverlap ?? null),
    p.live === null ? "—" : p.live.distinct ? "yes" : '<b class="tag bad">NO</b>',
  ]);

  const castRows = report.cast.map((c) => [
    esc(c.key),
    c.locale,
    num(c.live?.meanCard ?? null),
    `<span class="muted">${num(c.blueprint?.meanCard ?? null)}</span>`,
    num(c.live?.maxCard ?? null),
    num(c.live?.meanSpeech ?? null),
    `<span class="muted">${num(c.blueprint?.meanSpeech ?? null)}</span>`,
    esc(c.live?.worstPair ?? "—"),
    c.live === null ? "—" : `${c.live.distinctRoles}/${c.live.castSize}`,
  ]);

  const jaRows = report.japanese.rows.map((j) => [
    esc(j.key),
    j.jaCjkRatio.toFixed(2),
    pct(j.jaEchoesEn),
    j.jaRoleCjkRatio.toFixed(2),
    `${j.castRolesLocalized}/${j.castSize}`,
    String(j.bibleTokensJa),
    String(j.bibleTokensEn),
  ]);

  const panels = report.japanese.panels
    .map(
      (p) => `<h3>${esc(p.label)} — ${esc(p.titleJa)} / ${esc(p.titleEn)}</h3>
    <div class="pairhead"><div>field</div><div>English</div><div>日本語</div></div>
    <div class="pair">${p.rows
      .map(
        (r) =>
          `<div class="f">${esc(r.field)}</div><div${r.identical ? ' class="same"' : ""}><pre>${esc(r.en)}</pre></div><div class="ja${r.identical ? " same" : ""}"><pre>${esc(r.ja)}</pre></div>`,
      )
      .join("")}</div>`,
    )
    .join("");

  const failures =
    report.failures.length === 0
      ? '<p class="muted">Nothing refused, timed out or fell back.</p>'
      : tableOf(
          ["case / prompt", "stage", "what happened", "detail"],
          report.failures.map((f) => [esc(f.key), esc(f.stage), esc(f.kind), esc(f.detail)]),
        );

  const gateRows = report.gate.results.map((r) => [
    esc(r.label),
    r.score.toFixed(1),
    (r.machineScore * 100).toFixed(0),
    (r.judgeScore * 100).toFixed(0),
    esc(r.judgeVerdict),
    r.passed ? "pass" : '<b class="tag bad">fail</b>',
    usd(r.costUsd),
    Object.entries(r.machine)
      .filter(([, v]) => !v)
      .map(([k]) => esc(k))
      .join(", ") || "—",
  ]);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>G9 live verification — ${esc(report.startedAt)}</title><style>${CSS}</style></head><body><main>
<div class="banner ${bannerClass}">${esc(bannerText)}<small>${esc(bannerSub)}</small></div>
<h1>World Studio (G9) — live verification</h1>
<p class="meta">${esc(report.startedAt)} → ${esc(report.finishedAt)} · ${(report.durationMs / 1000).toFixed(0)}s ·
${report.plan.worlds} worlds across ${esc(report.plan.genres.join(", "))} ·
variant ${esc(report.variantId)} · gate ${report.gate.passed}/${report.gate.cases} passed, mean ${report.gate.meanScore.toFixed(1)}</p>

<h2>The three questions</h2>
${answers}

<h2>What a world costs</h2>
<p class="big">${usd(report.spend.usdPerWorld)} <span class="muted" style="font-size:14px">per world · ${usd(report.spend.totalUsd, 2)} for this run · cache hit ${pct(report.spend.cacheHitRate)}</span></p>
${tableOf(["stage", "calls", "model", "input", "cache w", "cache r", "output", "fell back", "$", "$/world"], spendRows)}
<p>${
    report.spend.estimateUsd === null
      ? "No pre-run estimate was taken."
      : `Estimated <b>${usd(report.spend.estimateUsd, 2)}</b> before the run (from replay token counts priced at live rates); actual <b>${usd(report.spend.totalUsd, 2)}</b>.`
  }</p>
<p><code>gtm.md</code> §2 prices a world at <b>$${gems.assumedUsd.toFixed(2)}</b> and sells 120 gems for
<b>${usd(gems.packUsd, 2)}</b>. Measured here: <b>${usd(report.spend.usdPerWorld)}</b> — margin
<b>${usd(gems.marginBeforeReviewUsd, 2)}</b> before human review, <b>${usd(gems.marginAfterReviewUsd, 2)}</b> after the
$${gems.reviewUsd.toFixed(2)} review that §2 costs in. Generation was never the expensive half; this run says by how much.</p>

<h2>Do two premises make two worlds?</h2>
<p>Two premises of one genre, one written in English and one in Japanese, and how much of the world they share.
Grey is the deterministic blueprint on the <em>same two premises</em>, measured in this same run — that is the number
this harness exists to beat. Gate limit: ${esc(String(0.5))} on every column.</p>
${tableOf(["genre", "bible lines", "blueprint", "cast cards", "blueprint", "handles", "names", "distinct"], distinctRows)}
<p>Mean bible-line overlap — <b>live ${num(report.distinctness.meanBibleLineOverlapLive)}</b> ·
blueprint <span class="muted">${num(report.distinctness.meanBibleLineOverlapBlueprint)}</span> ·
two worlds of <em>different</em> genres in this run ${num(report.distinctness.crossGenreLive)} (the floor:
that is the fleet-wide scaffolding every world carries).</p>

<h2>Are eight characters eight people?</h2>
<p>Within one world, every pair of cast members: how much their <em>descriptions</em> share (role, card, first post)
and how much their <em>speech</em> shares (the five fallback lines, the welcome post, their ambient posts). Grey is the
blueprint again.</p>
${tableOf(["case", "locale", "description", "blueprint", "worst", "speech", "blueprint", "closest pair", "distinct roles"], castRows)}

<h2>Is the Japanese native, or is it the English translated?</h2>
<p>The machine half — CJK density, how many JA fields are byte-identical to their English twin, whether every role
line was localized:</p>
${tableOf(["case", "CJK ratio", "JA = EN", "role CJK", "roles localized", "bible tok JA", "EN"], jaRows)}
<div class="check"><b>What no number here can tell you:</b> every check above is passed by a competent
<em>translation</em> of the English. Whether the Japanese was <em>written</em> in Japanese is a human call, and it is
the call that decides whether this product is bilingual or localized. Read one world below, JA against EN, with this:
<ul>${report.japanese.checklist.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
Rows highlighted in red are byte-identical across the two columns — English that never got written in Japanese.</div>
${panels === "" ? '<p class="muted">No Japanese-locale world was produced in this run.</p>' : panels}

<h2>What went wrong</h2>
<p>A refusal, a timeout, a safety block and a fallback are results about live behaviour, not errors that lose the run.</p>
${failures}

<h2>The gate, case by case</h2>
${tableOf(["case", "score", "machine", "judge", "verdict", "", "$", "failed checks"], gateRows)}

<p class="meta">${report.notes.map((n) => esc(n)).join("<br>")}</p>
</main></body></html>`;
}
