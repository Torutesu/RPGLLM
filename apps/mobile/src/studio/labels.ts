import { WORLD_GENRES, colors, type StringKey, type WorldGenre } from "@rpgllm/shared";
import type { WorldBuildStatus, WorldVisibility } from "../api/client";

/**
 * World Studio vocabulary.
 *
 * Every label the studio shows is an i18n key looked up here, so no screen ever inlines a genre
 * name, a state name or a colour decision. Keeping the maps in one file also means the eight
 * genres and the six states can only ever be rendered one way.
 */

export const GENRE_LABEL: Record<WorldGenre, StringKey> = {
  fame: "studioGenreFame",
  academy: "studioGenreAcademy",
  idol: "studioGenreIdol",
  office: "studioGenreOffice",
  sports: "studioGenreSports",
  fantasy: "studioGenreFantasy",
  mystery: "studioGenreMystery",
  slice_of_life: "studioGenreSliceOfLife",
};

/** The picker's order is the contract's order — the two must not drift. */
export const GENRES: readonly WorldGenre[] = WORLD_GENRES;

/**
 * One glyph-free identity colour per genre, taken from the palette. A picked chip carries the
 * genre's colour so the choice is visible at a glance rather than only by a border.
 */
export const GENRE_TINT: Record<WorldGenre, string> = {
  fame: colors.hot,
  academy: colors.verified,
  idol: colors.accentHi,
  office: colors.textDim,
  sports: colors.positive,
  fantasy: colors.accent,
  mystery: colors.warning,
  slice_of_life: colors.negative,
};

export const VISIBILITIES: readonly WorldVisibility[] = ["private", "unlisted", "public"];

export const VISIBILITY_LABEL: Record<WorldVisibility, StringKey> = {
  private: "studioVisibilityPrivate",
  unlisted: "studioVisibilityUnlisted",
  public: "studioVisibilityPublic",
};

export const VISIBILITY_HINT: Record<WorldVisibility, StringKey> = {
  private: "studioVisibilityPrivateHint",
  unlisted: "studioVisibilityUnlistedHint",
  public: "studioVisibilityPublicHint",
};

/**
 * State copy. `published` has no dedicated string in the shipped i18n set, so a live world wears
 * its audience ("Everyone") — which is what the state actually means to the player. Requested as
 * `studioPublished` in build-notes.
 */
export const STATUS_LABEL: Record<WorldBuildStatus, StringKey> = {
  draft: "studioDraft",
  generating: "studioBuilding",
  ready: "studioReady",
  review: "studioInReview",
  published: "studioVisibilityPublic",
  rejected: "studioRejected",
};

export const STATUS_TINT: Record<WorldBuildStatus, string> = {
  draft: colors.textMuted,
  generating: colors.accentHi,
  ready: colors.positive,
  review: colors.warning,
  published: colors.positive,
  rejected: colors.danger,
};

/** A state that is still moving, so the card polls / shimmers rather than sitting there. */
export const isBuilding = (s: WorldBuildStatus): boolean => s === "generating" || s === "draft";

/** A state a player can actually play. */
export const isPlayable = (s: WorldBuildStatus): boolean =>
  s === "ready" || s === "review" || s === "published";

/** The four named build steps, in the order the generator runs them. */
export const BUILD_STEPS = [
  { key: "bible", label: "studioStepBible" },
  { key: "cast", label: "studioStepCast" },
  { key: "art", label: "studioStepArt" },
  { key: "feed", label: "studioStepFeed" },
] as const satisfies readonly { key: string; label: StringKey }[];

/**
 * Which step a 0..1 progress figure is inside. The API owns the number; this owns the story it
 * tells, so a world that jumps from 0.1 to 0.9 still walks through the steps visually.
 */
export function stepIndex(progress: number): number {
  const p = Math.max(0, Math.min(0.999, progress));
  return Math.floor(p * BUILD_STEPS.length);
}
