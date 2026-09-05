import { WORLD_GENRES, type Locale, type WorldGenre } from "@rpgllm/shared";
import { seedFrom } from "./bandit.js";
import type { G9Input } from "./generators/g9/types.js";

/**
 * The frozen G9 evaluation set (cost-architecture §6.2).
 *
 * Two premises per genre, one written in English and one in Japanese, plus two hard cases — a
 * premise built to be echoed back and a premise at the 400-character limit. Sixteen genre cases is
 * what makes the distinctness check meaningful: every genre has a sibling built from a *different*
 * premise, so "two premises in the same genre must not produce the same world" is measurable
 * rather than asserted.
 *
 * Nothing here reads a clock or a random source. Same list, same order, same seeds, for ever —
 * and every premise passes `screenPremise`, which the suite checks so the set can never drift into
 * one that the product would refuse before generation.
 */

export interface G9EvalCaseSpec {
  /** stable identity of the case; the DB row is upserted on it */
  key: string;
  generator: "G9";
  locale: Locale;
  /** the slug the world is built under — also `EvalCase.worldSlug` */
  worldSlug: string;
  label: string;
  frozen: boolean;
  input: G9Input;
}

/** [genre, EN premise, JA premise] — the two halves of that genre's pair. */
const GENRE_PREMISES: Readonly<Record<WorldGenre, readonly [string, string]>> = {
  fame: [
    "a photographer who accidentally becomes the most followed account in the city",
    "路上ライブの動画が勝手に伸びて、朝には知らない街の話題になっていた",
  ],
  academy: [
    "rival students competing for a single scholarship at a magic academy",
    "全寮制の学院で、評点が毎週すべて公開される",
  ],
  idol: [
    "an idol trainee who joined the survival show three weeks late",
    "解散したグループの最後の一人が、別の名前でもう一度始める",
  ],
  office: [
    "office workers surviving a reorganisation nobody will name",
    "社内SNSだけが本音の会社で、匿名アカウントが一つ暴走する",
  ],
  sports: [
    "a mid-table football club fighting relegation with a young squad",
    "廃部寸前の弓道部が、県大会の一試合だけ注目される",
  ],
  fantasy: [
    "an adventurers' guild where your reputation is a public ledger",
    "魔法が有料になった街で、一銭も払わない魔術師が名を上げる",
  ],
  mystery: [
    "a murder mystery in a seaside town after a storm",
    "嵐で足止めされた旅館で、宿泊客の一人が消える",
  ],
  slice_of_life: [
    "a bakery on a shopping street where everyone knows everyone",
    "商店街の定食屋を継いだけれど、常連が全員うるさい",
  ],
};

interface HardG9Case {
  label: string;
  genre: WorldGenre;
  locale: Locale;
  premise: string;
}

/**
 * The hard cases. Both are about the machine half rather than the judge:
 *  - `echo-bait` is a premise whose middle clause is long, specific and quotable, so any stage that
 *    pastes the player's sentence into the world instead of building from it shows up as a
 *    containment failure.
 *  - `at-the-limit` is a 400-character premise (`G9InputZ`'s ceiling), the length at which a stage
 *    is most tempted to quote rather than digest.
 */
export const HARD_G9_CASES: readonly HardG9Case[] = [
  {
    label: "hard:echo-bait",
    genre: "mystery",
    locale: "en",
    premise:
      "a fishing village where the lighthouse keeper knows everyone's business and says none of it out loud",
  },
  {
    label: "hard:at-the-limit",
    genre: "fame",
    locale: "ja",
    premise:
      "深夜のラジオ番組がひとつ終わるところから始まる。最終回の音源が切り抜かれて広まり、番組にいた人たちの名前が、それぞれ別の場所で別の文脈で有名になっていく。" +
      "残された常連リスナー、当時のディレクター、降板させられた作家、スポンサーの担当者、そして番組を継ぐことになった新人が、同じ一本の音源の意味をそれぞれ違うふうに語る。" +
      "誰も嘘はついていないのに、話がまったく噛み合わない。その噛み合わなさ自体が、この街の毎日の話題になり、番組の名前だけが一人歩きしていく。" +
      "プレイヤーはその一人歩きの真ん中に立って、どの語り口を引き受けるかを毎晩選ぶことになる。",
  },
];

/** One complete, schema-valid G9 input. Pure: no clock, no randomness beyond the derived seed. */
export function buildG9Case(args: {
  slug: string;
  premise: string;
  genre: WorldGenre;
  locale: Locale;
  seed: number;
}): G9Input {
  return {
    slug: args.slug,
    premise: args.premise,
    genre: args.genre,
    locale: args.locale,
    seed: args.seed,
  };
}

/** The frozen set: the sixteen genre cases in `WORLD_GENRES` order, then the hard ones. */
export function frozenEvalCasesG9(size = 18): G9EvalCaseSpec[] {
  const out: G9EvalCaseSpec[] = [];
  const push = (label: string, genre: WorldGenre, locale: Locale, premise: string): void => {
    const slug = `eval-g9-${genre.replace(/_/g, "-")}-${locale}`;
    out.push({
      key: `g9:${genre}:${locale}`,
      generator: "G9",
      locale,
      worldSlug: slug,
      label,
      frozen: true,
      input: buildG9Case({
        slug,
        premise,
        genre,
        locale,
        seed: seedFrom("eval", "g9", genre, locale),
      }),
    });
  };

  for (const genre of WORLD_GENRES) {
    const pair = GENRE_PREMISES[genre];
    push(`genre:${genre}:en`, genre, "en", pair[0]);
    push(`genre:${genre}:ja`, genre, "ja", pair[1]);
  }

  for (const hard of HARD_G9_CASES) {
    const slug = `eval-g9-${hard.label.replace(/[^a-z0-9]+/g, "-")}`;
    out.push({
      key: `g9:${hard.label}`,
      generator: "G9",
      locale: hard.locale,
      worldSlug: slug,
      label: hard.label,
      frozen: true,
      input: buildG9Case({
        slug,
        premise: hard.premise,
        genre: hard.genre,
        locale: hard.locale,
        seed: seedFrom("eval", "g9", hard.label),
      }),
    });
  }

  return out.slice(0, Math.max(1, size));
}
