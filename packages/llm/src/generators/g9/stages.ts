import { LOCALES, WORLD_STUDIO, type Locale } from "@rpgllm/shared";
import { bareHandle, HANDLE_RE } from "../../handles.js";
import { clamp, joinSections, section, type RenderedPrompt } from "../../prompts/render.js";
import { pick } from "../../tokens.js";
import type { GeneratorSpec } from "../../types.js";
import {
  deterministicCastEvents,
  deterministicConcept,
  deterministicTexture,
  renderCard,
  renderIntro,
  renderOutro,
  renderProse,
} from "./blueprint.js";
import { ALL_ARCHETYPES } from "./archetypes.js";
import {
  G9_TASKS,
  STUDIO_GLOBAL,
  conceptBlock,
  genreBrief,
  parametersSection,
  premiseSection,
  worldBrief,
} from "./prompts.js";
import {
  G9BibleZ,
  G9CardZ,
  G9CastEventsZ,
  G9ConceptZ,
  G9TextureZ,
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
  type G9TextureInput,
  type G9TextureOutput,
} from "./types.js";

/**
 * G9 — the five stages (AIF-003).
 *
 * | stage      | variantId       | tier  | shape                                   |
 * |------------|-----------------|-------|-----------------------------------------|
 * | concept    | G9-concept@v1   | high  | 1 call. Small output, all the judgement |
 * | bible      | G9-bible@v1     | high  | 1 call per locale                       |
 * | cards      | G9-cards@v1     | mid   | 1 call per character (fan-out of 8)     |
 * | castevents | G9-events@v1    | mid   | 1 call                                  |
 * | texture    | G9-texture@v1   | light | 1 call per locale                       |
 *
 * Each is an ordinary `GeneratorSpec`, so the gateway's single `run()` gives every stage its own
 * `GenerationLog` row with four token counts, a cost and a stop reason — and its own deterministic
 * fallback, which is why a world can never come back half-built.
 */

const ARCHETYPE_KEYS = new Set(ALL_ARCHETYPES.map((a) => a.key));

/* ------------------------------------------------------------ shared repair ---- */

function localeText(v: { en: string; ja: string }, max: number): { en: string; ja: string } {
  return { en: clamp(v.en, max), ja: clamp(v.ja, max) };
}

function bothPresent(v: { en: string; ja: string }): boolean {
  return v.en.trim().length > 0 && v.ja.trim().length > 0;
}

/**
 * Cast repair. The model may return the wrong number of accounts, an "@" prefix, a duplicate
 * archetype or no press account at all; every one of those is fixable, and the shape the rest of
 * the product depends on (exactly 8, exactly one press, a legal first entry) is not negotiable.
 */
function repairCast(raw: readonly G9ConceptCast[], reference: G9Concept): G9ConceptCast[] {
  const seenHandles = new Set<string>();
  const seenArchetypes = new Set<string>();
  const cleaned: G9ConceptCast[] = [];

  for (const c of raw) {
    const handle = bareHandle(c.handle.trim().toLowerCase());
    if (!HANDLE_RE.test(handle) || seenHandles.has(handle)) continue;
    const archetype = ARCHETYPE_KEYS.has(c.archetype) && !seenArchetypes.has(c.archetype)
      ? c.archetype
      : "";
    if (archetype === "") continue;
    seenHandles.add(handle);
    seenArchetypes.add(archetype);
    cleaned.push({
      handle,
      displayName: clamp(c.displayName, 60) || handle,
      role: clamp(c.role, 60) || "account",
      archetype,
      avatarKey: clamp(c.avatarKey, 60) || `${archetype}-${handle}`,
      isPressAccount: archetype === "press" ? true : c.isPressAccount,
      canBeFirstFollower: archetype === "press" ? false : c.canBeFirstFollower,
      intro: localeText(c.intro, 160),
    });
  }

  // Top up from the deterministic roster: the world must have eight accounts.
  for (const ref of reference.cast) {
    if (cleaned.length >= WORLD_STUDIO.CAST_SIZE) break;
    if (seenHandles.has(ref.handle) || seenArchetypes.has(ref.archetype)) continue;
    seenHandles.add(ref.handle);
    seenArchetypes.add(ref.archetype);
    cleaned.push({ ...ref, intro: { ...ref.intro } });
  }
  const cast = cleaned.slice(0, WORLD_STUDIO.CAST_SIZE);

  // Exactly one press account.
  const press = cast.filter((c) => c.isPressAccount);
  if (press.length === 0) {
    const fallbackPress = cast.find((c) => c.archetype === "press") ?? cast[cast.length - 1];
    if (fallbackPress !== undefined) {
      fallbackPress.isPressAccount = true;
      fallbackPress.canBeFirstFollower = false;
    }
  } else if (press.length > 1) {
    for (const c of press.slice(1)) c.isPressAccount = false;
  }

  // The picker takes the first entry, so it has to be selectable; and it must not be the press.
  const firstSelectable = cast.findIndex((c) => !c.isPressAccount);
  if (firstSelectable > 0) {
    const [moved] = cast.splice(firstSelectable, 1);
    if (moved !== undefined) cast.unshift(moved);
  }
  const head = cast[0];
  if (head !== undefined) head.canBeFirstFollower = true;

  // At least five first-follower options (worlds.test asserts this shape for hand-authored worlds).
  let selectable = cast.filter((c) => c.canBeFirstFollower).length;
  for (const c of cast) {
    if (selectable >= 5) break;
    if (c.isPressAccount || c.canBeFirstFollower) continue;
    c.canBeFirstFollower = true;
    selectable += 1;
  }
  return cast;
}

