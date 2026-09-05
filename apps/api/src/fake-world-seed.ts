/**
 * ⚠️ STAND-IN G9 OUTPUT — not content, scaffolding.
 *
 * `packages/llm` is adding the real `gateway.g9()` in parallel. Until it lands (and afterwards,
 * whenever `@rpgllm/llm` cannot be loaded at all) `fake-gateway.ts` answers `g9` with this: a
 * deterministic `WorldSeed` that actually satisfies `WorldSeedZ` **and** the 4,096-token bible floor
 * in both locales, so every World Studio path — build, validate, seed, play, publish — is exercised
 * end to end today rather than mocked.
 *
 * Everything here is derived from the (slug, premise, genre, seed) tuple, so the same request always
 * produces the same world; nothing is random at run time.
 */
import { LOCALES, WORLD_STUDIO, type Locale, type WorldGenre, type WorldSeed } from "@rpgllm/shared";
import { seededRandom } from "./services/rng";

/** The premise is user text. It is echoed into generated prose, so it arrives declawed. */
export function tamePremise(premise: string): string {
  return premise
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/[<>{}[\]`|\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

interface Role {
  handle: string;
  role: string;
  en: string;
  ja: string;
  press?: boolean;
  first?: boolean;
}

const ROLES: readonly Role[] = [
  { handle: "bestie", role: "the best friend", en: "The bestie", ja: "親友", first: true },
  { handle: "rival", role: "the rival", en: "The rival", ja: "ライバル" },
  { handle: "thepress", role: "press account", en: "The press account", ja: "情報アカウント", press: true },
  { handle: "mentor", role: "the mentor", en: "The mentor", ja: "師匠" },
  { handle: "rookie", role: "the newcomer", en: "The newcomer", ja: "新人" },
  { handle: "chaos", role: "the chaos agent", en: "The chaos agent", ja: "厄介者" },
  { handle: "suit", role: "the management", en: "The management", ja: "運営" },
  { handle: "loyal", role: "the number-one fan", en: "The number-one fan", ja: "一番のファン" },
];

const GENRE_EN: Record<WorldGenre, string> = {
  fame: "fame and the price of being looked at",
  academy: "an academy where rank is public",
  idol: "an idol group with one debut slot",
  office: "an office where every memo leaks",
  sports: "a squad one match from everything",
  fantasy: "a kingdom that runs on rumour",
  mystery: "a town where nobody answers straight",
  slice_of_life: "an ordinary street, extraordinary people",
};

const GENRE_JA: Record<WorldGenre, string> = {
  fame: "名声と、見られることの代償",
  academy: "順位が公開される学園",
  idol: "デビュー枠がひとつだけのアイドル",
  office: "すべての社内文書が漏れる会社",
  sports: "次の一戦にすべてが懸かるチーム",
  fantasy: "噂で動く王国",
  mystery: "誰もまっすぐ答えない町",
  slice_of_life: "ありふれた通りの、ありふれない人々",
};

/**
 * The bible has to clear `WORLD_STUDIO.MIN_BIBLE_TOKENS` under the real estimator (EN ≈ chars/4,
 * JA ≈ chars/1.7), which is what makes it usable as a cached prompt prefix. These sections are
 * repeated until it does, with the round number in the text so no two paragraphs are identical.
 */
function bibleFor(locale: Locale, title: string, premise: string, genre: WorldGenre): string {
  const ja = locale === "ja";
  const head = ja
    ? [
      `# ${title} — ワールドバイブル`,
      "",
      `## 前提`,
      `この世界は次の一行から生まれた:「${premise}」`,
      `テーマは${GENRE_JA[genre]}。すべては公開され、すべてがスクリーンショットされ、いちばん速い意見が勝つ。`,
      "",
      "## トーン",
      "軽快で、ネットに毒されていて、しかし決して残酷ではない。差別語なし、性的描写なし、自傷の手順なし。",
      "キャラクターは第四の壁を破らず、自分がAIであることに言及しない。13歳以上向けの基準を常に守る。",
      "",
      "## 世界のルール",
      "1. 投稿は事件である。必ず誰かが反応する。",
      "2. 数字(いいね・リポスト)は演出であり、キャラクターは口に出さない。",
      "3. 情報アカウントは本当にニュースがあるときだけ投稿する。",
      "4. 関係は積み重なる。昨日の一言は今日の態度に残る。",
      "",
    ].join("\n")
    : [
      `# ${title} — World Bible`,
      "",
      "## Premise",
      `This world grew out of one line: "${premise}"`,
      `Its subject is ${GENRE_EN[genre]}. Everything is public, everything gets screenshotted, and the fastest opinion usually wins.`,
      "",
      "## Tone",
      "Playful, chronically online, never cruel. No slurs, no sexual content, no self-harm instructions.",
      "Characters never break the fourth wall and never mention being an AI. The 13+ bar holds everywhere.",
      "",
      "## Rules of the world",
      "1. A post is an event. Someone always reacts.",
      "2. Numbers (likes, reposts) are theatre and are never mentioned by characters.",
      "3. The press account only posts when something is genuinely newsworthy.",
      "4. Relationships accumulate: a line from yesterday shows up as an attitude today.",
      "",
    ].join("\n");

  const sections: string[] = [head];
  const target = ja ? 12_000 : 20_000;
  let round = 0;
  while (sections.join("\n").length < target) {
    round += 1;
    for (const r of ROLES) {
      sections.push(
        ja
          ? [
            `## ${r.ja}(@${r.handle}) — 場面 ${round}`,
            `役割: ${r.role}。この世界では${GENRE_JA[genre]}という主題を、${r.ja}の立場から引き受ける。`,
            `声: 短い文。断定と保留を交互に使う。相手の名前を呼ぶより、状況を名指しする。絵文字は多くて一つ。`,
            `関係: 主人公が伸びると距離を測り直す。裏切りではなく、位置取りとして。第 ${round} 段階では前より一歩近い。`,
            `禁止: 実在の人物への言及、性的な話題、自傷や暴力の具体、他キャラの口調の模倣。`,
            `典型的な一言: 「それ、今夜の空気を全部持っていくやつだ。」`,
            "",
          ].join("\n")
          : [
            `## ${r.en} (@${r.handle}) — beat ${round}`,
            `Role: ${r.role}. Carries the world's subject — ${GENRE_EN[genre]} — from this angle and no other.`,
            `Voice: short sentences, alternating certainty and hedge. Names the situation more often than the person. At most one emoji.`,
            `Relationships: re-measures the distance whenever the player grows. Not betrayal, positioning. By beat ${round} they stand a step closer than before.`,
            `Never: real people, sexual content, specifics of self-harm or violence, imitating another character's cadence.`,
            `Typical line: "that's going to take the whole night with it."`,
            "",
          ].join("\n"),
      );
    }
  }
  return sections.join("\n");
}

