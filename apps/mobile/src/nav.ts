import { router } from "expo-router";

type DismissRouter = {
  canDismiss?: () => boolean;
  dismiss?: (count?: number) => void;
  dismissTo?: (href: string) => void;
};

/**
 * Return to the feed without stacking a second `(tabs)` instance.
 * `router.replace("/feed")` from a modal that was pushed on top of the tabs mounts the tab
 * navigator twice (duplicate data-testids). `dismissAll()` is wrong too: on web the stack root
 * is whatever screen the session started on (e.g. SCR-003 after onboarding), so it would leave
 * the feed entirely. `dismissTo("/feed")` pops back to the feed when it is in the stack and
 * replaces the current screen otherwise.
 */
export function resetToFeed(): void {
  const r = router as unknown as DismissRouter;
  try {
    if (r.dismissTo) {
      r.dismissTo("/feed");
      return;
    }
  } catch {
    /* fall through */
  }
  try {
    if (r.canDismiss?.() && r.dismiss) {
      r.dismiss(1);
      return;
    }
  } catch {
    /* fall through */
  }
  if (router.canGoBack()) router.back();
  else router.replace("/feed");
}

/**
 * `router.push`, but a second identical push inside `GUARD_MS` is dropped.
 *
 * Expo Router keeps every stacked screen mounted, so pushing the same route twice mounts it twice
 * and every `data-testid` on it matches twice — a double-tapped button (or a fast automated
 * driver) is enough to do it. The screens the author circuits added are exactly the ones at risk:
 * `/creator/[handle]`, `/creator/rename` and the studio in remix mode all carry ids that must
 * resolve to one element.
 */
const GUARD_MS = 700;
let lastHref = "";
let lastAt = 0;

export function pushOnce(href: Parameters<typeof router.push>[0]): void {
  const key = typeof href === "string" ? href : JSON.stringify(href);
  const now = Date.now();
  if (key === lastHref && now - lastAt < GUARD_MS) return;
  lastHref = key;
  lastAt = now;
  router.push(href);
}
