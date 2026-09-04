import type { Locale } from "@prisma/client";
import { LOCALES } from "@rpgllm/shared";

export type LocaleKey = (typeof LOCALES)[number];

export const isLocale = (v: unknown): v is LocaleKey => typeof v === "string" && (LOCALES as readonly string[]).includes(v);

/** Read a `{en, ja}` JSON column for a locale, falling back to `en` then to any string present. */
export function localized(value: unknown, locale: Locale | LocaleKey): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const wanted = rec[locale];
    if (typeof wanted === "string") return wanted;
    const en = rec["en"];
    if (typeof en === "string") return en;
    for (const v of Object.values(rec)) if (typeof v === "string") return v;
  }
  return "";
}

/** First sentence (used to derive a character `intro` when the seed has none). */
export function firstSentence(text: string, max = 120): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  const cut = trimmed.split(/(?<=[.!?。！？])\s/)[0] ?? trimmed;
  return cut.length > max ? `${cut.slice(0, max - 1)}…` : cut;
}
