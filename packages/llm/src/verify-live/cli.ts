import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createGateway } from "../gateway.js";
import { isWorldGenre, planRun } from "./plan.js";
import { renderHtml } from "./report-html.js";
import { estimateBanner, renderText } from "./report-text.js";
import { createStubLiveGateway } from "./stub-gateway.js";
import {
  API_KEY_ENV,
  createCollector,
  estimateRun,
  preflightLive,
  runVerification,
  VerifyRefusal,
} from "./run.js";
import type { VerifyReport } from "./types.js";

/**
 * `pnpm --filter llm verify:live` — the command somebody runs the morning a key arrives.
 *
 * Exit codes are meant for a person and for CI alike:
 *   0  the run happened and answered
 *   1  refused before spending anything (no key, wrong mode, over budget)
 *   2  the run happened and something it measures is wrong
 */

export const USAGE = `verify:live — generate worlds against the real model and report what they are

  pnpm --filter llm verify:live [options]

  --stub              rehearse against the stub gateway. No key, no spend, no evidence.
  --estimate-only     print what a run would cost and stop. Needs no key.
  --genres a,b,c      only these world genres (both premises of each are always kept)
  --pairs N           only the first N genres
  --no-hard           drop the two hard cases (premise echo, 400-char premise)
  --max-usd N         refuse to start if the estimate exceeds this
  --concurrency N     worlds built at once (default 2; each is 14 dependent calls)
  --timeout N         seconds one world may take before it is scored zero (default 600)
  --out DIR           where the report is written (default packages/llm/.verify)
  --json              also print the whole report as JSON on stdout
  --help

  env  ${API_KEY_ENV}   required, unless --stub or --estimate-only
       LLM_MODE            must be unset or "live"
       LLM_MODEL_HIGH|MID|LIGHT   the model ids (never hardcoded at a call site)
`;

export interface CliArgs {
  stub: boolean;
  estimateOnly: boolean;
  genres: string[];
  pairs: number | undefined;
  hard: boolean;
  maxUsd: number | undefined;
  concurrency: number;
  timeoutMs: number;
  out: string;
  json: boolean;
  help: boolean;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    stub: false,
    estimateOnly: false,
    genres: [],
    pairs: undefined,
    hard: true,
    maxUsd: undefined,
    concurrency: 2,
    timeoutMs: 600_000,
    out: ".verify",
    json: false,
    help: false,
  };
  const value = (i: number): string => {
    const v = argv[i + 1];
    if (v === undefined) throw new VerifyRefusal(`${argv[i] ?? ""} needs a value`, USAGE);
    return v;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? "";
    if (a === "--stub") args.stub = true;
    else if (a === "--estimate-only" || a === "--estimate") args.estimateOnly = true;
    else if (a === "--no-hard") args.hard = false;
    else if (a === "--json") args.json = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--genres") { args.genres = value(i).split(",").map((s) => s.trim()).filter((s) => s !== ""); i += 1; }
    else if (a === "--pairs") { args.pairs = Number(value(i)); i += 1; }
    else if (a === "--max-usd") { args.maxUsd = Number(value(i)); i += 1; }
    else if (a === "--concurrency") { args.concurrency = Math.max(1, Number(value(i))); i += 1; }
    else if (a === "--timeout") { args.timeoutMs = Math.max(1, Number(value(i))) * 1000; i += 1; }
    else if (a === "--out") { args.out = value(i); i += 1; }
    else throw new VerifyRefusal(`unknown argument: ${a}`, USAGE);
  }
  for (const g of args.genres) {
    if (!isWorldGenre(g)) throw new VerifyRefusal(`unknown genre: ${g}`, USAGE);
  }
  return args;
}

export interface CliIo {
  out: (s: string) => void;
  err: (s: string) => void;
  writeFile: (path: string, contents: string) => void;
  mkdir: (path: string) => void;
  env: NodeJS.ProcessEnv;
}

const nodeIo: CliIo = {
  out: (s) => process.stdout.write(`${s}\n`),
  err: (s) => process.stderr.write(`${s}\n`),
  writeFile: (path, contents) => writeFileSync(path, contents, "utf8"),
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  env: process.env,
};

