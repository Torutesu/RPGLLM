import { describe, expect, it } from "vitest";
import { LOCALES, WorldSeedZ, WORLD_SLUGS } from "@rpgllm/shared";
import { loadWorldSeeds } from "./worlds/index.js";
import { estimateTokens } from "./tokens.js";
import { HANDLE_RE } from "./handles.js";
import { characterFixture, worldFixture } from "./fixtures/index.js";

const seeds = loadWorldSeeds();

describe("world seeds", () => {
  it("ships exactly the three preset worlds in picker order", () => {
    expect(seeds.map((w) => w.slug)).toEqual([...WORLD_SLUGS]);
  });

  for (const world of seeds) {
    describe(world.slug, () => {
      it("validates against WorldSeedZ", () => {
        expect(() => WorldSeedZ.parse(world)).not.toThrow();
      });

      for (const locale of LOCALES) {
        it(`bible[${locale}] clears the Haiku 4.5 cache floor of 4096 tokens`, () => {
          const tokens = estimateTokens(world.bible[locale]);
          expect(tokens).toBeGreaterThanOrEqual(4096);
        });

        it(`ambientPool[${locale}] has at least 20 seeded posts`, () => {
          expect(world.ambientPool[locale].length).toBeGreaterThanOrEqual(20);
        });
      }

      it("has 8 cast members, exactly one press account and >=5 first-follower options", () => {
        expect(world.cast).toHaveLength(8);
        expect(world.cast.filter((c) => c.isPressAccount)).toHaveLength(1);
        expect(world.cast.filter((c) => c.canBeFirstFollower).length).toBeGreaterThanOrEqual(5);
        // E2E picks the first of each list, so both must be usable.
        expect(world.cast[0]?.canBeFirstFollower).toBe(true);
        expect(world.presetPersonas[0]).toBeDefined();
      });

      it("stores every handle bare and API-legal", () => {
        const handles = [
          ...world.cast.map((c) => c.handle),
          ...world.presetPersonas.map((p) => p.handle),
          ...LOCALES.flatMap((l) => world.ambientPool[l].map((p) => p.handle)),
          ...Object.keys(world.fallbackReplies),
          ...Object.keys(world.welcomePosts),
        ];
        for (const handle of handles) {
          expect(handle.startsWith("@")).toBe(false);
          expect(HANDLE_RE.test(handle)).toBe(true);
        }
      });

      it("has 7 preset personas and >=5 preset events with 3 choices each", () => {
        expect(world.presetPersonas).toHaveLength(7);
        expect(world.presetEvents.length).toBeGreaterThanOrEqual(5);
        for (const e of world.presetEvents) {
          expect(e.choices).toHaveLength(3);
          for (const locale of LOCALES) {
            expect(e.title[locale].length).toBeGreaterThan(0);
            expect(e.prompt[locale].length).toBeGreaterThan(0);
          }
        }
      });

      it("has 5 fallback replies and a welcome post per character per locale", () => {
        for (const c of world.cast) {
          for (const locale of LOCALES) {
            expect(world.fallbackReplies[c.handle]?.[locale]?.length ?? 0).toBeGreaterThanOrEqual(5);
            expect((world.welcomePosts[c.handle]?.[locale] ?? "").length).toBeGreaterThan(0);
          }
        }
      });

      it("has replay fixtures for every cast handle: 6 buckets x >=3 lines, >=6 DM sets", () => {
        const fixture = worldFixture(world.slug);
        expect(fixture).toBeDefined();
        for (const c of world.cast) {
          const cf = characterFixture(world.slug, c.handle);
          expect(cf, `missing fixture for ${c.handle}`).toBeDefined();
          for (const locale of LOCALES) {
            expect(cf?.replies[locale]).toHaveLength(6);
            for (const bucket of cf?.replies[locale] ?? []) {
              expect(bucket.length).toBeGreaterThanOrEqual(3);
            }
            expect((cf?.dm[locale] ?? []).length).toBeGreaterThanOrEqual(6);
            expect((cf?.memory[locale] ?? []).length).toBeGreaterThanOrEqual(3);
          }
        }
        for (const locale of LOCALES) {
          expect((fixture?.narratives[locale] ?? []).length).toBeGreaterThanOrEqual(8);
          expect((fixture?.news[locale] ?? []).length).toBeGreaterThanOrEqual(6);
        }
        expect(fixture?.extraEvents).toHaveLength(3);
      });
    });
  }

  it("popstar-era keeps the handles E2E-002 depends on", () => {
    const world = seeds.find((w) => w.slug === "popstar-era");
    expect(world?.presetPersonas[0]?.handle).toBe("taytay19");
    expect(world?.cast[0]?.handle).toBe("hivequeenbea");
    expect(world?.cast.find((c) => c.isPressAccount)?.handle).toBe("thescoop");
    // E2E-010 asserts a canned fallback reply from the first follower.
    expect(world?.fallbackReplies.hivequeenbea?.en[0]).toBe("👀");
  });
});
