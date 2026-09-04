/**
 * Handles are stored WITHOUT the leading "@" (apps/api validates persona handles with
 * /^[a-z0-9_]{3,15}$/ and apps/mobile renders the "@" itself; testids are `persona-<handle>`).
 *
 * World sources and replay fixtures are authored with the "@" because that is how they read in
 * prose; every structured `handle` field is normalised through here at module load.
 */
export function bareHandle(handle: string): string {
  return handle.startsWith("@") ? handle.slice(1) : handle;
}

export const HANDLE_RE = /^[a-z0-9_]{3,15}$/;

/** Rewrite the keys of a handle-keyed record. Key order is preserved (insertion order). */
export function bareKeys<T>(record: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(record)) out[bareHandle(k)] = v;
  return out;
}
