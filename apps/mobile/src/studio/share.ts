import { Platform, Share } from "react-native";
import { APP_ORIGIN, IS_WEB } from "../env";

/**
 * The link an unlisted world lives behind.
 *
 * An unlisted world is listed nowhere — the link *is* the distribution — so the URL has to be
 * openable by whoever receives it, which a bare path is not. On the web the page's own origin is
 * always right; on a device `EXPO_PUBLIC_APP_URL` is the only thing that can be shared off it.
 * Same shape as the moment share link (`components/MomentCard.tsx`).
 */
export function worldShareUrl(worldId: string): string {
  const path = `/studio/${encodeURIComponent(worldId)}`;
  if (IS_WEB && typeof window !== "undefined" && window.location) return `${window.location.origin}${path}`;
  if (APP_ORIGIN) return `${APP_ORIGIN}${path}`;
  return path;
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
