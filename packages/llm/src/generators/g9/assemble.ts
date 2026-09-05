import { LOCALES, WORLD_STUDIO, WorldSeedZ, type Locale, type WorldSeed } from "@rpgllm/shared";
import { buildWorld, type CastSource, type WorldSource } from "../../worlds/build.js";
import {
  deterministicCastEvents,
  deterministicConcept,
  deterministicTexture,
  renderCard,
  renderIntro,
  renderOutro,
  renderProse,
} from "./blueprint.js";
import type {
  G9BibleOutput,
  G9CardOutput,
  G9CastEventsOutput,
  G9Concept,
  G9Input,
  G9TextureOutput,
} from "./types.js";

/**
 * G9 — assembly (AIF-003).
 *
 * The five stages produce parts; this turns them into a `WorldSeed` **through the same
 * `worlds/build.ts` helper the three hand-authored worlds go through**. That matters more than it
 * looks: `buildWorld` is what splices the cast cards between `prose` and `outro`, in a fixed order
 * with no dates and no ids, and that assembled string is the cached prompt prefix every later
 * generation sends. A generated world is byte-identical in shape to an authored one, so it hits
 * the cache the same way and every downstream generator treats it identically.
 *
 * Assembly also has the last word on shape. Anything `WorldSeedZ` requires and a stage failed to
 * deliver is topped up here from the deterministic blueprint, so `assembleWorld` cannot return a
 * seed that fails validation.
 */

export interface G9Parts {
  base: G9Input;
  concept: G9Concept;
  bible: Record<Locale, G9BibleOutput>;
  /** handle -> card; a missing handle falls back to its blueprint card */
  cards: Record<string, G9CardOutput>;
  castEvents: G9CastEventsOutput;
  texture: Record<Locale, G9TextureOutput>;
}

function emptyLocaleRecord<T>(make: (locale: Locale) => T): Record<Locale, T> {
  const out = {} as Record<Locale, T>;
  for (const locale of LOCALES) out[locale] = make(locale);
  return out;
}

