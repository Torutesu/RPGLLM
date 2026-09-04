/** Character handles are stored with a leading "@"; persona handles without one. Compare normalized. */
export const normHandle = (h: string): string => h.replace(/^@+/, "").toLowerCase();
export const atHandle = (h: string): string => `@${normHandle(h)}`;
export const sameHandle = (a: string, b: string): boolean => normHandle(a) === normHandle(b);
