import { router } from "expo-router";

type DismissRouter = { canDismiss?: () => boolean; dismissAll?: () => void };

/**
 * Return to the feed without stacking a second `(tabs)` instance.
 * `router.replace("/feed")` from a modal that was pushed on top of the tabs
 * mounts the tab navigator twice (duplicate data-testids), so dismiss instead.
 */
export function resetToFeed(): void {
  const r = router as unknown as DismissRouter;
  try {
    if (r.canDismiss?.() && r.dismissAll) {
      r.dismissAll();
      return;
    }
  } catch {
    /* fall through */
  }
  if (router.canGoBack()) router.back();
  else router.replace("/feed");
}
