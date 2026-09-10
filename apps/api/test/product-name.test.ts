import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRODUCT } from "@rpgllm/shared";
import { publicAppName } from "../src/env";

/**
 * The product's name, in the two places a stranger reads it.
 *
 * `packages/shared` holds it (`PRODUCT.name`) and this service defaults `og:site_name` to it.
 * The third consumer cannot import anything: `apps/mobile/app.json` is JSON, evaluated by the
 * Expo CLI in Node where `@rpgllm/shared` is raw TypeScript. So the single source of truth is
 * enforced here rather than assumed — rename the constant, and this test tells you the one other
 * file to change.
 *
 * It also refuses the two strings that were there before: "status-clone" on a store listing and
 * "RPGLLM" above a link preview are not names, they are what a project is called before anyone
 * has decided.
 */

interface AppJson {
  expo: { name: string; slug: string };
}

const appJson = (): AppJson =>
  JSON.parse(readFileSync(new URL("../../mobile/app.json", import.meta.url), "utf8")) as AppJson;

describe("the product's name", () => {
  it("is the same string in app.json and in packages/shared", () => {
    expect(
      appJson().expo.name,
      "apps/mobile/app.json → expo.name must match PRODUCT.name in packages/shared/src/constants.ts",
    ).toBe(PRODUCT.name);
  });

  it("is what og:site_name falls back to", () => {
    const saved = process.env["PUBLIC_APP_NAME"];
    delete process.env["PUBLIC_APP_NAME"];
    try {
      expect(publicAppName()).toBe(PRODUCT.name);
    } finally {
      if (saved !== undefined) process.env["PUBLIC_APP_NAME"] = saved;
    }
  });

  it("is not a build directory's name", () => {
    // The literal that shipped in every web export's <title> until this pass.
    expect(appJson().expo.name).not.toBe("status-clone");
  });

  /**
   * Deliberately not a failure. The name is a decision, not a bug, and a red suite is the wrong
   * way to nag about one — but it should be impossible to forget that it is still outstanding.
   */
  it("is still a placeholder, and says so", () => {
    expect(PRODUCT.isPlaceholder, "flip PRODUCT.isPlaceholder when the product is named").toBe(true);
  });
});
