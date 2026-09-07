import { describe, expect, it } from "vitest";
import { LOCALES, WorldSeedZ, WORLD_SLUGS } from "@rpgllm/shared";
import { loadWorldSeeds } from "./worlds/index.js";
import { estimateTokens } from "./tokens.js";
import { HANDLE_RE } from "./handles.js";
import { characterFixture, worldFixture } from "./fixtures/index.js";
import { renderBible, type WorldSource } from "./worlds/build.js";
import { cast as idolCast, outro as idolOutro, prose as idolProse } from "./worlds/idol-survival.bible.js";
import { cjkRatio } from "./eval-g9.js";

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

      /**
       * The half-translated cast, as a check. A JA player who opens this world sees the intro and
       * the role line side by side; one Japanese and one English is the tell that the app is a
       * translation of an American one, which is the single thing the JA market spots instantly
       * (gtm.md, 勝ち筋 B). It was found in a screenshot once. It fails here now.
       */
      it("gives every cast member a role line written in each language", () => {
        for (const c of world.cast) {
          const en = c.roleLocalized?.en ?? "";
          const ja = c.roleLocalized?.ja ?? "";
          expect(en, c.handle).toBe(c.role);
          expect(ja.length, c.handle).toBeGreaterThan(0);
          expect(ja, c.handle).not.toBe(en);
          expect(cjkRatio(ja), c.handle).toBeGreaterThan(0.5);
        }
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

  /**
   * **This assertion was inverted, deliberately, and it is worth saying why.**
   *
   * It used to pin that `roleLocalized` never reaches `system[1]`: that string is the cross-user
   * cached prefix (cost-architecture 3.1), every byte is part of the cache key, and localizing the
   * cast header moves the JA prefix for every world. True — and the consequence was that a
   * Japanese world handed the generator a cast sheet whose role lines were in English, in the one
   * market this product picked *because* it detects exactly that.
   *
   * So the header is localized now and the JA prefix rotates once. It costs one cache write per
   * world, nothing has shipped, and the price of this rotation only goes up. What is pinned
   * instead is the half that must still hold: the **EN** prefix does not move at all (because
   * `roleLocalized.en === role` by construction), and the JA prefix moves **only** with the
   * localized role and not with anything else.
   */
  it("localizes the cast header in JA, and leaves the EN prefix exactly where it was", () => {
    const source: WorldSource = {
      slug: "probe",
      difficulty: 1,
      title: { en: "t", ja: "t" },
      scenario: { en: "s", ja: "s" },
      prose: idolProse,
      outro: idolOutro,
      cast: idolCast,
      presetPersonas: [],
      presetEvents: [],
      fallbackReplies: {},
      ambientPool: { en: [], ja: [] },
      welcomePosts: {},
    };
    const rewritten: WorldSource = {
      ...source,
      cast: idolCast.map((c) => ({ ...c, roleLocalized: { en: c.role, ja: "まったく別の肩書き" } })),
    };
    const stripped: WorldSource = {
      ...source,
      cast: idolCast.map(({ roleLocalized: _drop, ...rest }) => rest),
    };
    // EN: untouched by either change, because the English half *is* `role`.
    expect(renderBible(rewritten, "en")).toBe(renderBible(source, "en"));
    expect(renderBible(stripped, "en")).toBe(renderBible(source, "en"));

    // JA: the localized role is in the prefix, so rewriting it moves the prefix — that is the
    // point — and the header carries the Japanese line rather than the English one.
    expect(renderBible(rewritten, "ja")).not.toBe(renderBible(source, "ja"));
    expect(renderBible(rewritten, "ja")).toContain("まったく別の肩書き");
    for (const member of idolCast) {
      const ja = member.roleLocalized?.ja;
      if (ja !== undefined && ja !== member.role) {
        expect(renderBible(source, "ja"), `@${member.handle}'s header must be Japanese`).toContain(ja);
        expect(renderBible(source, "ja")).not.toContain(`(${member.role})`);
      }
    }

    // A world with no localized role at all still renders — it falls back to the single string.
    expect(renderBible(stripped, "ja")).toBe(
      renderBible({ ...source, cast: idolCast.map((c) => ({ ...c, roleLocalized: undefined })) }, "ja"),
    );
  });

  it("popstar-era keeps the handles E2E-002 depends on", () => {
    const world = seeds.find((w) => w.slug === "popstar-era");
    expect(world?.presetPersonas[0]?.handle).toBe("taytay19");
    expect(world?.cast[0]?.handle).toBe("hivequeenbea");
    expect(world?.cast.find((c) => c.isPressAccount)?.handle).toBe("thescoop");
    // E2E-010 asserts a canned fallback reply from the first follower.
    expect(world?.fallbackReplies.hivequeenbea?.en[0]).toBe("👀");
  });
});