/* ------------------------------------------------------------ G9a — concept ---- */

export const g9Concept: GeneratorSpec<G9ConceptInput, G9Concept> = {
  id: "G9",
  maxTokens: 4000,
  defaultTier: "high",
  schema: G9ConceptZ,

  render(input: G9ConceptInput): RenderedPrompt {
    const { base } = input;
    return {
      system: [STUDIO_GLOBAL[base.locale], genreBrief(base.genre, base.locale)],
      user: joinSections([
        G9_TASKS.concept[base.locale],
        premiseSection(base),
        parametersSection(base),
      ]),
    };
  },

  fallback(input: G9ConceptInput): G9Concept {
    return deterministicConcept(input.base);
  },

  postprocess(raw: G9Concept, input: G9ConceptInput): G9Concept | null {
    const reference = deterministicConcept(input.base);
    const cast = repairCast(raw.cast, reference);
    if (cast.length !== WORLD_STUDIO.CAST_SIZE) return null;
    const title = localeText(raw.title, 60);
    if (!bothPresent(title)) return null;

    const places = raw.places.slice(0, 6).map((p) => ({
      name: localeText(p.name, 60),
      note: localeText(p.note, 240),
    }));
    const factions = raw.factions.slice(0, 4).map((f) => ({
      name: localeText(f.name, 60),
      blurb: localeText(f.blurb, 320),
    }));
    const slang = raw.slang
      .slice(0, 16)
      .map((s) => ({ term: clamp(s.term, 40), gloss: localeText(s.gloss, 200) }))
      .filter((s) => s.term.length > 0);

    return {
      title,
      scenario: localeText(raw.scenario, 200),
      difficulty: Math.max(1, Math.min(3, Math.round(raw.difficulty))),
      tone: localeText(raw.tone, 300),
      platform: {
        name: clamp(raw.platform.name, 24) || reference.platform.name,
        conceit: localeText(raw.platform.conceit, 800),
      },
      setting: localeText(raw.setting, 1200),
      places: places.length > 0 ? places : reference.places,
      factions: factions.length > 0 ? factions : reference.factions,
      slang: slang.length > 0 ? slang : reference.slang,
      cast,
    };
  },
};

/* -------------------------------------------------------------- G9b — bible ---- */

/** The bible half is the cached prefix of every later generation, so it must have real weight. */
const MIN_PROSE_CHARS: Record<Locale, number> = { en: 900, ja: 400 };

export const g9Bible: GeneratorSpec<G9BibleInput, G9BibleOutput> = {
  id: "G9",
  maxTokens: 8000,
  defaultTier: "high",
  schema: G9BibleZ,

  render(input: G9BibleInput): RenderedPrompt {
    return {
      system: [STUDIO_GLOBAL[input.locale], conceptBlock(input.concept)],
      user: joinSections([
        G9_TASKS.bible[input.locale],
        parametersSection(input.base, [`target locale for this call: ${input.locale}`]),
      ]),
    };
  },

  fallback(input: G9BibleInput): G9BibleOutput {
    return {
      prose: renderProse(input.concept, input.base.genre, input.locale),
      outro: renderOutro(input.concept, input.base.genre, input.locale),
    };
  },

  postprocess(raw: G9BibleOutput, input: G9BibleInput): G9BibleOutput | null {
    const prose = raw.prose.trim();
    const outro = raw.outro.trim();
    const floor = MIN_PROSE_CHARS[input.locale];
    if (prose.length < floor || outro.length < floor / 2) return null;
    return { prose, outro };
  },
};

/* -------------------------------------------------------------- G9c — cards ---- */

