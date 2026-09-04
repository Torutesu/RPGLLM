import type { Locale, WorldSeed } from "@rpgllm/shared";
import { LOCALES } from "@rpgllm/shared";

/**
 * Authoring format for a preset world.
 *
 * The bible string that ships as `system[1]` is assembled here from `prose` + the cast cards +
 * `outro`, so the cast cards exist exactly once in the source. Assembly is pure and
 * deterministic (no dates, no ids, fixed order) — the byte-identical string is what makes the
 * cross-user cache prefix hit (cost-architecture 3.1). Once a world ships, editing the prose
 * invalidates that world's cache for everyone, which is fine but should be a deliberate act.
 */

export interface CastSource {
  handle: string;
  displayName: string;
  role: string;
  avatarKey: string;
  isPressAccount?: boolean;
  canBeFirstFollower?: boolean;
  /** full card: voice, values, catchphrases, NG topics, stance to the player, praise/drama reactions */
  card: Record<Locale, string>;
  /** one-line intro used by the first-follower picker (SCR-006) */
  intro: Record<Locale, string>;
}

export interface EventSource {
  title: Record<Locale, string>;
  prompt: Record<Locale, string>;
  choices: Array<{
    label: Record<Locale, string>;
    outcomeText: Record<Locale, string>;
    statDeltas: { followers: number; aura: number; humor: number };
  }>;
}

export interface WorldSource {
  slug: string;
  difficulty: number;
  title: Record<Locale, string>;
  scenario: Record<Locale, string>;
  /** bible part 1: setting, tone, platform, slang, factions */
  prose: Record<Locale, string>;
  /** bible part 3: press rules, drama arcs, stat rules, output reminders */
  outro: Record<Locale, string>;
  cast: CastSource[];
  presetPersonas: Array<{
    handle: string;
    displayName: Record<Locale, string>;
    bio: Record<Locale, string>;
    avatarKey: string;
  }>;
  presetEvents: EventSource[];
  fallbackReplies: Record<string, Record<Locale, string[]>>;
  ambientPool: Record<Locale, Array<{ handle: string; text: string }>>;
  welcomePosts: Record<string, Record<Locale, string>>;
}

const CAST_HEADER: Record<Locale, string> = {
  en: "# CAST — the eight accounts that exist in this world\nEvery reply, DM and news post must come from one of these handles. Never invent a ninth.",
  ja: "# キャスト — この世界に存在する8アカウント\n返信・DM・ニュース投稿は必ずこのハンドルのいずれかから出す。9人目を作らない。",
};

function renderCastCards(cast: readonly CastSource[], locale: Locale): string {
  return cast
    .map((c) => {
      const tags = [
        c.isPressAccount ? "PRESS ACCOUNT" : null,
        c.canBeFirstFollower === false ? "not selectable as first follower" : null,
      ].filter((t): t is string => t !== null);
      const suffix = tags.length > 0 ? ` [${tags.join(" / ")}]` : "";
      return `## ${c.handle} — ${c.displayName} (${c.role})${suffix}\n${c.card[locale].trim()}`;
    })
    .join("\n\n");
}

/** Assemble the verbatim `system[1]` string for one locale. */
export function renderBible(src: WorldSource, locale: Locale): string {
  return [
    src.prose[locale].trim(),
    CAST_HEADER[locale],
    renderCastCards(src.cast, locale),
    src.outro[locale].trim(),
  ].join("\n\n");
}

export function buildWorld(src: WorldSource): WorldSeed {
  const bible = {} as Record<Locale, string>;
  for (const locale of LOCALES) bible[locale] = renderBible(src, locale);

  return {
    slug: src.slug,
    difficulty: src.difficulty,
    title: src.title,
    scenario: src.scenario,
    bible,
    cast: src.cast.map((c) => ({
      handle: c.handle,
      displayName: c.displayName,
      role: c.role,
      card: c.card,
      isPressAccount: c.isPressAccount ?? false,
      intro: c.intro,
      canBeFirstFollower: c.canBeFirstFollower ?? true,
      avatarKey: c.avatarKey,
    })),
    presetPersonas: src.presetPersonas,
    presetEvents: src.presetEvents.map((e) => ({
      title: e.title,
      prompt: e.prompt,
      choices: e.choices as WorldSeed["presetEvents"][number]["choices"],
    })),
    fallbackReplies: src.fallbackReplies,
    ambientPool: src.ambientPool,
    welcomePosts: src.welcomePosts,
  };
}
