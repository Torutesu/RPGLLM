#!/usr/bin/env node
/**
 * The dependency audit that is worth failing CI over.
 *
 * `pnpm audit` over this workspace reports ~26 advisories, and the loudest of them live in
 * `react-devtools`, `vitest`, `eslint` and the Expo CLI — build and test tooling that never
 * serves a request. A gate that fails on those is a gate that gets disabled in a week, and then
 * the one advisory that *does* matter goes past with it. (`pnpm audit --prod` is not the answer
 * either: `@expo/cli` is a production dependency of `expo` and still never ships.)
 *
 * So this checks exactly one thing: **the code that accepts requests from the internet**, which
 * is `apps/api`'s runtime tree. An advisory there is an advisory in production.
 *
 * Everything else is still reported by `pnpm audit` and still worth reading; it is simply not
 * allowed to be the reason a green build goes red.
 */
import { execFileSync } from "node:child_process";

/** Packages whose presence in a path means the advisory cannot reach a served request. */
const BUILD_ONLY = [
  "vitest",
  "@vitest/",
  "vite",
  "eslint",
  "typescript-eslint",
  "prettier",
  "tsx>",
  "prisma>",
  "@prisma/config",
  "esbuild",
  "rollup",
];

const FAIL_AT = new Set(["high", "critical"]);

const raw = (() => {
  try {
    return execFileSync("pnpm", ["audit", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    // `pnpm audit` exits non-zero when it finds anything; the JSON is still on stdout.
    if (typeof err.stdout === "string" && err.stdout.length > 0) return err.stdout;
    throw err;
  }
})();

const advisories = Object.values(JSON.parse(raw).advisories ?? {});
const offenders = [];

for (const advisory of advisories) {
  const paths = advisory.findings?.flatMap((f) => f.paths ?? []) ?? [];
  const served = paths.filter((p) => p.startsWith("apps__api>") && !BUILD_ONLY.some((b) => p.includes(b)));
  if (served.length === 0) continue;
  offenders.push({ severity: advisory.severity, module: advisory.module_name, path: served[0], title: advisory.title });
}

const blocking = offenders.filter((o) => FAIL_AT.has(o.severity));

if (offenders.length === 0) {
  console.log("audit-server: no advisories in the API's runtime dependencies");
  process.exit(0);
}

for (const o of offenders) {
  console.log(`${FAIL_AT.has(o.severity) ? "FAIL" : "warn"} ${o.severity.padEnd(8)} ${o.module} — ${o.title}`);
  console.log(`     ${o.path}`);
}

if (blocking.length > 0) {
  console.error(`\naudit-server: ${blocking.length} high/critical advisory in code that serves requests.`);
  process.exit(1);
}
console.log("\naudit-server: advisories present but none high or critical");
