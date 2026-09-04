/**
 * `pnpm --filter api seed`
 *
 * Upserts World / WorldCharacter / AmbientPost rows from `loadWorldSeeds()` (@rpgllm/llm).
 * Idempotent: worlds by slug, characters by (worldId, handle), ambient pool rebuilt per (world, locale).
 * Falls back to `src/seed-fallback.ts` while Agent B's seeds are still landing.
 */
import { PrismaClient, type Locale, type Prisma } from "@prisma/client";
import { LOCALES, type WorldSeed } from "@rpgllm/shared";
import { loadEstimateTokens } from "./llm-loader";
import { normHandle } from "./services/handles";
import { getWorldSeeds, worldSeedSource } from "./services/world-seeds";

export async function seedWorld(prisma: PrismaClient, seed: WorldSeed, estimate: (t: string) => number): Promise<void> {
  const bibleTokens = Math.max(...LOCALES.map((l) => estimate(seed.bible[l] ?? "")));
  const world = await prisma.world.upsert({
    where: { slug: seed.slug },
    create: {
      slug: seed.slug,
      title: seed.title as unknown as Prisma.InputJsonValue,
      scenario: seed.scenario as unknown as Prisma.InputJsonValue,
      bible: seed.bible as unknown as Prisma.InputJsonValue,
      bibleTokens,
      difficulty: seed.difficulty,
      isPreset: true,
    },
    update: {
      title: seed.title as unknown as Prisma.InputJsonValue,
      scenario: seed.scenario as unknown as Prisma.InputJsonValue,
      bible: seed.bible as unknown as Prisma.InputJsonValue,
      bibleTokens,
      difficulty: seed.difficulty,
    },
  });

  const handleToId = new Map<string, string>();
  for (const member of seed.cast) {
    const handle = `@${normHandle(member.handle)}`;
    const character = await prisma.worldCharacter.upsert({
      where: { worldId_handle: { worldId: world.id, handle } },
      create: {
        worldId: world.id,
        handle,
        displayName: member.displayName,
        role: member.role,
        card: member.card as unknown as Prisma.InputJsonValue,
        isPressAccount: member.isPressAccount,
        canBeFirstFollower: member.canBeFirstFollower,
      },
      update: {
        displayName: member.displayName,
        role: member.role,
        card: member.card as unknown as Prisma.InputJsonValue,
        isPressAccount: member.isPressAccount,
        canBeFirstFollower: member.canBeFirstFollower,
      },
    });
    handleToId.set(normHandle(member.handle), character.id);
  }

  for (const locale of LOCALES) {
    const pool = seed.ambientPool[locale] ?? [];
    const rows = pool.flatMap((entry) => {
      const characterId = handleToId.get(normHandle(entry.handle));
      return characterId ? [{ worldId: world.id, characterId, locale: locale as Locale, text: entry.text }] : [];
    });
    await prisma.ambientPost.deleteMany({ where: { worldId: world.id, locale: locale as Locale } });
    if (rows.length > 0) await prisma.ambientPost.createMany({ data: rows });
  }
}

export async function seedDatabase(prisma: PrismaClient): Promise<{ worlds: number; source: string }> {
  const seeds = await getWorldSeeds();
  const estimate = await loadEstimateTokens();
  for (const seed of seeds) await seedWorld(prisma, seed, estimate);
  return { worlds: seeds.length, source: worldSeedSource() };
}

const isMain = process.argv[1]?.endsWith("seed.ts") || process.argv[1]?.endsWith("seed.js");
if (isMain) {
  const prisma = new PrismaClient();
  seedDatabase(prisma)
    .then(async (r) => {
      const worlds = await prisma.world.findMany({ select: { slug: true, bibleTokens: true } });
      const characters = await prisma.worldCharacter.count();
      const ambient = await prisma.ambientPost.count();
      console.log(`seeded ${r.worlds} world(s) from "${r.source}" seeds: ${worlds.map((w) => `${w.slug}(${w.bibleTokens}tok)`).join(", ")}`);
      console.log(`characters=${characters} ambientPosts=${ambient}`);
      await prisma.$disconnect();
    })
    .catch(async (err: unknown) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