const enLines = (r: Role): string[] => [
  `${r.en.toLowerCase()} here. noted.`,
  "hm. bold.",
  "we'll see how that lands.",
  "screaming, respectfully",
  "okay that's actually good",
  "the timeline is going to have a night",
];

const jaLines = (r: Role): string[] => [
  `${r.ja}だ。記録した。`,
  "ふーん、強気だな。",
  "どう転ぶか見せてもらう。",
  "叫んでる、敬意を込めて",
  "いや、それは普通に良い",
  "今夜のタイムラインは荒れる",
];

const bi = (en: string, ja: string): Record<Locale, string> => ({ en, ja });

export interface StandInSeedInput {
  slug: string;
  premise: string;
  genre: WorldGenre;
  locale: Locale;
  seed: number;
}

export function buildStandInWorldSeed(input: StandInSeedInput): WorldSeed {
  const premise = tamePremise(input.premise);
  const rnd = seededRandom(input.seed || 1);
  const titleEn = premise.split(/[,.;:]/)[0]?.slice(0, 48).trim() || "A brand new world";
  const titleJa = `${titleEn}(仮題)`;
  const difficulty = 1 + Math.floor(rnd() * 3);

  const cast: WorldSeed["cast"] = ROLES.map((r) => ({
    handle: r.handle,
    displayName: input.locale === "ja" ? r.ja : r.en,
    role: r.role,
    isPressAccount: r.press ?? false,
    canBeFirstFollower: r.first ?? !r.press,
    avatarKey: `stand-in/${r.handle}`,
    card: bi(
      `${r.en}. ${r.role}. Speaks in short lines, one emoji at most, never about real people.`,
      `${r.ja}。${r.role}。短い文で話し、絵文字は多くて一つ。実在の人物には触れない。`,
    ),
    intro: bi(`${r.en} has entered the timeline.`, `${r.ja}がタイムラインに現れた。`),
  }));

  const presetPersonas = Array.from({ length: WORLD_STUDIO.PRESET_PERSONAS }, (_v, i) => ({
    handle: `guest${i + 1}`,
    displayName: bi(`Guest ${i + 1}`, `ゲスト${i + 1}`),
    bio: bi("just here to watch it happen", "見届けに来ただけ"),
    avatarKey: `stand-in/guest${i + 1}`,
  }));

  const presetEvents = Array.from({ length: WORLD_STUDIO.PRESET_EVENTS }, (_v, i) => ({
    title: bi(`The ${i + 1}th night`, `${i + 1}日目の夜`),
    prompt: bi(
      `Something in ${titleEn} moved while you weren't looking. What do you do?`,
      `${titleJa}で、見ていない間に何かが動いた。どうする?`,
    ),
    choices: [
      { label: bi("Say it out loud", "はっきり言う"), outcomeText: bi("The timeline turned its head.", "タイムラインが一斉に振り向いた。"), statDeltas: { followers: 6, aura: 3, humor: 0 } },
      { label: bi("Show the receipts", "証拠を出す"), outcomeText: bi("Boring, dated, devastating.", "地味で、日付入りで、致命的だった。"), statDeltas: { followers: 4, aura: 5, humor: 1 } },
      { label: bi("Say nothing", "何も言わない"), outcomeText: bi("Silence did the work.", "沈黙が仕事をした。"), statDeltas: { followers: 2, aura: 2, humor: 2 } },
    ] as WorldSeed["presetEvents"][number]["choices"],
  }));

  const fallbackReplies: WorldSeed["fallbackReplies"] = {};
  const welcomePosts: WorldSeed["welcomePosts"] = {};
  for (const r of ROLES) {
    fallbackReplies[r.handle] = { en: enLines(r).slice(0, 5), ja: jaLines(r).slice(0, 5) };
    welcomePosts[r.handle] = bi(
      `welcome to ${titleEn}. keep up.`,
      `${titleJa}へようこそ。ついてきて。`,
    );
  }

  const ambientPool = Object.fromEntries(
    LOCALES.map((locale) => [
      locale,
      Array.from({ length: WORLD_STUDIO.AMBIENT_PER_LOCALE }, (_v, i) => {
        const r = ROLES[i % ROLES.length] as Role;
        const pool = locale === "ja" ? jaLines(r) : enLines(r);
        return { handle: r.handle, text: `${pool[i % pool.length] ?? "..."} (${i + 1})`.slice(0, 280) };
      }),
    ]),
  ) as WorldSeed["ambientPool"];

  return {
    slug: input.slug,
    difficulty,
    title: bi(titleEn, titleJa),
    scenario: bi(premise, premise),
    bible: {
      en: bibleFor("en", titleEn, premise, input.genre),
      ja: bibleFor("ja", titleJa, premise, input.genre),
    },
    cast,
    presetPersonas,
    presetEvents,
    fallbackReplies,
    ambientPool,
    welcomePosts,
  };
}
