/**
 * Minimal .env loader shared by the API (`index.ts`) and the worker (`worker.ts`):
 * repo-root `.env` first, then `.env.example` for defaults.
 *
 * S0-3: `.env.example` carries development secrets (`JWT_SECRET=dev-secret-change-me`,
 * `AUTH_DEV_CODE=1`, test billing/ads) — in production it is never read. Real environment
 * variables always win over both files. Returns a `file (+n keys)` list for the startup log;
 * values are never logged.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isProduction } from "./env";

export function loadEnvFile(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const files = isProduction() ? [".env"] : [".env", ".env.example"];
  const applied: string[] = [];
  for (const file of files) {
    const path = resolve(here, "../../..", file);
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    let count = 0;
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
      if (process.env[key] === undefined) { process.env[key] = value; count += 1; }
    }
    applied.push(`${file} (+${count})`);
  }
  return applied;
}
