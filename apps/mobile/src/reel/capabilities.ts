import type { ReelFile } from "./types";

/**
 * Native has no `MediaRecorder` and no `<canvas>`: iOS and Android cannot turn the preview into a
 * file without a native encoder (Skia/AVFoundation/MediaCodec), which is a dependency and a custom
 * dev client rather than a screen. So the honest answer here is "no", and the UI says so in words
 * instead of offering a button that fails.
 *
 * Metro swaps in `capabilities.web.ts` for the browser build.
 */
export function canRecord(): boolean {
  return false;
}

export function saveFile(_file: ReelFile): boolean {
  return false;
}

export function releaseFile(_file: ReelFile): void {
  /* nothing to release: nothing was ever created */
}
