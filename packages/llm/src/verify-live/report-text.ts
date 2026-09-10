import { gemEconomics } from "./run.js";
import type { CostEstimate } from "./run.js";
import type { VerifyPlan } from "./plan.js";
import type { Answer, VerifyReport } from "./types.js";

/** The terminal half of the report: what an operator reads while it is still running. */

const usd = (n: number, d = 4): string => `$${n.toFixed(d)}`;
const pct = (n: number, d = 1): string => `${(n * 100).toFixed(d)}%`;
const num = (n: number | null, d = 2): string => (n === null ? "  n/a" : n.toFixed(d));

function pad(s: string, n: number, right = false): string {
  const gap = Math.max(0, n - s.length);
  return right ? " ".repeat(gap) + s : s + " ".repeat(gap);
}

export function table(headers: readonly string[], rows: ReadonlyArray<readonly string[]>): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: readonly string[]): string =>
    cells
      .map((c, i) => pad(c, widths[i] ?? 0, i > 0))
      .join("  ")
      .trimEnd();
  return [line(headers), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)].join("\n");
}

const MARK: Record<Answer["verdict"], string> = {
  pass: "[PASS]",
  fail: "[FAIL]",
  human: "[NEEDS A HUMAN]",
  unknown: "[NO DATA]",
};

/** What is printed *before* the money is spent. */
export function estimateBanner(plan: VerifyPlan, estimate: CostEstimate): string {
  const rows = estimate.stages.map((s) => [s.stage, String(s.calls), usd(s.costUsd, 4), `${s.usage.outputTokens} out`]);
  return [
    `plan: ${plan.worlds} worlds (${plan.genres.join(", ")}), ${plan.generatorCalls} generator calls + ${plan.judgeCalls} judgements`,
    ``,
    table(["stage", "calls", "est. $", "output"], rows),
    ``,
    `ESTIMATE  ${usd(estimate.totalUsd, 2)} total · ${usd(estimate.perWorldUsd, 4)} per world`,
    `(measured by running this exact plan in replay and pricing its tokens at live rates;`,
    ` live output runs longer, so treat it as a floor with the right shape.)`,
  ].join("\n");
}

export function renderText(report: VerifyReport, htmlPath: string | null): string {
  const out: string[] = [];
  const banner =
    report.mode === "live"
      ? report.evidence.live
        ? "LIVE RUN — real model calls, real money"
        : "*** NOT A LIVE RUN *** — this run claimed live and did not deliver it"
      : "STUB RUN — NOT LIVE. Nothing here is evidence about a model.";
  out.push("=".repeat(78), banner, "=".repeat(78), "");
  if (!report.evidence.live && report.mode === "live") {
    for (const r of report.evidence.reasons) out.push(`  ! ${r}`);
    out.push("");
  }
  out.push(
    `mode ${report.mode} · ${report.plan.worlds} worlds · ${report.evidence.calls} logged calls · models ${report.evidence.models.join(", ")}`,
    `judge: ${report.mode === "stub" ? "stub — the deterministic rubric wearing live metas" : report.judgeSource} · variant ${report.variantId} · ${(report.durationMs / 1000).toFixed(0)}s`,
    "",
  );

  out.push("THE THREE QUESTIONS", "-".repeat(78));
  for (const a of report.answers) {
    out.push(`${MARK[a.verdict]} ${a.question}`, `   ${a.headline}`, "");
  }

  out.push("WHAT IT COST", "-".repeat(78));
  out.push(
    table(
      ["stage", "calls", "in", "cache w", "cache r", "out", "$", "$/world"],
      report.spend.stages.map((s) => [
        s.stage,
        String(s.calls),
        String(s.usage.inputTokens),
        String(s.usage.cacheWriteTokens),
        String(s.usage.cacheReadTokens),
        String(s.usage.outputTokens),
        usd(s.costUsd, 4),
        usd(report.spend.worlds === 0 ? 0 : s.costUsd / report.spend.worlds, 4),
      ]),
    ),
  );
  const gems = gemEconomics(report.spend.usdPerWorld);
  out.push(
    "",
    `total ${usd(report.spend.totalUsd, 4)} · ${usd(report.spend.usdPerWorld, 4)} per world · cache hit ${pct(report.spend.cacheHitRate)}`,
    report.spend.estimateUsd === null
      ? "no pre-run estimate was taken"
      : `estimate was ${usd(report.spend.estimateUsd, 2)} (${usd(report.spend.estimatePerWorldUsd ?? 0, 4)}/world) — actual is ${((report.spend.totalUsd / Math.max(report.spend.estimateUsd, 1e-9) - 1) * 100).toFixed(0)}% off`,
    `gtm.md §2 priced a world at $${gems.assumedUsd.toFixed(2)}; measured here ${usd(report.spend.usdPerWorld, 4)}.`,
    `120 gems = ${usd(gems.packUsd, 2)} → ${usd(gems.marginBeforeReviewUsd, 2)} before human review, ${usd(gems.marginAfterReviewUsd, 2)} after it.`,
    "",
  );

  out.push("DO TWO PREMISES MAKE TWO WORLDS", "-".repeat(78));
  out.push(
    table(
      ["genre", "bible lines", "(blueprint)", "cast cards", "(blueprint)", "handles", "names", "distinct"],
      report.distinctness.pairs.map((p) => [
        p.genre,
        num(p.live?.bibleLineOverlap ?? null),
        num(p.blueprint?.bibleLineOverlap ?? null),
        num(p.live?.castCardOverlap ?? null),
        num(p.blueprint?.castCardOverlap ?? null),
        num(p.live?.handleOverlap ?? null),
        num(p.live?.displayNameOverlap ?? null),
        p.live === null ? "n/a" : p.live.distinct ? "yes" : "NO",
      ]),
    ),
  );
  out.push(
    "",
    `mean bible-line overlap: live ${num(report.distinctness.meanBibleLineOverlapLive)} · blueprint ${num(report.distinctness.meanBibleLineOverlapBlueprint)} · different genres ${num(report.distinctness.crossGenreLive)}`,
    "",
  );

  if (report.failures.length > 0) {
    out.push("WHAT WENT WRONG (a result, not an error)", "-".repeat(78));
    out.push(
      table(
        ["case/hash", "stage", "kind", "detail"],
        report.failures.slice(0, 20).map((f) => [f.key, f.stage, f.kind, f.detail]),
      ),
    );
    if (report.failures.length > 20) out.push(`... and ${report.failures.length - 20} more`);
    out.push("");
  }

  out.push("THE GATE", "-".repeat(78));
  out.push(
    `${report.gate.passed}/${report.gate.cases} cases passed · mean score ${report.gate.meanScore.toFixed(1)}`,
    "",
  );

  for (const note of report.notes) out.push(`note: ${note}`);
  if (htmlPath !== null) {
    out.push(
      "",
      `The Japanese question needs a person and one screen: ${htmlPath}`,
      "It puts the JA and EN halves of a world side by side with the checklist. Ten minutes.",
    );
  }
  return out.join("\n");
}
