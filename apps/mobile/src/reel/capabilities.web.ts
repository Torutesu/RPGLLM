import type { ReelFile } from "./types";

/**
 * What this browser can actually do — asked, never assumed.
 *
 * Recording needs three separate things and any of them can be missing: a canvas that can be turned
 * into a `MediaStream`, a `MediaRecorder`, and a container/codec pair it will accept. Safari on iOS,
 * for instance, has `MediaRecorder` but has had `captureStream` behind a flag; a Firefox build with
 * media disabled has neither. Each is checked separately so the failure is "this browser can't", not
 * a thrown exception halfway through a nine-second render.
 */
const MIMES: readonly { mime: string; ext: string }[] = [
  { mime: "video/mp4;codecs=avc1.42E01E", ext: "mp4" },
  { mime: "video/mp4", ext: "mp4" },
  { mime: "video/webm;codecs=vp9", ext: "webm" },
  { mime: "video/webm;codecs=vp8", ext: "webm" },
  { mime: "video/webm", ext: "webm" },
];

export function pickMime(): { mime: string; ext: string } | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const candidate of MIMES) {
    try {
      if (MediaRecorder.isTypeSupported(candidate.mime)) return candidate;
    } catch {
      /* a browser that throws on the question has answered it */
    }
  }
  return null;
}

export function canRecord(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  if (typeof HTMLCanvasElement === "undefined") return false;
  if (typeof HTMLCanvasElement.prototype.captureStream !== "function") return false;
  if (typeof MediaRecorder === "undefined") return false;
  return pickMime() !== null;
}

/**
 * Hands the file over. The sandboxed alternative — opening a blob in a tab — loses the filename and
 * is blocked by popup rules, so this is a real anchor with a real `download`.
 */
export function saveFile(file: ReelFile): boolean {
  if (typeof document === "undefined") return false;
  try {
    const a = document.createElement("a");
    a.href = file.url;
    a.download = file.name;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return true;
  } catch {
    return false;
  }
}

export function releaseFile(file: ReelFile): void {
  try {
    URL.revokeObjectURL(file.url);
  } catch {
    /* already gone */
  }
}