function toSource(parts: G9Parts): WorldSource {
  const { base, concept, bible, cards, castEvents, texture } = parts;

  const cast: CastSource[] = concept.cast.map((member) => {
    const written = cards[member.handle];
    return {
      handle: member.handle,
      displayName: member.displayName,
      role: member.role,
      avatarKey: member.avatarKey,
      isPressAccount: member.isPressAccount,
      canBeFirstFollower: member.canBeFirstFollower,
      card: emptyLocaleRecord((locale) => {
        const text = written?.card[locale]?.trim() ?? "";
        return text.length > 0 ? text : renderCard(concept, base.genre, member, locale);
      }),
      intro: emptyLocaleRecord((locale) => {
        const text = written?.intro[locale]?.trim() ?? "";
        return text.length > 0 ? text : renderIntro(concept, base.genre, member, locale);
      }),
    };
  });

  const handles = concept.cast.map((c) => c.handle);

  const fallbackReplies: WorldSource["fallbackReplies"] = {};
  const welcomePosts: WorldSource["welcomePosts"] = {};
  for (const handle of handles) {
    fallbackReplies[handle] = emptyLocaleRecord((locale) => {
      const written = (texture[locale].fallbackReplies[handle] ?? []).filter((l) => l.trim().length > 0);
      const reference = deterministicTexture(base, concept, locale).fallbackReplies[handle] ?? [];
      const lines = [...written];
      for (const line of reference) {
        if (lines.length >= 5) break;
        if (!lines.includes(line)) lines.push(line);
      }
      // WorldSeedZ demands five per handle per locale; a mute character is not shippable.
      while (lines.length < 5) lines.push(reference[lines.length % Math.max(reference.length, 1)] ?? "...");
      return lines.slice(0, 5);
    });
    welcomePosts[handle] = emptyLocaleRecord((locale) => {
      const written = texture[locale].welcomePosts[handle]?.trim() ?? "";
      if (written.length > 0) return written;
      return deterministicTexture(base, concept, locale).welcomePosts[handle] ?? "";
    });
  }

  const ambientPool: WorldSource["ambientPool"] = emptyLocaleRecord((locale) => {
    const known = new Set(handles);
    const seen = new Set<string>();
    const pool: Array<{ handle: string; text: string }> = [];
    const push = (p: { handle: string; text: string }): void => {
      if (!known.has(p.handle) || p.text.trim().length === 0 || seen.has(p.text)) return;
      seen.add(p.text);
      pool.push(p);
    };
    for (const p of texture[locale].ambient) push(p);
    for (const p of deterministicTexture(base, concept, locale).ambient) push(p);
    return pool.slice(0, Math.max(WORLD_STUDIO.AMBIENT_PER_LOCALE, 20));
  });

  const referenceEvents = deterministicCastEvents(base, concept);
  const presetEvents = [...castEvents.events, ...referenceEvents.events]
    .filter((e) => e.choices.length === 3)
    .slice(0, Math.max(WORLD_STUDIO.PRESET_EVENTS, 5));
  const presetPersonas = [...castEvents.personas, ...referenceEvents.personas]
    .filter((p, i, all) => all.findIndex((q) => q.handle === p.handle) === i)
    .slice(0, WORLD_STUDIO.PRESET_PERSONAS);

  return {
    slug: base.slug,
    difficulty: concept.difficulty,
    title: { ...concept.title },
    scenario: { ...concept.scenario },
    prose: emptyLocaleRecord((locale) => {
      const text = bible[locale].prose.trim();
      return text.length > 0 ? text : renderProse(concept, base.genre, locale);
    }),
    outro: emptyLocaleRecord((locale) => {
      const text = bible[locale].outro.trim();
      return text.length > 0 ? text : renderOutro(concept, base.genre, locale);
    }),
    cast,
    presetPersonas: presetPersonas.map((p) => ({
      handle: p.handle,
      displayName: { ...p.displayName },
      bio: { ...p.bio },
      avatarKey: p.avatarKey,
    })),
    presetEvents,
    fallbackReplies,
    ambientPool,
    welcomePosts,
  };
}

/** Stage outputs -> the `WorldSeed` apps/api persists. Never throws; never returns an invalid seed. */
export function assembleWorld(parts: G9Parts): { seed: WorldSeed; valid: boolean } {
  let seed: WorldSeed;
  try {
    seed = buildWorld(toSource(parts));
  } catch {
    return { seed: deterministicWorld(parts.base), valid: false };
  }
  const check = WorldSeedZ.safeParse(seed);
  if (check.success) return { seed, valid: true };
  return { seed: deterministicWorld(parts.base), valid: false };
}

/**
 * The whole world with no model in the loop: the blueprint, assembled. This is what
 * `LLM_MODE=replay` converges to, and the last-resort output if a live run somehow produces
 * parts that cannot be assembled into a valid seed.
 */
export function deterministicWorld(base: G9Input): WorldSeed {
  const concept = deterministicConcept(base);
  const parts: G9Parts = {
    base,
    concept,
    bible: emptyLocaleRecord((locale) => ({
      prose: renderProse(concept, base.genre, locale),
      outro: renderOutro(concept, base.genre, locale),
    })),
    cards: Object.fromEntries(
      concept.cast.map((member) => [
        member.handle,
        {
          card: emptyLocaleRecord((locale) => renderCard(concept, base.genre, member, locale)),
          intro: emptyLocaleRecord((locale) => renderIntro(concept, base.genre, member, locale)),
        },
      ]),
    ),
    castEvents: deterministicCastEvents(base, concept),
    texture: emptyLocaleRecord((locale) => deterministicTexture(base, concept, locale)),
  };
  return buildWorld(toSource(parts));
}
