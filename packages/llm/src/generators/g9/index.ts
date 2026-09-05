/**
 * G9 — World Studio (AIF-003 / AIF-014).
 *
 * `gateway.g9(input)` turns one player sentence into a complete `WorldSeed`. Everything else here
 * is exported for apps/api (`screenPremise`) and for the tests that hold the shape.
 */
export { screenPremise, sanitizePremise, type PremiseScreenResult, type PremiseVerdict } from "./screen.js";
export { runG9, aggregateMeta, type G9StageRunner } from "./orchestrator.js";
export { assembleWorld, deterministicWorld, type G9Parts } from "./assemble.js";
export {
  g9Bible,
  g9Card,
  g9CastEvents,
  g9Concept,
  g9Texture,
  replayG9Bible,
  replayG9Card,
  replayG9CastEvents,
  replayG9Concept,
  replayG9Texture,
  stageSeed,
} from "./stages.js";
export {
  deterministicCastEvents,
  deterministicConcept,
  deterministicTexture,
  premiseKeywords,
  renderCard,
  renderIntro,
  renderOutro,
  renderProse,
} from "./blueprint.js";
export { GENRE_PACKS, packFor, type GenrePack, type GenreWords } from "./vocab.js";
export { ALL_ARCHETYPES, OPEN_ARCHETYPES, PRESS_ARCHETYPE, type Archetype } from "./archetypes.js";
export { STUDIO_GLOBAL, genreBrief, conceptBlock, worldBrief } from "./prompts.js";
export {
  G9ConceptZ,
  G9BibleZ,
  G9CardZ,
  G9CastEventsZ,
  G9TextureZ,
  G9InputZ,
  G9_STAGES,
  G9_VARIANT_IDS,
  type G9BibleInput,
  type G9BibleOutput,
  type G9CardInput,
  type G9CardOutput,
  type G9CastEventsInput,
  type G9CastEventsOutput,
  type G9Concept,
  type G9ConceptCast,
  type G9ConceptInput,
  type G9Input,
  type G9Stage,
  type G9TextureInput,
  type G9TextureOutput,
} from "./types.js";
