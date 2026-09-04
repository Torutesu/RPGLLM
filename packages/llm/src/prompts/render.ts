import type { CharacterCard, FeedItemCtx, PersonaState, RelationshipCtx } from "../types.js";

/**
 * Deterministic renderers for the dynamic `messages[0]` block (cost-architecture 3.1).
 *
 * Rules for everything in this file:
 *  - stable key order, no `Object.keys` iteration over user data without sorting
 *  - no timestamps, no request ids, no random ids
 *  - keep the whole dynamic block around 800 tokens
 * The prefix (system[0] + system[1]) is what gets cached; this block is what changes.
 */

export interface RenderedPrompt {
  /** one cache_control block each, in order */
  system: string[];
  user: string;
}

export function clamp(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : t.slice(0, max);
}

/** One-line-per-field block with a header. Empty bodies are dropped by the caller. */
export function section(title: string, body: string): string {
  return `## ${title}\n${body}`;
}

export function joinSections(parts: Array<string | null>): string {
  return parts.filter((p): p is string => p !== null && p.trim().length > 0).join("\n\n");
}

export function renderPersona(p: PersonaState, maxSummary = 400): string {
  return [
    `handle: ${p.handle}`,
    `display_name: ${p.displayName}`,
    `bio: ${clamp(p.bio, 160)}`,
    `voice_notes: ${clamp(p.voiceNotes, 200)}`,
    `level: ${p.level}`,
    `followers: ${p.followers}`,
    `aura: ${p.aura}/100`,
    `humor: ${p.humor}/100`,
    `story_so_far: ${clamp(p.worldSummary, maxSummary) || "(nothing yet — this is early)"}`,
  ].join("\n");
}

export function renderRelationships(rels: readonly RelationshipCtx[], maxSummary = 220): string {
  if (rels.length === 0) return "(none yet)";
  return rels
    .map(
      (r) =>
        `- ${r.handle} | affinity ${r.affinity} | ${r.isFollower ? "follows you" : "does not follow you"}\n  ${clamp(r.summary, maxSummary) || "(no history yet)"}`,
    )
    .join("\n");
}

export function renderFeed(items: readonly FeedItemCtx[], maxText = 160): string {
  if (items.length === 0) return "(empty feed)";
  return items.map((f) => `- [${f.kind}] ${f.authorHandle}: ${clamp(f.text, maxText)}`).join("\n");
}

/** Handle whitelist. The model may only mention handles that appear here. */
export function renderCastRoster(cast: readonly CharacterCard[]): string {
  return cast
    .map(
      (c) =>
        `- ${c.handle} (${c.displayName}) — ${c.role}${c.isPressAccount ? " [PRESS ACCOUNT]" : ""}`,
    )
    .join("\n");
}

export function renderCharacterCard(c: CharacterCard): string {
  return `${c.handle} (${c.displayName}) — ${c.role}\n${c.card}`;
}

export function yesNo(v: boolean): string {
  return v ? "yes" : "no";
}
