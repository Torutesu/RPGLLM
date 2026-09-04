#!/usr/bin/env node
/**
 * §6.2 — the offline evaluation gate as a CLI.
 *
 *   node scripts/eval.mjs --generator G1                run every registered variant, print the table
 *   node scripts/eval.mjs --generator G1 --variant g1-haiku-v1
 *   node scripts/eval.mjs --generator G1 --limit 20     cap the case set (money, or patience)
 *   node scripts/eval.mjs --generator G1 --no-run       only print the comparison of past runs
 *   node scripts/eval.mjs --generator G1 --json
 *
 * Source of the numbers: Postgres, through **the same services the API uses**
 * (`apps/api/src/services/evals.ts`), loaded with tsx. There is no second implementation.
 *
 * `LLM_MODE` decides who generates and who judges. In `replay` (the default, and the only mode
 * that works without an API key) the generator is the deterministic fixture set and the judge is
 * the deterministic heuristic in `packages/llm/src/generators/gj.ts` — the table is real and
 * reproducible, but the judge is a stand-in. With `LLM_MODE=live` and an API key the same code
 * runs the real Batch tier and Opus 5 as the judge.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

function parseArgs(argv) {
  const out = { generator: "G1", variant: null, limit: 50, run: true, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--generator" || a === "-g") { out.generator = argv[++i]; continue; }
    if (a === "--variant" || a === "-v") { out.variant = argv[++i]; continue; }
    if (a === "--limit" || a === "-l") { out.limit = Number(argv[++i]); continue; }
    if (a === "--no-run") { out.run = false; continue; }
    if (a === "--json") { out.json = true; continue; }
    if (a === "--help" || a === "-h") { out.help = true; continue; }
    if (a.startsWith("--generator=")) { out.generator = a.slice(12); continue; }
    if (a.startsWith("--variant=")) { out.variant = a.slice(10); continue; }
    if (a.startsWith("--limit=")) { out.limit = Number(a.slice(8)); continue; }
    throw new Error(`unknown argument: ${a}`);
  }
  if (!Number.isFinite(out.limit) || out.limit < 1) out.limit = 50;
  return out;
}

const USAGE = `eval — offline evaluation gate (cost-architecture §6.2)

  node scripts/eval.mjs [--generator G1] [--variant ID] [--limit N] [--no-run] [--json]

  --generator G   which generator's frozen set to run (default G1)
  --variant ID    only this variant (default: every variant in the registry)
  --limit N       cases per run (default 50, the frozen set size)
  --no-run        skip running; just compare the runs already stored
  --json          machine-readable output

  env  DATABASE_URL   Postgres (default postgresql://postgres@127.0.0.1:5432/rpgllm)
       LLM_MODE       replay (default) | live | fail
`;

const pad = (s, n, align = "l") => {
  const text = String(s);
  const gap = Math.max(0, n - text.length);
  return align === "r" ? " ".repeat(gap) + text : text + " ".repeat(gap);
};

function table(headers, rows, align = []) {
  const widths = headers.map((h, i) => Math.max(String(h).length, ...rows.map((r) => String(r[i] ?? "").length)));
  const line = (cells) => cells.map((c, i) => pad(c, widths[i], align[i] ?? "l")).join("  ");
  return [line(headers), line(widths.map((w) => "-".repeat(w))), ...rows.map((r) => line(r))].join("\n");
}

const usd = (n, d = 6) => `$${Number(n ?? 0).toFixed(d)}`;
const pct = (n, d = 1) => `${(Number(n ?? 0) * 100).toFixed(d)}%`;
const signedPct = (n) => `${Number(n) >= 0 ? "+" : ""}${(Number(n ?? 0) * 100).toFixed(1)}%`;
const signed = (n, d = 2) => `${Number(n) >= 0 ? "+" : ""}${Number(n ?? 0).toFixed(d)}`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (process.env.LLM_MODE === undefined) process.env.LLM_MODE = "replay";
  // Batch and replay latency are simulated; an eval run of 50 cases should not take 50 naps.
  if (process.env.LLM_REPLAY_LATENCY_MS === undefined) process.env.LLM_REPLAY_LATENCY_MS = "0";

  const { register } = await import("tsx/esm/api");
  const unregister = register();
  try {
    const evals = await import(pathToFileURL(resolve(REPO_ROOT, "apps/api/src/services/evals.ts")).href);
    const bandit = await import(pathToFileURL(resolve(REPO_ROOT, "apps/api/src/services/bandit.ts")).href);
    const { createClock } = await import(pathToFileURL(resolve(REPO_ROOT, "apps/api/src/clock.ts")).href);
    const { createGateway, GENERATOR_EXPERIMENTS } = await import(pathToFileURL(resolve(REPO_ROOT, "packages/llm/src/index.ts")).href);
    const { PrismaClient } = await import("@prisma/client");

    const url = process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/rpgllm";
    const prisma = new PrismaClient({ datasources: { db: { url } } });
    const deps = { prisma, gateway: createGateway(), clock: createClock() };

    try {
      const seeded = await evals.seedEvalCases(prisma);
      await bandit.ensureArms(prisma);
      const arms = await bandit.loadArms(prisma, args.generator);
      const champion = arms.find((a) => a.isChampion)?.variantId ?? null;

      const experiment = GENERATOR_EXPERIMENTS.find((e) => e.generator === args.generator);
      const variants = args.variant
        ? [args.variant]
        : (experiment?.variants.map((v) => v.id) ?? (champion ? [champion] : []));

      const runs = [];
      if (args.run) {
        for (const variantId of variants) {
          const started = Date.now();
          const res = await evals.startEvalRun(deps, { generator: args.generator, variantId, limit: args.limit });
          runs.push({
            variantId,
            status: res.status,
            cases: res.result?.cases ?? 0,
            passed: res.result?.passed ?? 0,
            meanScore: res.result?.meanScore ?? 0,
            costUsd: res.result?.costUsd ?? 0,
            generatorCostUsd: res.result?.generatorCostUsd ?? 0,
            judgeCostUsd: res.result?.judgeCostUsd ?? 0,
            wallMs: Date.now() - started,
          });
        }
      }

      const compare = await evals.compareEvals(prisma, args.generator, champion);

      if (args.json) {
        process.stdout.write(`${JSON.stringify({ seeded, champion, runs, compare }, null, 2)}\n`);
        return;
      }

      const out = [];
      out.push(`offline eval — ${args.generator} · mode ${process.env.LLM_MODE} · ${seeded.total} frozen cases (${seeded.fromProduction} rebuilt from production posts)`);
      out.push(`champion: ${champion ?? "(none)"}   db: ${url.replace(/:[^:@/]*@/, ":***@")}`);
      if (runs.length > 0) {
        out.push("");
        out.push("RUNS");
        out.push(
          table(
            ["variant", "status", "cases", "passed", "mean score", "gen $", "judge $", "total $", "wall"],
            runs.map((r) => [
              r.variantId, r.status, r.cases, r.passed, r.meanScore.toFixed(2),
              usd(r.generatorCostUsd), usd(r.judgeCostUsd), usd(r.costUsd), `${(r.wallMs / 1000).toFixed(1)}s`,
            ]),
            ["l", "l", "r", "r", "r", "r", "r", "r", "r"],
          ),
        );
      }
      out.push("");
      out.push("COMPARISON (§6.2 gate: within 2 pts and >=20% cheaper, or >=3 pts better)");
      out.push(
        table(
          ["variant", "", "runs", "cases", "pass rate", "mean score", "$/case", "Δscore", "Δcost", "gate"],
          compare.rows.map((r) => [
            r.variantId, r.variantId === champion ? "champ" : "", r.runs, r.cases, pct(r.passRate),
            r.meanScore.toFixed(2), usd(r.usdPerCase, 8), signed(r.scoreDelta), signedPct(r.costDelta),
            r.variantId === champion ? "baseline" : r.passesGate ? "PASS" : "fail",
          ]),
          ["l", "l", "r", "r", "r", "r", "r", "r", "r", "l"],
        ),
      );
      out.push("");
      process.stdout.write(`${out.join("\n")}\n`);
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    unregister();
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exitCode = 1;
});
