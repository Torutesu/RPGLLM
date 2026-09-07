/**
 * The page a shared link unfurls into (task 45).
 *
 * Everything a player can share — a world, a moment, a creator — pointed at the Expo web app,
 * which is a single-page bundle: a crawler asks for it, gets an empty `<div id="root">`, and the
 * link previews as a bare URL with no title, no description and no picture. That is the whole
 * reason the reel exists undermined in one step, because the reel is a distribution artifact and
 * distribution happens in someone else's feed, next to links that *do* have a card.
 *
 * So the share target moved to the API, which can answer a crawler with real HTML. Three decisions
 * are worth keeping:
 *
 * **1. No redirect.** The obvious trick — sniff the user agent, bounce humans to the app, serve
 * meta to bots — makes the preview depend on a UA allow-list that is wrong the day a new crawler
 * ships, and it is cloaking: serving one thing to a crawler and another to a person is the exact
 * pattern search engines penalise. This page is the same page for everybody, and the human gets
 * one large link to the app.
 *
 * **2. It shows only what is already public.** A world here is `published` and `public` or
 * `unlisted` — the same predicate the shelf uses — so nothing reaches an unauthenticated page that
 * an unauthenticated API call would not already return. An unlisted world is `noindex`: the link
 * is its distribution, a search result is not.
 *
 * **3. Copy is i18n, colour is tokens.** This is the only screen in the product that is not React,
 * and that is not a licence to hand-write a hex code or an English string into HTML.
 */
import { colors, font, radius, spacing, t, T, type Locale } from "@rpgllm/shared";

export interface SharePageInput {
  locale: Locale;
  /** `og:title` and the visible headline. */
  title: string;
  /** `og:description` and the visible body. Trimmed to something a card will actually show. */
  description: string;
  /** Small label above the title: what kind of thing this is. */
  kicker: string;
  /** Facts under the title — a credit line, a play count. Already localised by the caller. */
  facts: string[];
  imageUrl: string;
  canonicalUrl: string;
  /** Where "Open it" goes: the app's own deep link. */
  appUrl: string;
  ogType: "article" | "profile" | "website";
  /** False for an unlisted world: previewable by anyone holding the link, indexable by nobody. */
  indexable: boolean;
}

/** HTML-escapes text and attribute values alike, so one function can never be the wrong one. */
export const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * Cards truncate, and they truncate mid-word. Doing it here means the ellipsis lands somewhere
 * chosen rather than wherever a given platform's byte limit happened to fall.
 */
export function clip(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  const cut = one.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** `og:locale` wants a territory, and the two we ship are the two that exist here. */
const ogLocale = (locale: Locale): string => (locale === "ja" ? "ja_JP" : "en_US");

const meta = (attr: "name" | "property", key: string, value: string): string =>
  `<meta ${attr}="${key}" content="${esc(value)}">`;

export function renderSharePage(p: SharePageInput, siteName: string): string {
  const title = clip(p.title, 70);
  const description = clip(p.description, 200);
  const head = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${esc(title)}</title>`,
    meta("name", "description", description),
    meta("name", "robots", p.indexable ? "index, follow" : "noindex, follow"),
    `<link rel="canonical" href="${esc(p.canonicalUrl)}">`,
    meta("property", "og:site_name", siteName),
    meta("property", "og:type", p.ogType),
    meta("property", "og:title", title),
    meta("property", "og:description", description),
    meta("property", "og:url", p.canonicalUrl),
    meta("property", "og:image", p.imageUrl),
    // Width and height let a card reserve the space before the image lands, which is the
    // difference between a preview that appears and one that jumps.
    meta("property", "og:image:width", "1200"),
    meta("property", "og:image:height", "630"),
    meta("property", "og:image:type", "image/png"),
    meta("property", "og:image:alt", title),
    meta("property", "og:locale", ogLocale(p.locale)),
    meta("name", "twitter:card", "summary_large_image"),
    meta("name", "twitter:title", title),
    meta("name", "twitter:description", description),
    meta("name", "twitter:image", p.imageUrl),
    meta("name", "twitter:image:alt", title),
    meta("name", "theme-color", colors.bg),
  ].join("\n    ");

  const facts = p.facts
    .filter((f) => f.length > 0)
    .map((f) => `<li>${esc(f)}</li>`)
    .join("");

  return `<!doctype html>
<html lang="${p.locale}">
  <head>
    ${head}
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: ${colors.bg};
        color: ${colors.text};
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Noto Sans JP", Roboto, sans-serif;
        display: flex;
        justify-content: center;
        padding: ${spacing.xl}px ${spacing.lg}px;
      }
      main { width: 100%; max-width: 560px; }
      .poster {
        display: block;
        width: 100%;
        aspect-ratio: 1200 / 630;
        border-radius: ${radius.lg}px;
        border: 1px solid ${colors.border};
        background: ${colors.card};
      }
      .kicker {
        margin: ${spacing.lg}px 0 ${spacing.xs}px;
        color: ${colors.accentHi};
        font-size: ${font.xs}px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      h1 { margin: 0; font-size: ${font.xxl}px; line-height: 1.2; }
      p.body { margin: ${spacing.md}px 0 0; color: ${colors.textDim}; font-size: ${font.md}px; line-height: 1.55; }
      ul.facts {
        list-style: none;
        display: flex;
        flex-wrap: wrap;
        gap: ${spacing.md}px;
        margin: ${spacing.lg}px 0 0;
        padding: 0;
        color: ${colors.textMuted};
        font-size: ${font.sm}px;
      }
      a.open {
        display: block;
        margin-top: ${spacing.xl}px;
        padding: ${spacing.lg}px;
        border-radius: ${radius.pill}px;
        background: ${colors.accent};
        color: ${colors.accentInk};
        font-size: ${font.md}px;
        font-weight: 600;
        text-align: center;
        text-decoration: none;
      }
      footer { margin-top: ${spacing.xl}px; color: ${colors.textMuted}; font-size: ${font.xs}px; }
    </style>
  </head>
  <body>
    <main>
      <img class="poster" data-testid="${T.sharePoster}" src="${esc(p.imageUrl)}" alt="${esc(title)}" width="1200" height="630">
      <p class="kicker">${esc(p.kicker)}</p>
      <h1>${esc(p.title)}</h1>
      <p class="body">${esc(p.description)}</p>
      ${facts ? `<ul class="facts">${facts}</ul>` : ""}
      <a class="open" data-testid="${T.shareOpen}" href="${esc(p.appUrl)}">${esc(t(p.locale, "shareOpen"))}</a>
      <footer>${esc(siteName)}</footer>
    </main>
  </body>
</html>
`;
}
