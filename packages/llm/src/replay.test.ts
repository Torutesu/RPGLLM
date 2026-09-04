import { describe, expect, it } from "vitest";
import { G1OutputZ, G4OutputZ, G5OutputZ, G7OutputZ, LOCALES, WORLD_SLUGS } from "@rpgllm/shared";
import { replayG1, replayG4, replayG5, replayG7, isNegative } from "./modes/replay.js";
import { g1 } from "./generators/g1.js";
import { g1Input, g4Input, g5Input, g7Input, seedFor } from "./__testkit.js";

const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
const CJK = /[぀-ヿ一-鿿]/;

describe("replay G1", () => {
  it("validates against G1OutputZ for every world x locale x 10 seeds", () => {
    for (const slug of WORLD_SLUGS) {
      for (const locale of LOCALES) {
        for (const seed of SEEDS) {
          const input = g1Input(slug, locale, seed);
          const raw = replayG1(input);
          const cleaned = g1.postprocess(raw, input);
          expect(cleaned, `${slug}/${locale}/${seed}`).not.toBeNull();
          expect(() => G1OutputZ.parse(cleaned)).not.toThrow();
        }
      }
    }
  });

  it("is deterministic: same input -> identical output", () => {
    for (const slug of WORLD_SLUGS) {
      const a = replayG1(g1Input(slug, "en", 42));
      const b = replayG1(g1Input(slug, "en", 42));
      expect(a).toEqual(b);
    }
  });

  it("varies with the seed", () => {
    const texts = new Set(
      SEEDS.map((s) => replayG1(g1Input("popstar-era", "en", s)).replies[0]?.text ?? ""),
    );
    expect(texts.size).toBeGreaterThan(1);
  });

  it("varies with the post text at a fixed seed", () => {
    const a = replayG1(
      g1Input("popstar-era", "en", 7, {
        post: { text: "new song Friday", parentAuthorHandle: null, parentText: null },
      }),
    );
    const b = replayG1(
      g1Input("popstar-era", "en", 7, {
        post: { text: "studio all night again", parentAuthorHandle: null, parentText: null },
      }),
    );
    expect(a.replies[0]?.text).not.toEqual(b.replies[0]?.text);
  });

  it("returns k replies from distinct known handles, never the press account", () => {
    for (const slug of WORLD_SLUGS) {
      const world = seedFor(slug);
      const press = world.cast.find((c) => c.isPressAccount)?.handle;
      const out = replayG1(g1Input(slug, "en", 11, { k: 3 }));
      expect(out.replies).toHaveLength(3);
      const handles = out.replies.map((r) => r.characterHandle);
      expect(new Set(handles).size).toBe(3);
      expect(handles).not.toContain(press);
      for (const h of handles) expect(world.cast.some((c) => c.handle === h)).toBe(true);
    }
  });

  it("writes Japanese replies for the ja locale (E2E-011)", () => {
    for (const slug of WORLD_SLUGS) {
      const out = replayG1(g1Input(slug, "ja", 3));
      for (const r of out.replies) expect(CJK.test(r.text)).toBe(true);
      expect(CJK.test(out.narrative)).toBe(true);
    }
  });

  it("keeps replies inside the 280-char / schema limits", () => {
    for (const slug of WORLD_SLUGS) {
      for (const locale of LOCALES) {
        const out = replayG1(g1Input(slug, locale, 5, { k: 4, includeNews: true }));
        for (const r of out.replies) expect(r.text.length).toBeLessThanOrEqual(280);
        expect(out.narrative.length).toBeLessThanOrEqual(240);
      }
    }
  });

  it("gives positive posts positive followers and negative posts negative ones", () => {
    const good = replayG1(
      g1Input("popstar-era", "en", 4, {
        post: { text: "new song Friday", parentAuthorHandle: null, parentText: null },
      }),
    );
    const bad = replayG1(
      g1Input("popstar-era", "en", 4, {
        post: { text: "the leak was a diss and i want it cancelled", parentAuthorHandle: null, parentText: null },
      }),
    );
    expect(good.stat_deltas.followers).toBeGreaterThan(0);
    expect(bad.stat_deltas.followers).toBeLessThan(0);
    expect(isNegative("someone will leak it")).toBe(true);
    expect(isNegative("new song Friday")).toBe(false);
  });

  it("emits a press-voice news line only when asked", () => {
    const without = replayG1(g1Input("popstar-era", "en", 9, { includeNews: false }));
    expect(without.news).toBeNull();
    const withNews = replayG1(g1Input("popstar-era", "en", 9, { includeNews: true }));
    expect(withNews.news?.text.length ?? 0).toBeGreaterThan(0);
  });

  it("drops replies from handles that are not in the cast", () => {
    const input = g1Input("popstar-era", "en", 1);
    const cleaned = g1.postprocess(
      {
        ...replayG1(input),
        replies: [
          { characterHandle: "ghost_account", text: "hello" },
          { characterHandle: "hivequeenbea", text: "👀" },
        ],
      },
      input,
    );
    expect(cleaned?.replies.map((r) => r.characterHandle)).toEqual(["hivequeenbea"]);
  });

  it("falls back to canned lines when every handle is unknown", () => {
    const input = g1Input("popstar-era", "en", 1);
    expect(
      g1.postprocess({ ...replayG1(input), replies: [{ characterHandle: "nope", text: "x" }] }, input),
    ).toBeNull();
    const fallback = g1.fallback(input);
    expect(fallback.replies.length).toBeGreaterThanOrEqual(1);
    expect(fallback.stat_deltas).toEqual({ followers: 0, aura: 0, humor: 0 });
  });
});

