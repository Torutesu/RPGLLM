import { useEffect, useState } from "react";
import * as Font from "expo-font";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { Inter_700Bold } from "@expo-google-fonts/inter/700Bold";
import { SpaceGrotesk_500Medium } from "@expo-google-fonts/space-grotesk/500Medium";
import { SpaceGrotesk_700Bold } from "@expo-google-fonts/space-grotesk/700Bold";

/**
 * Two faces, loaded once at import time and never awaited before first paint.
 *
 * - Space Grotesk (display): the wordmark, hero numbers, level-ups. Wide, geometric, a little odd —
 *   it is the thing that stops the app looking like a system-font wrapper.
 * - Inter (text): everything you actually read.
 *
 * On web `expo-font` injects `@font-face` rules, so the browser reflows the moment the file lands —
 * nothing here blocks the first frame. On native an unloaded family silently falls back to the
 * system face, so `useFontsLoaded()` lets a root component re-render once the real faces arrive.
 */
const FACES = {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_700Bold,
} as const;

let ready = false;
const listeners = new Set<() => void>();

function markReady(): void {
  if (ready) return;
  ready = true;
  for (const fn of listeners) fn();
}

// Fire and forget: a failed font load must never take the app with it.
void Font.loadAsync(FACES).then(markReady, markReady);

export function fontsLoaded(): boolean {
  return ready;
}

/** Re-renders the caller once the real faces are available (a no-op after that). */
export function useFontsLoaded(): boolean {
  const [loaded, setLoaded] = useState(ready);
  useEffect(() => {
    if (ready) {
      setLoaded(true);
      return;
    }
    const fn = (): void => setLoaded(true);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return loaded;
}
