import type {
  CharacterCard,
  G1Input,
  G4Input,
  G5Input,
  G7Input,
  Locale,
  PersonaState,
  WorldSeed,
} from "@rpgllm/shared";
import { loadWorldSeeds } from "./worlds/index.js";

/** Input builders shared by the test files. Not a test file itself (no *.test.ts suffix). */

export function seedFor(slug: string): WorldSeed {
  const found = loadWorldSeeds().find((w) => w.slug === slug);
  if (found === undefined) throw new Error(`no world seed for ${slug}`);
  return found;
}

export function castFor(seed: WorldSeed, locale: Locale): CharacterCard[] {
  return seed.cast.map((c) => ({
    handle: c.handle,
    displayName: c.displayName,
    role: c.role,
    card: c.card[locale],
    isPressAccount: c.isPressAccount,
  }));
}

export function persona(handle = "taytay19"): PersonaState {
  return {
    handle,
    displayName: "Tay",
    bio: "one song, no album",
    voiceNotes: "lowercase, dry, never explains the joke",
    followers: 1200,
    aura: 24,
    humor: 31,
    level: 2,
    worldSummary: "Released one song that outperformed the plan. Signed nothing yet.",
  };
}

export function g1Input(
  slug: string,
  locale: Locale,
  seed: number,
  overrides: Partial<G1Input> = {},
): G1Input {
  const world = seedFor(slug);
  const cast = castFor(world, locale);
  const first = cast[0];
  return {
    userId: "user-1",
    locale,
    worldSlug: slug,
    worldBible: world.bible[locale],
    isMinor: false,
    persona: persona(),
    cast,
    involved:
      first === undefined
        ? []
        : [{ handle: first.handle, affinity: 3, summary: "believed in you first", isFollower: true }],
    recentFeed: [
      { authorHandle: cast[1]?.handle ?? "x", kind: "character", text: "the room was loud tonight" },
    ],
    post: {
      text: locale === "ja" ? "新曲、金曜に出します" : "new song Friday",
      parentAuthorHandle: null,
      parentText: null,
    },
    k: 3,
    softened: false,
    seed,
    includeNews: false,
    ...overrides,
  };
}

export function g4Input(
  slug: string,
  locale: Locale,
  seed: number,
  overrides: Partial<G4Input> = {},
): G4Input {
  const world = seedFor(slug);
  const cast = castFor(world, locale);
  const character = cast[0];
  if (character === undefined) throw new Error("empty cast");
  return {
    userId: "user-1",
    locale,
    worldSlug: slug,
    worldBible: world.bible[locale],
    isMinor: false,
    persona: persona(),
    character,
    relationship: { handle: character.handle, affinity: 4, summary: "close", isFollower: true },
    history: [{ fromCharacter: false, text: "hey" }],
    message: locale === "ja" ? "あのニュース見た?" : "did you see the news?",
    softened: false,
    seed,
    ...overrides,
  };
}

export function g5Input(
  slug: string,
  locale: Locale,
  seed: number,
  overrides: Partial<G5Input> = {},
): G5Input {
  const world = seedFor(slug);
  return {
    userId: "user-1",
    locale,
    worldSlug: slug,
    worldBible: world.bible[locale],
    isMinor: false,
    persona: persona(),
    relationships: world.cast.slice(0, 3).map((c) => ({
      handle: c.handle,
      affinity: 2,
      summary: "history",
      isFollower: true,
    })),
    recentSnapshots: [],
    pastEventTitles: [],
    seed,
    ...overrides,
  };
}

export function g7Input(slug: string, locale: Locale, overrides: Partial<G7Input> = {}): G7Input {
  const world = seedFor(slug);
  const first = world.cast[0];
  return {
    userId: "user-1",
    locale,
    worldSlug: slug,
    worldBible: world.bible[locale],
    isMinor: false,
    persona: persona(),
    relationships:
      first === undefined
        ? []
        : [
            {
              handle: first.handle,
              affinity: 3,
              oldSummary: "believed in you first",
              notes: ["asked to hear things first", "was in a stairwell about the bridge"],
            },
          ],
    ...overrides,
  };
}
