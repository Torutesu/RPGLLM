// Playwright webServer entry for the client: export the Expo web bundle, then serve it.
//
//   E2E_SKIP_EXPORT=1   skip `expo export` and serve whatever is already in the dist directory
//   E2E_WEB_DIST        export/serve directory under apps/mobile (default "dist"). Give your run
//                       its own (e.g. dist-o) when someone else may be exporting at the same time:
//                       the bundle bakes EXPO_PUBLIC_API_URL in, so two runs cannot share one.
//   WEB_PORT            port to serve on (default 8082)
//   EXPO_PUBLIC_API_URL / EXPO_PUBLIC_ADS_MODE / EXPO_PUBLIC_BILLING_MODE  baked into the bundle
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIST_NAME = process.env.E2E_WEB_DIST ?? "dist";
const DIST = path.join(REPO_ROOT, "apps/mobile", DIST_NAME);

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
  log(`expo export → apps/mobile/${DIST_NAME} (API=${env.EXPO_PUBLIC_API_URL} ADS=${env.EXPO_PUBLIC_ADS_MODE})`);
  const r = spawnSync(
    "pnpm",
    ["--filter", "mobile", "exec", "expo", "export", "-p", "web", "--output-dir", DIST_NAME, "--clear"],
    { cwd: REPO_ROOT, stdio: "inherit", env },
  );
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
// node directly (no pnpm/sh wrapper) so Playwright's SIGTERM reaches the server and the port is
// free for the next run.
const child = spawn(process.execPath, ["scripts/serve-web.mjs", DIST_NAME], {
  cwd: path.join(REPO_ROOT, "apps/mobile"), stdio: "inherit", env,
});
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
