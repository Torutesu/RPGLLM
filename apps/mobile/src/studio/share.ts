import { Platform, Share } from "react-native";
import type { Locale } from "@rpgllm/shared";
import { API_ORIGIN } from "../env";

/**
 * The link an unlisted world lives behind.
 *
 * It points at the **API**, not at this app: `/s/w/:id` (`apps/api/src/routes/share.ts`) is
 * server-rendered HTML with `og:` tags and a poster, and this app is a single-page bundle that
 * answers a crawler with an empty div. A link that previews as a naked URL in the one place
 * sharing happens — somebody else's feed or group chat — is a link nobody clicks, and an unlisted
 * world has no other distribution at all.
 *
 * The share page then hands the recipient one large "Open it" into `/world/:id` here. That is one
 * extra tap, deliberately: the alternative is serving crawlers a different page from people, which
 * breaks the day a crawler changes its user agent and is cloaking besides.
 *
 * `?lang=` carries the *sharer's* language, so a link sent by a Japanese player unfurls in Japanese
 * for whoever they sent it to. It is the only signal about the reader we have.
 */
export function worldShareUrl(worldId: string, locale?: Locale): string {
  return `${API_ORIGIN}/s/w/${encodeURIComponent(worldId)}${locale ? `?lang=${locale}` : ""}`;
}

/**
 * A creator's page, as a link (勝ち筋 A ②). Same `/s/*` reasoning: a name worth crediting is a name
 * worth sending someone, and a link to a body of work that previews as a bare URL sends nobody.
 */
export function creatorShareUrl(handle: string, locale?: Locale): string {
  const bare = handle.replace(/^@+/, "");
  return `${API_ORIGIN}/s/c/${encodeURIComponent(bare)}${locale ? `?lang=${locale}` : ""}`;
}

/**
 * Hand the link to whatever the platform has: the native share sheet, the web share sheet, or the
 * clipboard. Resolves `true` when the link went to the clipboard, so the caller can say "Copied"
 * only when that is what actually happened.
 */
export async function shareWorldLink(url: string, title: string): Promise<boolean> {
  try {
    if (Platform.OS === "web") {
      const nav =
        typeof navigator !== "undefined"
          ? (navigator as Navigator & { share?: (d: { title: string; text: string; url: string }) => Promise<void> })
          : undefined;
      if (nav?.share) {
        await nav.share({ title, text: title, url });
        return false;
      }
      await nav?.clipboard?.writeText(url);
      return true;
    }
    await Share.share({ message: `${title}\n${url}` });
    return false;
  } catch {
    // A dismissed share sheet and a blocked clipboard look the same here; both mean "not copied".
    return false;
  }
}