function stamp(d: Date): string {
  return d.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

export async function main(argv: readonly string[], io: CliIo = nodeIo): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    if (err instanceof VerifyRefusal) {
      io.err(`verify:live — ${err.message}\n\n${err.hint}`);
      return 1;
    }
    throw err;
  }
  if (args.help) {
    io.out(USAGE);
    return 0;
  }

  const plan = planRun({
    ...(args.genres.length > 0
      ? { genres: args.genres.filter(isWorldGenre) }
      : {}),
    ...(args.pairs === undefined ? {} : { maxPairs: args.pairs }),
    hard: args.hard,
  });
  if (plan.worlds === 0) {
    io.err("verify:live — the plan selected no cases. Check --genres / --pairs.");
    return 1;
  }

  // The refusal comes before anything is built, and names the variable.
  if (!args.stub && !args.estimateOnly) {
    try {
      preflightLive(io.env);
    } catch (err) {
      if (err instanceof VerifyRefusal) {
        io.err(`\nverify:live — ${err.message}\n\n${err.hint}\n`);
        return 1;
      }
      throw err;
    }
  }

  const estimate = await estimateRun(plan);
  io.out(estimateBanner(plan, estimate));
  if (args.estimateOnly) {
    io.out("\n--estimate-only: nothing was generated and nothing was spent.");
    return 0;
  }
  if (args.maxUsd !== undefined && estimate.totalUsd > args.maxUsd) {
    io.err(
      `\nverify:live — estimated $${estimate.totalUsd.toFixed(2)} exceeds --max-usd ${args.maxUsd.toFixed(2)}. Nothing was spent.`,
    );
    return 1;
  }
  io.out(
    args.stub
      ? "\nSTUB — rehearsing the harness against the stub gateway. No key is used and nothing is spent.\n"
      : `\nRunning live. ${plan.worlds} worlds, ${args.concurrency} at a time. Ctrl-C stops it; anything already logged is already billed.\n`,
  );

  const collector = createCollector();
  const gateway = args.stub
    ? createStubLiveGateway({ onGeneration: collector.onGeneration })
    : createGateway({ mode: "live", onGeneration: collector.onGeneration });

  let report: VerifyReport;
  try {
    report = await runVerification({
      gateway,
      metas: collector.metas,
      mode: args.stub ? "stub" : "live",
      plan,
      concurrency: args.concurrency,
      timeoutMs: args.timeoutMs,
      estimate: false,
      env: io.env,
    });
    report.spend.estimateUsd = estimate.totalUsd;
    report.spend.estimatePerWorldUsd = estimate.perWorldUsd;
  } catch (err) {
    if (err instanceof VerifyRefusal) {
      io.err(`\nverify:live — ${err.message}\n\n${err.hint}\n`);
      return 1;
    }
    throw err;
  }

  const dir = resolve(args.out);
  const prefix = `${args.stub ? "verify-stub" : "verify-live"}-${stamp(new Date(report.startedAt))}`;
  io.mkdir(dir);
  const htmlPath = join(dir, `${prefix}.html`);
  const jsonPath = join(dir, `${prefix}.json`);
  io.writeFile(htmlPath, renderHtml(report));
  io.writeFile(jsonPath, JSON.stringify(report, null, 2));

  io.out(renderText(report, htmlPath));
  io.out(`\nreport: ${htmlPath}\nraw:    ${jsonPath}`);
  if (args.json) io.out(JSON.stringify(report));

  return exitCodeFor(report);
}

/**
 * 0 or 2, never "it ran, so it worked". A CI job that runs this must go red when a question the
 * harness exists to ask has been answered "no", and when a run that claimed to be live was not.
 * `human` is not a failure: it means the machine got as far as a machine can.
 */
export function exitCodeFor(report: VerifyReport): number {
  const broken =
    report.answers.some((a) => a.verdict === "fail") ||
    (report.mode === "live" && !report.evidence.live);
  return broken ? 2 : 0;
}