export const g9Card: GeneratorSpec<G9CardInput, G9CardOutput> = {
  id: "G9",
  maxTokens: 2400,
  defaultTier: "mid",
  schema: G9CardZ,

  render(input: G9CardInput): RenderedPrompt {
    const member = input.concept.cast.find((c) => c.handle === input.handle);
    const { base } = input;
    return {
      system: [STUDIO_GLOBAL[base.locale], worldBrief(input.concept, input.prose)],
      user: joinSections([
        G9_TASKS.cards[base.locale],
        section(
          "THE ACCOUNT THIS CALL WRITES",
          member === undefined
            ? `@${input.handle}`
            : [
                `handle: @${member.handle}`,
                `display name: ${member.displayName}`,
                `role: ${member.role}`,
                `archetype: ${member.archetype}`,
                `press account: ${member.isPressAccount ? "yes" : "no"}`,
                `selectable as first follower: ${member.canBeFirstFollower ? "yes" : "no"}`,
                `intro (en): ${member.intro.en}`,
                `intro (ja): ${member.intro.ja}`,
              ].join("\n"),
        ),
        parametersSection(base),
      ]),
    };
  },

  fallback(input: G9CardInput): G9CardOutput {
    const member =
      input.concept.cast.find((c) => c.handle === input.handle) ?? input.concept.cast[0];
    if (member === undefined) return { card: { en: "", ja: "" }, intro: { en: "", ja: "" } };
    return {
      card: {
        en: renderCard(input.concept, input.base.genre, member, "en"),
        ja: renderCard(input.concept, input.base.genre, member, "ja"),
      },
      intro: {
        en: renderIntro(input.concept, input.base.genre, member, "en"),
        ja: renderIntro(input.concept, input.base.genre, member, "ja"),
      },
    };
  },

  postprocess(raw: G9CardOutput): G9CardOutput | null {
    const card = localeText(raw.card, 2400);
    const intro = localeText(raw.intro, 160);
    // A card shorter than this is not a card; the deterministic one is better than a stub.
    if (card.en.length < 200 || card.ja.length < 100) return null;
    if (!bothPresent(intro)) return null;
    return { card, intro };
  },
};

/* --------------------------------------------------------- G9d — cast/events ---- */

function repairPersonas(
  raw: G9CastEventsOutput["personas"],
  reference: G9CastEventsOutput["personas"],
  castHandles: ReadonlySet<string>,
): G9CastEventsOutput["personas"] {
  const seen = new Set<string>();
  const out: G9CastEventsOutput["personas"] = [];
  for (const p of [...raw, ...reference]) {
    if (out.length >= WORLD_STUDIO.PRESET_PERSONAS) break;
    const handle = bareHandle(p.handle.trim().toLowerCase());
    if (!HANDLE_RE.test(handle) || seen.has(handle) || castHandles.has(handle)) continue;
    const bio = localeText(p.bio, 200);
    const displayName = localeText(p.displayName, 40);
    if (!bothPresent(bio) || !bothPresent(displayName)) continue;
    seen.add(handle);
    out.push({ handle, displayName, bio, avatarKey: clamp(p.avatarKey, 60) || `persona-${handle}` });
  }
  return out;
}

function repairEvents(
  raw: G9CastEventsOutput["events"],
  reference: G9CastEventsOutput["events"],
): G9CastEventsOutput["events"] {
  const clampDelta = (n: number, lo: number, hi: number): number =>
    Math.max(lo, Math.min(hi, Math.round(n)));
  const out: G9CastEventsOutput["events"] = [];
  const seenTitles = new Set<string>();

  for (const e of [...raw, ...reference]) {
    if (out.length >= WORLD_STUDIO.PRESET_EVENTS) break;
    const title = localeText(e.title, 80);
    if (!bothPresent(title) || seenTitles.has(title.en)) continue;
    // Exactly three choices: WorldSeedZ requires it and the UI renders three buttons.
    const source = e.choices.length >= 3 ? e.choices.slice(0, 3) : null;
    if (source === null) continue;
    seenTitles.add(title.en);
    out.push({
      title,
      prompt: localeText(e.prompt, 240),
      choices: source.map((c) => ({
        label: localeText(c.label, 60),
        outcomeText: localeText(c.outcomeText, 240),
        statDeltas: {
          followers: clampDelta(c.statDeltas.followers, -50, 50),
          aura: clampDelta(c.statDeltas.aura, -10, 10),
          humor: clampDelta(c.statDeltas.humor, -10, 10),
        },
      })),
    });
  }
  return out;
}

