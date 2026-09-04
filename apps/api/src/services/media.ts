import { MEDIA_EVERY, MEDIA_KINDS, hashString, type MediaKind } from "@rpgllm/shared";

/**
 * Procedural post media (Agent K).
 *
 * There are no external images anywhere in this product: a post that "has a photo" carries only a
 * kind and a seed, and the client draws the picture from that seed with SVG. Which means the choice
 * has to be a pure function of the post id — the same row must produce the same picture on the
 * server, on iOS, on Android and on the web export, forever.
 *
 * `hashString` is the shared FNV-1a from `@rpgllm/shared`, so `apps/mobile/src/lib/derive.ts` can
 * mirror this exactly (PostZ has no room for the fields; see build-notes "Agent K").
 */
export interface PostMedia {
  mediaKind: MediaKind | null;
  mediaSeed: string | null;
}

export const NO_MEDIA: PostMedia = { mediaKind: null, mediaSeed: null };

/** The kinds a given post kind is allowed to carry. The press account leaks and charts; the cast posts art. */
function paletteFor(kind: string): readonly MediaKind[] {
  if (kind === "news") return ["leak", "chart"] as const;
  return MEDIA_KINDS;
}

/**
 * The press account attaches its receipts far more often than the cast posts pictures: a gossip
 * feed without screenshots is not a gossip feed.
 */
const NEWS_EVERY = 2;

/**
 * Roughly one character post in `MEDIA_EVERY` gets media, so the feed has rhythm without turning
 * into a gallery.
 *
 * Two exclusions, both deliberate: `user` posts never carry media (the player has no camera roll
 * in this world), and neither do replies — a picture nested three levels into a thread is noise,
 * and leaving them out is what makes `MEDIA_EVERY` mean "one in four *cells you scroll past*"
 * rather than one in four rows in the table.
 */
export function mediaFor(postId: string, kind: string, parentId: string | null = null): PostMedia {
  if (kind === "user" || kind === "system" || parentId !== null) return NO_MEDIA;
  const h = hashString(postId);
  if (h % (kind === "news" ? NEWS_EVERY : MEDIA_EVERY) !== 0) return NO_MEDIA;
  const palette = paletteFor(kind);
  const mediaKind = palette[(h >>> 8) % palette.length] ?? palette[0]!;
  return { mediaKind, mediaSeed: (h >>> 3).toString(36) };
}
