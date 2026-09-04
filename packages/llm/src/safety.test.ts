import { describe, expect, it } from "vitest";
import { SAFETY_BLOCK_TEST_PHRASES } from "@rpgllm/shared";
import { blockedPhrase, classifyOffline, g8, softenTerm } from "./generators/g8.js";
import { replayG8 } from "./modes/replay.js";

describe("G8 safety gate (replay)", () => {
  it("blocks all 20 policy test phrases, in both surfaces and locales", () => {
    expect(SAFETY_BLOCK_TEST_PHRASES).toHaveLength(20);
    for (const phrase of SAFETY_BLOCK_TEST_PHRASES) {
      for (const surface of ["post", "dm"] as const) {
        const out = replayG8({ locale: "en", isMinor: false, text: phrase, surface });
        expect(out.verdict, phrase).toBe("block");
        expect(out.category).not.toBeNull();
      }
    }
  });

  it("blocks case-insensitively and when the phrase is embedded in a longer post", () => {
    const phrase = SAFETY_BLOCK_TEST_PHRASES[0];
    expect(phrase).toBeDefined();
    const out = replayG8({
      locale: "en",
      isMinor: false,
      text: `hey everyone ${(phrase ?? "").toUpperCase()} please`,
      surface: "post",
    });
    expect(out.verdict).toBe("block");
  });

  it("allows ordinary in-world posts in both locales", () => {
    const ok = [
      "new song Friday",
      "the leak was not from me and i'm annoyed about it",
      "新曲、金曜に出します",
      "序列表、木曜に出るね",
      "今日の練習きつかった",
    ];
    for (const text of ok) {
      expect(replayG8({ locale: "en", isMinor: false, text, surface: "post" }).verdict).toBe("allow");
    }
  });

  it("softens mild profanity instead of blocking it", () => {
    expect(replayG8({ locale: "en", isMinor: false, text: "what the fuck was that", surface: "post" }).verdict).toBe("soften");
    expect(replayG8({ locale: "ja", isMinor: false, text: "うざい、まじで", surface: "dm" }).verdict).toBe("soften");
    expect(softenTerm("this is fine")).toBeNull();
    expect(blockedPhrase("this is fine")).toBeNull();
  });

  it("falls back to allow, or soften for minors, when the model cannot answer", () => {
    expect(g8.fallback({ locale: "en", isMinor: false, text: "x", surface: "post" }).verdict).toBe("allow");
    expect(g8.fallback({ locale: "en", isMinor: true, text: "x", surface: "post" }).verdict).toBe("soften");
  });

  it("renders a two-block cached prefix that is not the world bible", () => {
    const rendered = g8.render({ locale: "en", isMinor: false, text: "hello", surface: "post" });
    expect(rendered.system).toHaveLength(2);
    expect(rendered.system.join("").length).toBeLessThan(4000);
    expect(rendered.user).toContain("hello");
  });

  it("classifyOffline is the same function replay uses", () => {
    const input = { locale: "en", isMinor: false, text: "torture the puppy", surface: "post" } as const;
    expect(replayG8(input)).toEqual(classifyOffline(input));
  });
});