export const g9CastEvents: GeneratorSpec<G9CastEventsInput, G9CastEventsOutput> = {
  id: "G9",
  maxTokens: 6000,
  defaultTier: "mid",
  schema: G9CastEventsZ,

  render(input: G9CastEventsInput): RenderedPrompt {
    const { base } = input;
    return {
      system: [STUDIO_GLOBAL[base.locale], worldBrief(input.concept, input.prose)],
      user: joinSections([G9_TASKS.castevents[base.locale], parametersSection(base)]),
    };
  },

  fallback(input: G9CastEventsInput): G9CastEventsOutput {
    return deterministicCastEvents(input.base, input.concept);
  },

  postprocess(raw: G9CastEventsOutput, input: G9CastEventsInput): G9CastEventsOutput | null {
    const reference = deterministicCastEvents(input.base, input.concept);
    const castHandles = new Set(input.concept.cast.map((c) => c.handle));
    const personas = repairPersonas(raw.personas, reference.personas, castHandles);
    const events = repairEvents(raw.events, reference.events);
    if (personas.length < WORLD_STUDIO.PRESET_PERSONAS) return null;
    if (events.length < WORLD_STUDIO.PRESET_EVENTS) return null;
    return { personas, events };
  },
};

/* ------------------------------------------------------------ G9e — texture ---- */

export const g9Texture: GeneratorSpec<G9TextureInput, G9TextureOutput> = {
  id: "G9",
  maxTokens: 5000,
  defaultTier: "light",
  schema: G9TextureZ,

  render(input: G9TextureInput): RenderedPrompt {
    const roster = input.concept.cast
      .map((c) => `- @${c.handle} (${c.displayName}) — ${c.role}${c.isPressAccount ? " [PRESS]" : ""}`)
      .join("\n");
    return {
      system: [STUDIO_GLOBAL[input.locale], worldBrief(input.concept, input.prose)],
      user: joinSections([
        G9_TASKS.texture[input.locale],
        section("HANDLES — ONLY THESE MAY POST", roster),
        parametersSection(input.base, [`target locale for this call: ${input.locale}`]),
      ]),
    };
  },

  fallback(input: G9TextureInput): G9TextureOutput {
    return deterministicTexture(input.base, input.concept, input.locale);
  },

  postprocess(raw: G9TextureOutput, input: G9TextureInput): G9TextureOutput | null {
    const known = new Set(input.concept.cast.map((c) => c.handle));
    const reference = deterministicTexture(input.base, input.concept, input.locale);

    const seen = new Set<string>();
    const ambient = raw.ambient
      .map((p) => ({ handle: bareHandle(p.handle.trim().toLowerCase()), text: clamp(p.text, 280) }))
      .filter((p) => known.has(p.handle) && p.text.length > 0)
      .filter((p) => {
        if (seen.has(p.text)) return false;
        seen.add(p.text);
        return true;
      });
    // Top up from the world's own deterministic pool rather than shipping a thin feed.
    for (const p of reference.ambient) {
      if (ambient.length >= WORLD_STUDIO.AMBIENT_PER_LOCALE) break;
      if (seen.has(p.text)) continue;
      seen.add(p.text);
      ambient.push(p);
    }
    if (ambient.length === 0) return null;

    const fallbackReplies: Record<string, string[]> = {};
    const welcomePosts: Record<string, string> = {};
    for (const c of input.concept.cast) {
      const lines = (raw.fallbackReplies[c.handle] ?? [])
        .map((l) => clamp(l, 160))
        .filter((l) => l.length > 0);
      const topped = [...lines];
      for (const l of reference.fallbackReplies[c.handle] ?? []) {
        if (topped.length >= 5) break;
        if (!topped.includes(l)) topped.push(l);
      }
      fallbackReplies[c.handle] = topped.slice(0, 5);
      const welcome = clamp(raw.welcomePosts[c.handle] ?? "", 280);
      welcomePosts[c.handle] = welcome.length > 0 ? welcome : (reference.welcomePosts[c.handle] ?? "");
    }

    return { ambient: ambient.slice(0, WORLD_STUDIO.AMBIENT_PER_LOCALE), fallbackReplies, welcomePosts };
  },
};

/* ------------------------------------------------------------- replay hooks ---- */

/**
 * Replay mode. Every stage replays as its own deterministic slice of the blueprint, so a replay
 * world and a fail-mode world are the same world — the difference is only `meta.fallback`.
 */
export function replayG9Concept(input: G9ConceptInput): G9Concept {
  return deterministicConcept(input.base);
}
export function replayG9Bible(input: G9BibleInput): G9BibleOutput {
  return g9Bible.fallback(input);
}
export function replayG9Card(input: G9CardInput): G9CardOutput {
  return g9Card.fallback(input);
}
export function replayG9CastEvents(input: G9CastEventsInput): G9CastEventsOutput {
  return g9CastEvents.fallback(input);
}
export function replayG9Texture(input: G9TextureInput): G9TextureOutput {
  return g9Texture.fallback(input);
}

/** Seeds for the gateway's replay latency jitter: stable, and different per stage. */
export function stageSeed(base: { seed: number; slug: string }, salt: string): number {
  return base.seed + pick(97, base.slug, salt);
}

export { G9_VARIANT_IDS, LOCALES };
