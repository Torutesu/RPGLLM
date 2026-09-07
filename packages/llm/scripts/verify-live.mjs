#!/usr/bin/env node
/**
 * `pnpm --filter llm verify:live` — see src/verify-live/ for what it does and why.
 *
 * This launcher exists only because the package's sources are TypeScript with `.js` specifiers,
 * which node cannot resolve on its own. It registers `tsx` (already in the workspace, hoisted —
 * `scripts/eval.mjs` at the repo root does the same thing) and hands over immediately.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

let unregister;
try {
  const { register } = await import("tsx/esm/api");
  unregister = register();
} catch (cause) {
  process.stderr.write(
    "verify:live — could not load the TypeScript loader (tsx).\n" +
      "It ships with the workspace; if this is a fresh checkout, install dependencies first.\n" +
      `  ${String(cause)}\n`,
  );
  process.exit(1);
}

try {
  const { main } = await import(pathToFileURL(resolve(HERE, "../src/verify-live/cli.ts")).href);
  process.exitCode = await main(process.argv.slice(2));
} finally {
  unregister?.();
}
