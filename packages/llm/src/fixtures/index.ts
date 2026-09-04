import { bareKeys } from "../handles.js";
import type { CharacterFixture, WorldFixture } from "./types.js";
import { popstarEraFixture } from "./popstar-era.js";
import { magicAcademyFixture } from "./magic-academy.js";
import { idolSurvivalFixture } from "./idol-survival.js";

/** Fixtures are authored with "@handles"; every lookup key is normalised to a bare handle. */
function normalise(f: WorldFixture): WorldFixture {
  return { ...f, characters: bareKeys(f.characters) };
}

const BY_SLUG: Record<string, WorldFixture> = {
  "popstar-era": normalise(popstarEraFixture),
  "magic-academy": normalise(magicAcademyFixture),
  "idol-survival": normalise(idolSurvivalFixture),
};

export function worldFixture(slug: string): WorldFixture | undefined {
  return BY_SLUG[slug];
}

export function characterFixture(slug: string, handle: string): CharacterFixture | undefined {
  return BY_SLUG[slug]?.characters[handle];
}

export function allFixtures(): Array<[string, WorldFixture]> {
  return Object.entries(BY_SLUG);
}

export * from "./types.js";
