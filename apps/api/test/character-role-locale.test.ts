/**
 * A cast member's **role** crosses the language, like everything else about a world.
 *
 * G9 generates the bible, the cards and the intros in both locales, and until now the one word
 * under a character's name — "press account", "the one a step ahead" — was a single English string
 * that every locale got. A Japanese player opened a Japanese world and read Japanese everywhere
 * except there. That is precisely the seam a product whose claim is 世界は言語を超える cannot have,
 * and the reason nobody caught it is that no test ever asserted it (`WorldSeedZ.cast[].roleLocalized`).
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import type { WorldSeed } from "@rpgllm/shared";
import { loadEstimateTokens } from "../src/llm-loader";
import { seedWorld } from "../src/seed";
import { FALLBACK_WORLD_SEEDS } from "../src/seed-fallback";
import { normHandle } from "../src/services/handles";
import { roleFor } from "../src/services/locale";
import { call, makeHarness, prisma, resetDatabase, signup, type Harness } from "./helpers";

let h: Harness;

beforeAll(() => { h = makeHarness(); });
beforeEach(async () => { await resetDatabase(); h.gateway.setMode("replay"); });

interface DetailRes {
  world: { id: string; slug: string };
  characters: { handle: string; role: string }[];
}

const EN_ROLE = "the one a step ahead";
const JA_ROLE = "半歩だけ先にいる人";

/** The preset seed, re-slugged, with a localized role on its first cast member. */
async function seedWithLocalizedRole(slug: string): Promise<{ handle: string }> {
  const base = FALLBACK_WORLD_SEEDS[0]!;
  const [first, ...rest] = base.cast;
  const seed: WorldSeed = {
    ...base,
    slug,
    cast: [{ ...first!, role: EN_ROLE, roleLocalized: { en: EN_ROLE, ja: JA_ROLE } }, ...rest],
  };
  await seedWorld(prisma, seed, await loadEstimateTokens());
  return { handle: normHandle(first!.handle) };
}

describe("a cast member's role is localized", () => {
  it("is persisted by `seedWorld` and served in the reader's language", async () => {
    const { handle } = await seedWithLocalizedRole("role-locale-world");
    const world = await prisma.world.findUniqueOrThrow({ where: { slug: "role-locale-world" } });
    const row = await prisma.worldCharacter.findFirstOrThrow({
      where: { worldId: world.id, handle: `@${handle}` },
    });
    expect(row.roleLocalized, "the pair reaches the database, not just the seed file").toEqual({ en: EN_ROLE, ja: JA_ROLE });

    const japanese = await signup(h, { locale: "ja" });
    const ja = await call<DetailRes>(h, "GET", `/v1/worlds/${world.id}`, { token: japanese.token });
    expect(ja.status).toBe(200);
    expect(ja.data.characters.find((c) => c.handle === handle)?.role).toBe(JA_ROLE);

    const english = await signup(h, { locale: "en" });
    const en = await call<DetailRes>(h, "GET", `/v1/worlds/${world.id}`, { token: english.token });
    expect(en.data.characters.find((c) => c.handle === handle)?.role).toBe(EN_ROLE);
  });

  it("falls back to the single-language `role` for a row that has no pair", async () => {
    // Every preset row seeded without `roleLocalized` — the column is null and nothing changes.
    const plain = await prisma.worldCharacter.findFirstOrThrow({ where: { roleLocalized: { equals: Prisma.DbNull } } });
    expect(roleFor(plain, "ja")).toBe(plain.role);
    expect(roleFor(plain, "en")).toBe(plain.role);

    const japanese = await signup(h, { locale: "ja" });
    const detail = await call<DetailRes>(h, "GET", `/v1/worlds/${plain.worldId}`, { token: japanese.token });
    expect(detail.data.characters.find((c) => `@${c.handle}` === plain.handle)?.role).toBe(plain.role);
  });

  it("gives the review queue the role in the language the world is reviewed in", async () => {
    await seedWithLocalizedRole("role-locale-review");
    const world = await prisma.world.findUniqueOrThrow({ where: { slug: "role-locale-review" } });
    await prisma.world.update({
      where: { id: world.id },
      data: { status: "review", visibility: "public", isPreset: false, genLocale: "ja", reviewRequestedAt: h.clock.now() },
    });

    const queue = await call<{ worlds: { id: string; cast: { handle: string; role: string }[] }[] }>(
      h, "GET", "/v1/admin/worlds/review",
    );
    const card = queue.data.worlds.find((w) => w.id === world.id);
    expect(card, "the world is in the queue").toBeDefined();
    expect(card?.cast.some((c) => c.role === JA_ROLE), "an English reviewer reads the JA cast of a JA world").toBe(true);
  });
});