describe("replay G4 / G5 / G7", () => {
  it("G4 returns 1-3 bubbles and validates, deterministically", () => {
    for (const slug of WORLD_SLUGS) {
      for (const locale of LOCALES) {
        const input = g4Input(slug, locale, 17);
        const out = replayG4(input);
        expect(() => G4OutputZ.parse(out)).not.toThrow();
        expect(out.bubbles.length).toBeGreaterThanOrEqual(1);
        expect(out.bubbles.length).toBeLessThanOrEqual(3);
        for (const b of out.bubbles) expect(b.length).toBeLessThanOrEqual(160);
        // a single bubble may be pure emoji, so assert on the whole set
        if (locale === "ja") expect(CJK.test(out.bubbles.join(""))).toBe(true);
        expect(replayG4(input)).toEqual(out);
      }
    }
  });

  it("G4 varies with the seed", () => {
    const first = new Set(SEEDS.map((s) => replayG4(g4Input("popstar-era", "en", s)).bubbles[0]));
    expect(first.size).toBeGreaterThan(1);
  });

  it("G5 picks an unused event and validates", () => {
    for (const slug of WORLD_SLUGS) {
      for (const locale of LOCALES) {
        const out = replayG5(g5Input(slug, locale, 23));
        expect(() => G5OutputZ.parse(out)).not.toThrow();
        expect(out.choices).toHaveLength(3);
      }
    }
  });

  it("G5 avoids titles already used", () => {
    const world = seedFor("popstar-era");
    const used = world.presetEvents.slice(0, 3).map((e) => e.title.en);
    for (const seed of SEEDS) {
      const out = replayG5(g5Input("popstar-era", "en", seed, { pastEventTitles: used }));
      expect(used).not.toContain(out.title);
    }
  });

  it("G7 folds notes into the summaries and validates", () => {
    const input = g7Input("popstar-era", "en");
    const out = replayG7(input);
    expect(() => G7OutputZ.parse(out)).not.toThrow();
    expect(out.relationships[0]?.summary).toContain("believed in you first");
    expect(out.relationships[0]?.summary).toContain("asked to hear things first");
    expect(out.worldSummary.length).toBeLessThanOrEqual(1600);
  });
});
