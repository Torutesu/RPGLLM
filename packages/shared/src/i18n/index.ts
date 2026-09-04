import { en } from "./en";
import { ja } from "./ja";
import type { Locale } from "../constants";
export const strings = { en, ja } as const;
export type StringKey = keyof typeof en;
export function t(locale: Locale, key: StringKey): string {
  const v = strings[locale][key];
  return Array.isArray(v) ? v.join(", ") : (v as string);
}
export function tList(locale: Locale, key: "plusFeatures"): readonly string[] {
  return strings[locale][key];
}
