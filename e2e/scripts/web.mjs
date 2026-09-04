// Playwright webServer entry for the client: export the Expo web bundle, then serve it.
//
//   E2E_SKIP_EXPORT=1   skip `expo export` and serve whatever is already in apps/mobile/dist
//   WEB_PORT            port to serve on (default 8082)
//   EXPO_PUBLIC_API_URL / EXPO_PUBLIC_ADS_MODE / EXPO_PUBLIC_BILLING_MODE  baked into the bundle
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIST = path.join(REPO_ROOT, "apps/mobile/dist");

const env = {
  ...process.env,
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000",
  EXPO_PUBLIC_ADS_MODE: process.env.EXPO_PUBLIC_ADS_MODE ?? "test",
  EXPO_PUBLIC_BILLING_MODE: process.env.EXPO_PUBLIC_BILLING_MODE ?? "test",
  WEB_PORT: process.env.WEB_PORT ?? "8082",
};

const log = (m) => process.stdout.write(`[e2e:web] ${m}\n`);

if (process.env.E2E_SKIP_EXPORT === "1") {
  log("E2E_SKIP_EXPORT=1 — serving the existing export");
} else {
  log(`expo export (API=${env.EXPO_PUBLIC_API_URL} ADS=${env.EXPO_PUBLIC_ADS_MODE})`);
  const r = spawnSync("pnpm", ["--filter", "mobile", "export:web"], { cwd: REPO_ROOT, stdio: "inherit", env });
  if (r.status !== 0) {
    log(`export failed (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
}

if (!fs.existsSync(path.join(DIST, "index.html"))) {
  log(`no bundle at ${DIST}/index.html — run \`pnpm --filter mobile export:web\` first`);
  process.exit(1);
}

log(`serving ${DIST} on :${env.WEB_PORT}`);
const child = spawn("pnpm", ["--filter", "mobile", "serve:web"], { cwd: REPO_ROOT, stdio: "inherit", env });
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
