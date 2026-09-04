/** DB: character handles are stored with a leading "@"; persona handles without one. API output is always bare. Compare normalized. */
export const normHandle = (h: string): string => h.replace(/^@+/, "").toLowerCase();
/** API contract: handles are emitted WITHOUT "@" (clients render the "@"). Kept name for call sites. */
export const atHandle = (h: string): string => normHandle(h);
export const sameHandle = (a: string, b: string): boolean => normHandle(a) === normHandle(b);
