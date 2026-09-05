import { LOCALES, WORLD_STUDIO, type Locale } from "@rpgllm/shared";
import { bareHandle } from "../../handles.js";
import { fnv1a, pick } from "../../tokens.js";
import { OPEN_ARCHETYPES, PRESS_ARCHETYPE, archetypeByKey, type Archetype } from "./archetypes.js";
import { sanitizePremise } from "./screen.js";
import type {
  G9CastEventsOutput,
  G9Concept,
  G9ConceptCast,
  G9Input,
  G9TextureOutput,
} from "./types.js";
import { NAME_POOLS, fill, packFor, type FillContext, type GenrePack } from "./vocab.js";

/**
 * G9 — the deterministic blueprint (AIF-003).
 *
 * Every stage of the studio has a fallback, and in `LLM_MODE=replay` every stage *is* its
 * fallback. Rather than five unrelated stubs, all of them are slices of one blueprint: a complete
 * world derived from `(slug, premise, genre, seed)` by pure functions with no clock, no random and
 * no network. Same input -> byte-identical world; a different `seed` -> a different world.
 *
 * The important property is that the blueprint is parameterised by the **concept**, not by the
 * premise. When the model writes the concept, the deterministic prose, cards, events and texture
 * are built from the model's own handles, places and factions, so a world that falls back halfway
 * through is still internally consistent — not a template world wearing a generated name.
 */

/* ------------------------------------------------------------- primitives ---- */

/** Deterministic Fisher-Yates. Same parts -> same permutation, on any platform. */
export function shuffled<T>(pool: readonly T[], ...parts: Array<string | number>): T[] {
  const out = [...pool];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = fnv1a([...parts, "shuffle", i].join("|")) % (i + 1);
    const a = out[i];
    const b = out[j];
    if (a !== undefined && b !== undefined) {
      out[i] = b;
      out[j] = a;
    }
  }
  return out;
}

function cap(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

/**
 * Function words a world should never be named after. The list is generous on purpose: the first
 * surviving word becomes part of the title, and "Every Guild" is a worse name than "Contract
 * Guild" even though "every" came first in the premise.
 */
const EN_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "in", "on", "at", "to", "for", "with", "from",
  "who", "that", "this", "these", "those", "is", "are", "was", "were", "be", "been", "being",
  "it", "its", "you", "your", "my", "our", "their", "his", "her", "hers", "they", "them", "we",
  "us", "as", "by", "into", "about", "over", "under", "after", "before", "between", "through",
  "during", "without", "within", "against", "around", "because", "while", "until", "since",
  "where", "when", "what", "which", "how", "why", "there", "here", "then", "than", "not", "no",
  "yes", "very", "just", "only", "also", "still", "even", "more", "less", "much", "many", "most",
  "some", "any", "every", "each", "both", "few", "own", "same", "such", "other", "another",
  "will", "can", "must", "should", "would", "could", "have", "has", "had", "does", "did", "doing",
  "always", "never", "often", "sometimes", "everyone", "everything", "someone", "something",
  "nobody", "nothing", "anyone", "anything", "people", "person", "thing", "things", "one", "all",
  "world", "worlds", "story", "stories", "game", "games", "place", "places", "keep", "keeps",
  "kept", "make", "makes", "made", "take", "takes", "took", "get", "gets", "got", "become",
  "becomes", "turn", "turns", "goes", "going", "want", "wants", "know", "knows", "like", "likes",
  "everybody", "nobody", "somebody", "really", "actually", "maybe",
]);

const LATIN_WORD_RE = /[a-z][a-z0-9']{2,}/g;
// Kanji or katakana runs only: a run that includes hiragana is usually a clause, not a name,
// and slicing one produces half a word ("閉店寸前の喫" out of "閉店寸前の喫茶店").
const CJK_RUN_RE = /[\u4e00-\u9fff]{2,5}|[\u30a1-\u30fa\u30fc]{2,8}/g;

/**
 * Words drawn out of the player's premise, for naming things.
 *
 * The premise itself never travels: it is sanitised, split, filtered and only individual short
 * words survive. A whole clause can never reach a place where it could read as an instruction.
 */
export function premiseKeywords(premise: string): { en: string[]; ja: string[] } {
  const clean = sanitizePremise(premise).toLowerCase();
  const en = [...new Set(clean.match(LATIN_WORD_RE) ?? [])]
    .filter((w) => !EN_STOPWORDS.has(w) && w.length <= 14)
    .slice(0, 6);
  const ja = [...new Set(sanitizePremise(premise).match(CJK_RUN_RE) ?? [])].slice(0, 6);
  return { en, ja };
}

/** Slug words are always safe ASCII (apps/api assigns a sanitized kebab-case slug). */
function slugWords(slug: string): string[] {
  return slug
    .split(/[^a-z0-9]+/i)
    .filter((w) => w.length >= 3 && !EN_STOPWORDS.has(w.toLowerCase()))
    .map((w) => w.toLowerCase());
}

/**
 * The one or two words a generated world is named after.
 *
 * Candidates come from the premise first and the (always-ASCII) slug second, and anything that
 * would collide with the genre's own title word is skipped — "Guild Guild" is not a world name.
 */
export function nameWords(base: G9Input): { en: string; ja: string; second: string } {
  const pack = packFor(base.genre);
  const taken = new Set([
    pack.titleWord.en.toLowerCase(),
    base.genre.toLowerCase(),
    ...base.genre.split("_"),
  ]);
  const kw = premiseKeywords(base.premise);
  const candidates = [...kw.en, ...slugWords(base.slug)].filter((w) => !taken.has(w));
  const en = cap(candidates[0] ?? "New");
  const second = cap(candidates[1] ?? candidates[0] ?? "Season");
  const ja = kw.ja.find((w) => !taken.has(w.toLowerCase())) ?? en;
  return { en, ja, second };
}

/* ----------------------------------------------------------- fill context ---- */

/** Everything a template may reference, for one locale of one world. */
export function contextFor(
  concept: G9Concept,
  pack: GenrePack,
  locale: Locale,
  self?: G9ConceptCast,
): FillContext {
  const w = pack.words[locale];
  const press = concept.cast.find((c) => c.isPressAccount) ?? concept.cast[0];
  const others = concept.cast.filter((c) => c.handle !== self?.handle && !c.isPressAccount);
  const other = others[pick(Math.max(others.length, 1), concept.title.en, self?.handle ?? "world")];
  const ctx: Record<string, string> = {
    ...w,
    title: concept.title[locale],
    platform: concept.platform.name,
    press: `@${press?.handle ?? pack.pressHandle}`,
    self: `@${self?.handle ?? concept.cast[0]?.handle ?? "unknown"}`,
    other: `@${other?.handle ?? concept.cast[0]?.handle ?? "unknown"}`,
  };
  // Sentence-initial aliases: `{Crowd}` for "{crowd}" so a template can start a sentence with a
  // noun that is lowercase in the middle of one. English only — Japanese has no letter case.
  for (const [key, value] of Object.entries(w)) {
    ctx[key.charAt(0).toUpperCase() + key.slice(1)] =
      value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
  }
  concept.places.forEach((p, i) => {
    ctx[`place${i + 1}`] = p.name[locale];
  });
  concept.factions.forEach((f, i) => {
    ctx[`faction${i + 1}`] = f.name[locale];
  });
  // Guarantee place1..4 / faction1..3 always resolve, even for a short model-authored concept.
  for (let i = concept.places.length; i < 4; i += 1) {
    ctx[`place${i + 1}`] = concept.places[i % Math.max(concept.places.length, 1)]?.name[locale] ?? w.room;
  }
  for (let i = concept.factions.length; i < 3; i += 1) {
    ctx[`faction${i + 1}`] =
      concept.factions[i % Math.max(concept.factions.length, 1)]?.name[locale] ?? w.crowd;
  }
  return ctx;
}

/* ------------------------------------------------------- G9a — the concept ---- */

/**
 * Scenario shapes. Note what is *not* here: a slot for a word lifted out of the premise.
 * Splicing a raw premise word into a sentence produces "a contract about Contract" as often as it
 * produces something good, so the premise's fingerprint is carried where a bare noun reads
 * naturally — the title, the roster, the chosen shape, the chosen events — and every sentence in
 * the world stays grammatical.
 */
const SCENARIO_SHAPES: ReadonlyArray<Record<Locale, string>> = [
  {
    en: `{Craft} that should have stayed small went further than anyone planned. Now {boss}, {crowd} and {rival} each want a different version of you.`,
    ja: `小さく終わるはずだった{craft}が、誰の計画も超えて広がった。今は{boss}も{crowd}も{rival}も、それぞれ違うあなたを求めている。`,
  },
  {
    en: `Everyone in {world} has already decided what happened. You were the only one actually there, and nobody has asked you yet.`,
    ja: `{world}の全員が、何があったかをもう決めている。実際にその場にいたのはあなただけで、まだ誰も訊きに来ない。`,
  },
  {
    en: `You arrived late and without a plan, and {board} noticed anyway. That was the one thing you did not want this week.`,
    ja: `遅れて、計画もなく来た。それでも{board}は気づいた。今週いちばん避けたかったことだ。`,
  },
];

const TONE_SHAPES: ReadonlyArray<Record<Locale, string>> = [
  {
    en: `Exhilarating, exhausting, funny and slightly cruel. Success and humiliation arrive in the same hour.`,
    ja: `高揚し、消耗し、笑えて、少しだけ残酷。成功と羞恥は同じ1時間の中に来る。`,
  },
  {
    en: `Warm on the surface, load-bearing underneath. Everyone is kind and everyone is keeping score.`,
    ja: `表面は温かく、下は荷重がかかっている。全員が優しく、全員が点数をつけている。`,
  },
  {
    en: `Fast, funny and a little paranoid. Nothing here is private for longer than a day.`,
    ja: `速く、可笑しく、少し疑り深い。ここで private なものは一日も持たない。`,
  },
];

/**
 * The deterministic concept: the world G9a would have written, built from the genre pack and two
 * words lifted out of the premise. This is what `LLM_MODE=replay` returns and what the live
 * concept stage falls back to.
 */
export function deterministicConcept(base: G9Input): G9Concept {
  const pack = packFor(base.genre);
  const names = nameWords(base);
  const seedKey = `${base.slug}|${base.genre}|${base.seed}`;

  const archetypes: Archetype[] = [
    ...shuffled(OPEN_ARCHETYPES, seedKey, "arch").slice(0, 7),
  ];
  // Press sits second so `cast[0]` is always a legal first-follower (SCR-006 picks the first).
  const roster: Archetype[] = [archetypes[0]!, PRESS_ARCHETYPE, ...archetypes.slice(1)];

  const handlePool = shuffled(
    pack.handles.filter((h) => h !== pack.pressHandle),
    seedKey,
    "handles",
  );
  const namePool = shuffled(NAME_POOLS[pack.names], seedKey, "names");

  let openIndex = 0;
  const cast: G9ConceptCast[] = roster.map((a, i) => {
    const handle = a.isPressAccount ? pack.pressHandle : (handlePool[openIndex++] ?? `${pack.pressHandle}${i}`);
    const displayName = a.isPressAccount
      ? `The ${names.en} Wire`
      : (namePool[i] ?? `Account ${i + 1}`);
    const enWords = pack.words.en;
    return {
      handle: bareHandle(handle),
      displayName,
      role: fill(a.role, { ...enWords }),
      archetype: a.key,
      avatarKey: `${base.genre}-${bareHandle(handle)}`,
      isPressAccount: a.isPressAccount,
      canBeFirstFollower: a.canBeFirstFollower,
      intro: { en: a.intro.en, ja: a.intro.ja },
    };
  });

  const shape = SCENARIO_SHAPES[pick(SCENARIO_SHAPES.length, seedKey, "scenario")] ?? SCENARIO_SHAPES[0]!;
  const tone = TONE_SHAPES[pick(TONE_SHAPES.length, seedKey, "tone")] ?? TONE_SHAPES[0]!;

  const concept: G9Concept = {
    title: {
      en: `${names.en} ${pack.titleWord.en}`,
      ja: `${names.ja}・${pack.titleWord.ja}`,
    },
    scenario: { en: "", ja: "" },
    difficulty: 1 + pick(3, seedKey, "difficulty"),
    tone,
    platform: { name: pack.platformName, conceit: pack.conceit },
    setting: pack.setting,
    places: pack.places.map((p) => ({ name: p.name, note: p.note })),
    factions: pack.factions.map((f) => ({ name: f.name, blurb: f.blurb })),
    slang: pack.slang.map((s) => ({ term: s.term, gloss: s.gloss })),
    cast,
  };

  for (const locale of LOCALES) {
    concept.scenario[locale] = fill(shape[locale], contextFor(concept, pack, locale));
  }
  // The intros are archetype templates; fill them now that the roster exists.
  for (const member of concept.cast) {
    const a = archetypeByKey(member.archetype);
    if (a === undefined) continue;
    for (const locale of LOCALES) {
      member.intro[locale] = fill(a.intro[locale], contextFor(concept, pack, locale, member));
    }
  }
  return concept;
}

/* --------------------------------------------------------- G9b — the bible ---- */

const TONE_RULES: Readonly<Record<Locale, readonly string[]>> = {
  en: [
    `Nothing here is truly private. Every message, agreement and closed-door conversation in {room} eventually surfaces, usually in the worst available week.`,
    `{Crowd} is not background. They organise, they read frame by frame, they are often right, and they are occasionally frightening.`,
    `Success and humiliation arrive in the same hour. Something can travel because it is being mocked, and {metric} still count it.`,
    `Kindness exists but it is expensive. Anyone who is warm to the player in public is spending their own credit to do it, and knows it.`,
    `Nobody here is evil. Everyone is protecting something: a position, a friendship, a wage, or a version of themselves from four years ago.`,
    `{Boss} is neither villain nor ally. It is weather with a budget. It will open every door and close them at the same speed.`,
    `A quiet post that lands is worth more than a loud one that does not. This world rewards specificity and punishes performance.`,
  ],
  ja: [
    `ここに本当の意味で private なものはない。{room}でのやり取り、約束、閉じた場の会話は、いずれ必ず表に出る。しかもたいてい最悪の週に出る。`,
    `{crowd}は背景ではない。組織し、コマ送りで読み、たいてい正しく、時々こわい。`,
    `成功と羞恥は同じ1時間の中に来る。馬鹿にされて広がることもあるし、{metric}はそれも数える。`,
    `優しさは存在するが高い。人前でプレイヤーに優しくする人間は、自分の信用を払っている。そしてそれを自覚している。`,
    `悪人はいない。全員が何かを守っている。立場、友情、給料、あるいは4年前の自分。`,
    `{boss}は敵でも味方でもない。予算を持った天気だ。どの扉も開けるし、同じ速さで閉める。`,
    `静かで的を射た投稿は、うるさくて外した投稿より価値がある。この世界は具体性に報い、演技を罰する。`,
  ],
};

const PLATFORM_RULES: Readonly<Record<Locale, string>> = {
  en: `Posts are short. Replies stack underneath them. Quote-posting is how arguments are held, and the verbs people use are post, reply, quote, ratio, sub-post (a vague post obviously about someone), main character (to become the day's topic) and clear (to end someone in one line). There are no images in this simulation: when a character "posts a photo" they describe it in words or react to it. Nobody narrates; everybody posts.`,
  ja: `投稿は短く、返信はその下に積み上がる。口論は引用投稿で行われる。使われる動詞は、投稿する、返信する、引用する、レシオる、匂わせ投稿(明らかに誰かのことを名指しせずに書く)、主人公になる(その日の話題を独占する)、消す(一行で終わらせる)。このシミュレーションに画像はない。キャラが「写真を上げた」ときは、言葉で描写するか、反応として書く。地の文は存在しない。全員が投稿する。`,
};

const DAY_SHAPE: Readonly<Record<Locale, string>> = {
  en: `## WHAT A DAY LOOKS LIKE
Mornings are quiet and slightly hungover. The middle of the day belongs to {boss} and to whatever
{board} said overnight. Everything that matters happens between 11pm and 3am, in {room} and in
replies nobody expected to still be reading. By the time {press} writes it up it is already the
second version of the story.`,
  ja: `## 一日の形
朝は静かで、少し二日酔い。日中は{boss}のものであり、夜のあいだに{board}が言ったことのもの。
本当に重要なことは、23時から3時のあいだに、{room}と、誰も読み続けているとは思わなかった返信欄で
起きる。{press}が記事にする頃には、それはもう二番目のバージョンだ。`,
};

const TALK: Readonly<Record<Locale, string>> = {
  en: `## HOW PEOPLE TALK HERE
Lowercase is the default and punctuation is optional. Posts are short because attention is short:
twenty to a hundred and twenty characters is the sweet spot, and anything past two hundred reads
as a defence statement. Nobody explains a joke. Nobody says "so proud of you" — the compliment
that lands is the one that quotes a specific word back.

Replies arrive mid-thought. People have their own week going on: they are tired, they are annoyed
at someone else, they misread the room, they answer the second half of your post and ignore the
first. Two accounts under the same post should be aware of each other, and they should be allowed
to start something.

Emoji are punctuation, not decoration — at most two, usually zero. Hashtags belong to exactly the
kind of person who uses hashtags, and there are one or two of those here at most.`,
  ja: `## ここでの喋り方
基本は小文字・句読点なし。注意力が短いので投稿も短い。10〜60文字が心地よく、100文字を
超えると弁明に見える。冗談は説明しない。「応援してます」は書かない。効くのは、相手の
言葉から具体的な一語を拾い直した一文だけ。

返信は話の途中から来る。全員にそれぞれの一週間があって、疲れていて、別の誰かに苛ついていて、
たまに読み違え、投稿の後半にだけ答えて前半を無視する。同じ投稿に返す2人は互いを意識してよく、
そこから揉めてよい。

絵文字は装飾ではなく句読点。多くて2個、普通は0個。ハッシュタグを使うのは、ハッシュタグを
使う型の人間だけで、この世界にそういう人間は1人か2人しかいない。`,
};

const REWARDS: Readonly<Record<Locale, string>> = {
  en: `## WHAT THIS WORLD REWARDS AND PUNISHES
Rewarded: a real detail, a real opinion, an admission that costs something, a joke that is not
about being clever, protecting someone who cannot protect themselves, and showing what it
actually takes to {make}.

Punished: vagueness, gratitude posts, corporate phrasing, explaining yourself twice, chasing
{crowd}'s approval where they can see you chasing it, and pretending {boss} is not in the room.

Neither: silence. This world reads silence as a move, and it can be the strongest one available or
the beginning of a slow disappearance. It depends entirely on what happened the day before.`,
  ja: `## この世界が報いるもの、罰するもの
報いる: 本物の細部、本物の意見、代償を払う告白、賢さのためではない冗談、自分を守れない誰かを
庇うこと、そして{make}ことの、見栄えのしない側を見せること。

罰する: 曖昧さ、感謝の投稿、企業語、二度目の弁明、{crowd}の承認を、追っているのが見える形で
追うこと、そして{boss}がその場にいないふりをすること。

どちらでもない: 沈黙。この世界は沈黙を手として読む。使える中で最強の手にもなるし、
ゆっくり消えていく始まりにもなる。前の日に何があったかで全部変わる。`,
};

const FIRST_WEEK: Readonly<Record<Locale, string>> = {
  en: `# THE FIRST WEEK
A new player has no history, so the world has to hand them one. In the first few exchanges:
- Exactly one account should be unreasonably early to believe in them, and it should cost that
  account something visible.
- Exactly one account should withhold. Not hostile — busy, or unconvinced, or waiting to see the
  second thing rather than the first.
- {press} should notice on day one and write about it as a development rather than a welcome.
- Nobody should explain the world to the player. They learn {board} exists by being on it.
- The first real decision should arrive before the player feels ready, because that is the shape
  of {world} and pretending otherwise wastes the week.`,
  ja: `# 最初の一週間
新しいプレイヤーには履歴がないので、世界の側が履歴を渡す。最初の数往復で:
- ちょうど1アカウントが、不合理なほど早く信じること。そしてそれが、その人にとって
  目に見える出費であること。
- ちょうど1アカウントが、留保すること。敵意ではない。忙しいか、納得していないか、
  1つ目ではなく2つ目を見てから決めようとしているか。
- {press}は初日に気づき、歓迎ではなく「動き」として書くこと。
- 誰もプレイヤーに世界の説明をしないこと。{board}の存在は、そこに載って初めて知る。
- 最初の本当の決断は、プレイヤーの準備が整う前に来ること。それが{world}の形であって、
  違うふりをするとその一週間が無駄になる。`,
};

export function renderProse(concept: G9Concept, genre: G9Input["genre"], locale: Locale): string {
  const pack = packFor(genre);
  const ctx = contextFor(concept, pack, locale);
  const f = (t: string): string => fill(t, ctx);
  const head = locale === "ja" ? "# 世界設定" : "# WORLD";
  const platformHead = locale === "ja" ? "## プラットフォーム" : "## THE PLATFORM";
  const geoHead = locale === "ja" ? "## 地理" : "## GEOGRAPHY";
  const toneHead = locale === "ja" ? "## トーンのルール" : "## TONE RULES";
  const slangHead =
    locale === "ja"
      ? "## スラング — 自然に使う。一度に全部使わない"
      : "## SLANG GLOSSARY — use naturally, never all at once";
  const factionHead = locale === "ja" ? "## 勢力" : "## FACTIONS";

  return [
    `${head} — ${concept.title[locale].toUpperCase()}`,
    "",
    f(concept.setting[locale]),
    "",
    f(concept.tone[locale]),
    "",
    platformHead,
    f(concept.platform.conceit[locale]),
    "",
    f(PLATFORM_RULES[locale]),
    "",
    f(DAY_SHAPE[locale]),
    "",
    geoHead,
    concept.places.map((p) => `- **${p.name[locale]}** — ${f(p.note[locale])}`).join("\n"),
    "",
    toneHead,
    TONE_RULES[locale].map((r) => `- ${f(r)}`).join("\n"),
    "",
    f(TALK[locale]),
    "",
    f(REWARDS[locale]),
    "",
    slangHead,
    concept.slang.map((s) => `- **${s.term}** — ${f(s.gloss[locale])}`).join("\n"),
    "",
    factionHead,
    concept.factions
      .map((x, i) => `${i + 1}. **${x.name[locale]}** — ${f(x.blurb[locale])}`)
      .join("\n"),
  ].join("\n");
}

const ARCS: Readonly<Record<Locale, readonly string[]>> = {
  en: [
    `**The Sub-Post Spiral.** Someone posts something vague. {faction3} decodes it in four minutes, half correctly. {press} reports the decoding as fact. The original poster now has to answer for a thing they did not say.`,
    `**The Leak.** {item} gets out. Everyone knows who leaked it within a day. The interesting question is never who — it is who benefits.`,
    `**The Credit Fight.** Who actually did the work on {craft} is disputed. One person knows, will not say, and is furious about being asked.`,
    `**The Loyalty Test.** {boss} wants something {crowd} will hate. There is no answer that costs nothing, and everyone is watching which cost the player picks.`,
    `**The Comeback Window.** After a bad week there are roughly three days in which a good post rewrites the story and a bad one confirms it. Everyone knows the window is open, which makes it worse.`,
    `**The Old Friend Problem.** Somebody from before is not rising at the same speed. Everything the player says about what it takes to {make} sounds different by the time it reaches them.`,
  ],
  ja: [
    `**匂わせの渦。** 誰かが曖昧な投稿をする。{faction3}が4分で解読する。半分は当たっている。{press}がその解読を事実として報じる。書いた本人は、言っていないことに返事をする羽目になる。`,
    `**リーク。** {item}が外に出る。誰が流したかは1日でわかる。面白い問いは「誰が」ではなく「誰が得をするか」。`,
    `**手柄の争い。** {craft}を実際にやったのが誰かで揉める。知っている人間は1人いて、言わないし、訊かれること自体に怒っている。`,
    `**踏み絵。** {boss}が、{crowd}の嫌がることを求めてくる。何も失わない答えは存在しない。プレイヤーがどの代償を選ぶかを全員が見ている。`,
    `**巻き返しの窓。** 悪い一週間のあと、良い投稿が物語を書き換え、悪い投稿がそれを確定させる3日間がある。窓が開いていることを全員が知っているぶん、余計に重い。`,
    `**旧友の問題。** 前からいる誰かが、同じ速度で上がっていない。{make}ことについてプレイヤーが言うことは、その人に届くまでに意味が変わる。`,
  ],
};

const STATS: Readonly<Record<Locale, string>> = {
  en: `# HOW THE NUMBERS MOVE
- **followers**: specificity and risk. A post with a real detail, a real opinion or a real joke
  moves followers up. Vagueness, corporate language and gratitude posts move nothing. Picking a
  fight with someone bigger is the highest-variance play in {world}.
- **aura**: credibility and mystique. Rises when the player says something true, protects someone,
  keeps a secret, or makes a choice that costs them. Falls when they over-explain, chase approval,
  or get caught performing for {crowd}.
- **humor**: timing and self-awareness. Rises with a good joke, a great reply, or landing a bit.
  Falls when the player takes themselves too seriously or explains the joke.
- Small numbers are normal: most posts move things by 1 to 3. Reserve larger swings for real
  escalation around {night} or {board}.`,
  ja: `# 数値の動き方
- **followers**: 具体性とリスク。本物の細部、本物の意見、本物の冗談がある投稿は上がる。
  曖昧さ、企業語、感謝の投稿は動かない。格上に喧嘩を売るのが{world}で最も分散の大きい手。
- **aura**: 信用と佇まい。本当のことを言った、誰かを庇った、秘密を守った、損をする選択をした
  ときに上がる。説明しすぎ、承認を追う、{crowd}向けの演技がバレた、で下がる。
- **humor**: 間と自意識。良い冗談、良い返し、ボケが決まったときに上がる。自分を重く扱いすぎた
  とき、冗談を説明したときに下がる。
- 小さい数字が普通。ほとんどの投稿は1〜3しか動かさない。大きく振れるのは{night}や{board}
  まわりで本当に事態が動いたときだけ。`,
};

export function renderOutro(concept: G9Concept, genre: G9Input["genre"], locale: Locale): string {
  const pack = packFor(genre);
  const ctx = contextFor(concept, pack, locale);
  const f = (t: string): string => fill(t, ctx);
  const press = concept.cast.find((c) => c.isPressAccount)?.handle ?? pack.pressHandle;
  const handles = concept.cast.map((c) => `@${c.handle}`).join(", ");
  const handler = concept.cast.find((c) => c.archetype === "handler")?.handle;

  const pressRules =
    locale === "ja"
      ? `# press アカウントのルール
ニュース投稿を書けるのは @${press} だけ。三人称、絵文字なし、最大2文。必ず情報源のぼかしか
一刺しのどちらかを含む。{crowd}で何が起きたかを報じ、キャラの感情は書かない。
ニュース投稿はプレイヤーに直接呼びかけない。「あなた」を使わない。
良い例:「SOURCES SAY: {item}は公表前から{room}で回っていた。関係者2名によれば、時系列は
本人の説明と合わない。」
悪い例:「今日は大ニュース!おめでとう🎉」`
      : `# PRESS ACCOUNT RULES
Only @${press} posts news. News posts are third person, no emoji, at most two sentences, and always
contain either a sourcing hedge or a jab. They report what {crowd} did, never what a character
felt. A news post never addresses the player directly and never uses "you".
Good: "SOURCES SAY: {item} was circulating in {room} before it was announced. Per two people
familiar, the timeline does not match the version given."
Bad: "Wow, big news for you today!! 🎉"`;

  const arcsHead = locale === "ja" ? "# 典型的なドラマの型" : "# TYPICAL DRAMA ARCS";
  const arcsLead =
    locale === "ja"
      ? "以下の形から取る。1投稿で解決させない。糸は垂らしたままにする。"
      : "Pull from these shapes. Never resolve one in a single post — leave a thread hanging.";
  const outHead = locale === "ja" ? "# この世界の出力ルール" : "# OUTPUT REMINDERS FOR THIS WORLD";

  const reminders =
    locale === "ja"
      ? [
          `ハンドルは正確に次の8つ: ${handles}。9人目は存在しない。`,
          `@${press} が返信するのは、ニュース価値があるか恥ずかしいときだけ。温かい返信は書かない。`,
          handler === undefined ? null : `@${handler} は公開の返信で否定的なことを言わない。`,
          `同じ投稿に2人が返信するとき、2人を同意させない。`,
          `プレイヤーの投稿を代筆しない。プレイヤーの顔を描写しない。心情を地の文で語らない。喋るのはキャラだけ。`,
          `実在の人物・ブランド・作品を持ち込まない。この世界のものだけを使う。`,
        ]
      : [
          `Handles are exactly these eight: ${handles}. There is no ninth account.`,
          `@${press} replies only when a post is newsworthy or embarrassing, and never warmly.`,
          handler === undefined ? null : `@${handler} never says anything negative in a public reply.`,
          `If two characters reply to the same post, they should not agree with each other.`,
          `Never write the player's own posts, never describe the player's face, never narrate their feelings. Only the characters speak.`,
          `Never import a real person, brand or existing work. Everything comes from this world.`,
        ];

  return [
    f(pressRules),
    "",
    arcsHead,
    arcsLead,
    ARCS[locale].map((a, i) => `${i + 1}. ${f(a)}`).join("\n"),
    "",
    f(FIRST_WEEK[locale]),
    "",
    f(STATS[locale]),
    "",
    outHead,
    reminders.filter((r): r is string => r !== null).map((r) => `- ${r}`).join("\n"),
  ].join("\n");
}

/* ---------------------------------------------------------- G9c — the card ---- */

const CARD_LABELS: Readonly<Record<Locale, readonly string[]>> = {
  en: ["Role", "Voice", "Values", "Catchphrases", "NG topics", "Toward the player", "Praise", "Drama"],
  ja: ["役割", "声", "価値観", "口癖", "NG", "プレイヤーへの態度", "褒められたとき", "揉めたとき"],
};

/** One cast card, in one locale. This is what `worlds/build.ts` splices into the bible. */
export function renderCard(
  concept: G9Concept,
  genre: G9Input["genre"],
  member: G9ConceptCast,
  locale: Locale,
): string {
  const pack = packFor(genre);
  const a = archetypeByKey(member.archetype) ?? PRESS_ARCHETYPE;
  const ctx = contextFor(concept, pack, locale, member);
  const parts = [a.roleLine, a.voice, a.values, a.catchphrases, a.ng, a.stance, a.praise, a.drama];
  const labels = CARD_LABELS[locale];
  return parts
    .map((p, i) => `${labels[i] ?? ""}: ${fill(p[locale], ctx)}`)
    .join("\n");
}

export function renderIntro(
  concept: G9Concept,
  genre: G9Input["genre"],
  member: G9ConceptCast,
  locale: Locale,
): string {
  const pack = packFor(genre);
  const a = archetypeByKey(member.archetype) ?? PRESS_ARCHETYPE;
  return fill(a.intro[locale], contextFor(concept, pack, locale, member));
}

/* ------------------------------------------------ G9d — personas and events ---- */

interface PersonaTemplate {
  handle: string;
  displayName: Record<Locale, string>;
  bio: Record<Locale, string>;
}

const PERSONA_TEMPLATES: readonly PersonaTemplate[] = [
  {
    handle: "newhere",
    displayName: { en: "New Here", ja: "新入り" },
    bio: {
      en: `arrived three weeks ago with {item} and opinions. still learning where {board} even is.`,
      ja: `3週間前に{item}と持論だけ持って来た。{board}がどこにあるかもまだ分かっていない。`,
    },
  },
  {
    handle: "second_try",
    displayName: { en: "Second Try", ja: "二度目" },
    bio: {
      en: `did this once before and stopped. back, quieter, and considerably harder to embarrass.`,
      ja: `一度やって辞めた。戻ってきた。前より静かで、かなり恥をかきにくくなった。`,
    },
  },
  {
    handle: "the_quiet1",
    displayName: { en: "The Quiet One", ja: "静かな方" },
    bio: {
      en: `posts twice a week. reads everything. {Crowd} has decided this is a strategy.`,
      ja: `投稿は週2回。全部読んでいる。{crowd}はこれを戦略だと判断した。`,
    },
  },
  {
    handle: "loudmouth",
    displayName: { en: "Loudmouth", ja: "うるさい方" },
    bio: {
      en: `says the thing everyone was thinking, one hour too early, every single time.`,
      ja: `全員が思っていたことを、毎回きっちり1時間早く言う。`,
    },
  },
  {
    handle: "lateshift",
    displayName: { en: "Late Shift", ja: "遅番" },
    bio: {
      en: `in {room} after everyone leaves. all the good posts happen after midnight anyway.`,
      ja: `全員が帰ったあとの{room}にいる。どうせ良い投稿は0時以降にしか出ない。`,
    },
  },
  {
    handle: "nofilter",
    displayName: { en: "No Filter", ja: "無加工" },
    bio: {
      en: `will not workshop a post before sending it. this has gone badly twice and brilliantly once.`,
      ja: `投稿を寝かせるということをしない。2回失敗して1回大当たりした。`,
    },
  },
  {
    handle: "backagain",
    displayName: { en: "Back Again", ja: "出戻り" },
    bio: {
      en: `left {world} for a year. everything changed. nothing changed. mostly here for {crafts}.`,
      ja: `1年{world}を離れていた。全部変わっていた。何も変わっていなかった。目当ては{crafts}。`,
    },
  },
];

interface EventTemplate {
  title: Record<Locale, string>;
  prompt: Record<Locale, string>;
  choices: Array<{
    label: Record<Locale, string>;
    outcomeText: Record<Locale, string>;
    statDeltas: { followers: number; aura: number; humor: number };
  }>;
}

const EVENT_TEMPLATES: readonly EventTemplate[] = [
  {
    title: { en: "The Leak", ja: "リーク" },
    prompt: {
      en: `{Item} is on every feed by lunchtime. It is rough, honest, and better than anything on the plan. {other} wants it taken down. {self} has not said a word.`,
      ja: `{item}が昼前には全フィードに乗っている。粗くて、正直で、計画上のどれより良い。{other}は消したがっている。{self}は何も言っていない。`,
    },
    choices: [
      {
        label: { en: "Post it yourself, unfinished", ja: "未完成のまま自分で出す" },
        outcomeText: {
          en: `You put it up with three words: "it's not done". {Crowd} treats it as a gift, {boss} treats it as a fire, and by evening it is the most-quoted thing you have made.`,
          ja: `「まだ途中」の一言を添えて出した。{crowd}は贈り物として受け取り、{boss}は火事として扱った。夜には、これまでで最も引用されたものになっていた。`,
        },
        statDeltas: { followers: 9, aura: 4, humor: 0 },
      },
      {
        label: { en: "Let {boss} take it down", ja: "{boss}に消させる" },
        outcomeText: {
          en: `The takedown lands in an hour. So does the screenshot of the takedown. It survives anyway, worse, with your name on the wrong side of it.`,
          ja: `削除は1時間で通った。削除通知のスクショも1時間で回った。どのみち生き残った。質だけ落ちて、あなたの名前は間違った側に置かれたまま。`,
        },
        statDeltas: { followers: -3, aura: -4, humor: 0 },
      },
      {
        label: { en: "Say nothing, post a photo of {room}", ja: "何も言わず{room}の写真だけ上げる" },
        outcomeText: {
          en: `No comment, one photo, nothing in focus. {other} quote-posts it and the whole feed decides you are unbothered. You are not unbothered.`,
          ja: `コメントなし、写真1枚、ピントは何にも合っていない。{other}が引用し、フィード全体が「余裕だ」と判断した。余裕ではない。`,
        },
        statDeltas: { followers: 2, aura: 5, humor: 2 },
      },
    ],
  },
  {
    title: { en: "The Seating Chart", ja: "座席表" },
    prompt: {
      en: `The order for {night} leaks. You are two places behind {other} and directly in front of everyone's view. {press} has already written the headline.`,
      ja: `{night}の並び順が漏れた。あなたは{other}の2つ後ろで、全員の視界の真正面。{press}はもう見出しを書いている。`,
    },
    choices: [
      {
        label: { en: "Post it with one dry line", ja: "一行だけ添えて出す" },
        outcomeText: {
          en: `"two places is two places." Quoted four thousand times before the night begins. {other} likes it, which nobody can decode.`,
          ja: `「2つは2つ」。当日を待たずに4千回引用された。{other}がいいねを押した。誰にも解読できない。`,
        },
        statDeltas: { followers: 6, aura: 2, humor: 5 },
      },
      {
        label: { en: "Ask {boss} to fix it", ja: "{boss}に直させる" },
        outcomeText: {
          en: `It gets fixed. The fix is also public, and now everyone knows it mattered to you enough to ask.`,
          ja: `直った。直ったことも公になった。あなたが頼むほど気にしていたと全員に知られた。`,
        },
        statDeltas: { followers: -1, aura: -3, humor: -1 },
      },
      {
        label: { en: "Ignore it completely", ja: "完全に無視する" },
        outcomeText: {
          en: `You post about something else entirely. Half of {crowd} reads it as strength and half reads it as a subpost. Both halves are loud.`,
          ja: `まったく別の話を投稿した。{crowd}の半分は強さと読み、半分は匂わせと読んだ。どちらの半分もうるさい。`,
        },
        statDeltas: { followers: 3, aura: 3, humor: 1 },
      },
    ],
  },
  {
    title: { en: "The Loyalty Test", ja: "踏み絵" },
    prompt: {
      en: `{Boss} wants you to do one thing {crowd} will hate, in exchange for {stage}. {other} has already said yes to the same offer and will not talk about it.`,
      ja: `{boss}が、{crowd}の嫌がることを一つ求めてきた。見返りは{stage}。{other}は同じ話を先に受けていて、その件については話さない。`,
    },
    choices: [
      {
        label: { en: "Take the deal, say so openly", ja: "受ける。そして公言する" },
        outcomeText: {
          en: `You post the whole arrangement before anyone can leak it. {Crowd} is furious and grudgingly impressed. {Boss} is neither.`,
          ja: `漏れる前に取り決めを全部書いた。{crowd}は怒り、しぶしぶ感心した。{boss}はどちらでもない。`,
        },
        statDeltas: { followers: 4, aura: 6, humor: -2 },
      },
      {
        label: { en: "Refuse and lose {stage}", ja: "断って{stage}を失う" },
        outcomeText: {
          en: `The door closes quietly. Nobody reports it, which is worse — the only people who know are the ones who wanted you to say yes.`,
          ja: `扉が静かに閉まった。誰も報じない。その方が悪い。知っているのは「受けろ」と思っていた人間だけ。`,
        },
        statDeltas: { followers: -6, aura: 8, humor: 0 },
      },
      {
        label: { en: "Stall until it decides itself", ja: "決まるまで引き延ばす" },
        outcomeText: {
          en: `You answer nothing for six days. It resolves without you and everyone remembers that it did.`,
          ja: `6日間、何も答えなかった。あなた抜きで話が片づき、片づいたことを全員が覚えている。`,
        },
        statDeltas: { followers: 1, aura: -2, humor: 3 },
      },
    ],
  },
  {
    title: { en: "The Old Friend", ja: "旧友" },
    prompt: {
      en: `{other} is still exactly where you both started, and posted something last night that is obviously about you without saying so. {Crowd} has already decoded it.`,
      ja: `{other}は、二人が始めた場所にそのまま立っている。昨夜、明らかにあなたの話だと分かる投稿をした。名指しはしていない。{crowd}はもう解読した。`,
    },
    choices: [
      {
        label: { en: "Reply in public, warmly", ja: "公開で、温かく返す" },
        outcomeText: {
          en: `You answer the post everyone can see. It is generous and it lands as pity, which is not what you meant and cannot be taken back.`,
          ja: `全員が見える場所で返した。優しい返信で、憐れみとして届いた。そんなつもりはなかったし、取り消せない。`,
        },
        statDeltas: { followers: 5, aura: -3, humor: 0 },
      },
      {
        label: { en: "Message them instead", ja: "個別に連絡する" },
        outcomeText: {
          en: `Nobody sees it. It takes four hours and it works. {Crowd} concludes you ignored them, and you let that stand.`,
          ja: `誰にも見えない。4時間かかって、うまくいった。{crowd}は無視したと結論づけ、あなたはそのままにした。`,
        },
        statDeltas: { followers: -2, aura: 6, humor: 0 },
      },
      {
        label: { en: "Post about {room} instead", ja: "{room}の話をする" },
        outcomeText: {
          en: `You write about where you both came from without naming anyone. It is the kindest available lie and it holds for about a week.`,
          ja: `誰の名前も出さずに、二人が来た場所について書いた。選べる中で一番優しい嘘で、一週間はもった。`,
        },
        statDeltas: { followers: 2, aura: 2, humor: 2 },
      },
    ],
  },
  {
    title: { en: "The Number", ja: "その数字" },
    prompt: {
      en: `{Board} updates overnight and you are one place higher than anybody expected. {press} wants a comment and {other} has stopped replying to you.`,
      ja: `夜のあいだに{board}が更新され、あなたは誰の予想より1つ上にいる。{press}はコメントを求め、{other}は返信をやめた。`,
    },
    choices: [
      {
        label: { en: "Give {press} one sentence", ja: "{press}に一文だけ渡す" },
        outcomeText: {
          en: `You give them eleven words. They run all eleven and build a second story on top of them by evening.`,
          ja: `11語だけ渡した。11語とも使われ、夕方にはその上に第二報が積まれていた。`,
        },
        statDeltas: { followers: 7, aura: 0, humor: 1 },
      },
      {
        label: { en: "Credit {room} and nobody else", ja: "{room}だけに礼を言う" },
        outcomeText: {
          en: `You name the room and not a single person. Everyone in it knows exactly who was meant, and that is the whole point.`,
          ja: `場所の名前だけ出して、人の名前は一つも出さなかった。そこにいた全員が誰のことか分かっていて、それが狙いだった。`,
        },
        statDeltas: { followers: 2, aura: 7, humor: 0 },
      },
      {
        label: { en: "Post the number with no comment", ja: "数字だけ貼る" },
        outcomeText: {
          en: `Just the figure, nothing else. It reads as arrogant to half of {crowd} and as a joke to the other half. The joke half is louder.`,
          ja: `数字だけ、あとは何もなし。{crowd}の半分には傲慢に、もう半分には冗談に読まれた。冗談の側の方が声が大きい。`,
        },
        statDeltas: { followers: 4, aura: -1, humor: 6 },
      },
    ],
  },
  {
    title: { en: "The Invitation", ja: "招待" },
    prompt: {
      en: `{other} invites you into something at {place2} that would put you a full year ahead. The catch is in the third paragraph and {press} already has the first two.`,
      ja: `{other}から{place2}での話に誘われた。乗れば丸一年ぶん先に行ける。落とし穴は3段落目にあり、{press}はすでに最初の2段落を持っている。`,
    },
    choices: [
      {
        label: { en: "Go, and say nothing about it", ja: "行く。何も言わない" },
        outcomeText: {
          en: `You turn up and do the work. The story runs anyway, wrong in one detail, and you decide not to correct it.`,
          ja: `顔を出して、仕事をした。記事はどのみち出た。細部が一つ間違っていて、訂正しないことにした。`,
        },
        statDeltas: { followers: 3, aura: 5, humor: 0 },
      },
      {
        label: { en: "Ask for the third paragraph in writing", ja: "3段落目を書面でもらう" },
        outcomeText: {
          en: `You get it, and it is worse than the rumour. Asking cost you the invitation and saved you the year.`,
          ja: `もらった。噂より悪かった。訊いたせいで招待は消え、一年ぶんの時間が残った。`,
        },
        statDeltas: { followers: -4, aura: 7, humor: 1 },
      },
      {
        label: { en: "Post about it as a joke", ja: "冗談として投稿する" },
        outcomeText: {
          en: `You describe the offer as absurd without naming it. Everyone laughs, {other} does not, and the offer is gone by morning.`,
          ja: `名前を出さずに、話の馬鹿馬鹿しさだけ書いた。全員が笑い、{other}は笑わず、朝には話が消えていた。`,
        },
        statDeltas: { followers: 6, aura: -2, humor: 7 },
      },
    ],
  },
  {
    title: { en: "The Mistake", ja: "失敗" },
    prompt: {
      en: `You got something publicly wrong at {place1}, in front of {crowd}, and the clip is nine seconds long. {other} has not posted it and could.`,
      ja: `{place1}で、{crowd}の前で、公然と間違えた。切り抜きは9秒。{other}はまだ上げていない。上げられる立場にいる。`,
    },
    choices: [
      {
        label: { en: "Post the clip yourself first", ja: "自分で先に上げる" },
        outcomeText: {
          en: `You post it with the time stamp and no excuse. It stops being a story in about four hours, which is a record.`,
          ja: `時刻を添えて、言い訳なしで上げた。4時間で記事にならなくなった。記録的な速さだ。`,
        },
        statDeltas: { followers: 5, aura: 6, humor: 4 },
      },
      {
        label: { en: "Explain what actually happened", ja: "何が起きたか説明する" },
        outcomeText: {
          en: `You are completely right and it does not help at all. Nobody has ever won by being correct at this length.`,
          ja: `全面的に正しく、まったく効かなかった。この長さの正しさで勝った人間はいない。`,
        },
        statDeltas: { followers: -2, aura: -4, humor: -3 },
      },
      {
        label: { en: "Wait for {other} to decide", ja: "{other}の判断を待つ" },
        outcomeText: {
          en: `They do not post it. They do not say they did not, either. You now owe them something neither of you will name.`,
          ja: `上げなかった。上げなかったとも言わない。名前のつかない貸しが一つできた。`,
        },
        statDeltas: { followers: 0, aura: 2, humor: 0 },
      },
    ],
  },
  {
    title: { en: "The Quiet Week", ja: "静かな一週間" },
    prompt: {
      en: `Nothing has happened for six days. {Board} has not moved, {press} has written about somebody else twice, and {crowd} is asking whether you are alright.`,
      ja: `6日間、何も起きていない。{board}は動かず、{press}は二度も他人の話を書き、{crowd}は「大丈夫?」と訊いてくる。`,
    },
    choices: [
      {
        label: { en: "Start something on purpose", ja: "意図的に火をつける" },
        outcomeText: {
          en: `You post the opinion you have been holding since spring. It works, immediately and expensively.`,
          ja: `春から抱えていた持論を出した。即座に効いて、高くついた。`,
        },
        statDeltas: { followers: 8, aura: -2, humor: 3 },
      },
      {
        label: { en: "Show the boring work", ja: "地味な作業を見せる" },
        outcomeText: {
          en: `One photo of {room} at an unglamorous hour. It moves nothing this week and gets quoted back at you for a year.`,
          ja: `{room}の、見栄えのしない時間帯の写真を1枚。今週は何も動かなかった。1年間引用され続けた。`,
        },
        statDeltas: { followers: 1, aura: 6, humor: 1 },
      },
      {
        label: { en: "Say you are tired", ja: "疲れたと書く" },
        outcomeText: {
          en: `Three words, no context. {Crowd} is gentler than you expected and {press} runs it as a development.`,
          ja: `三語、文脈なし。{crowd}は思ったより優しく、{press}はそれを「動き」として報じた。`,
        },
        statDeltas: { followers: 2, aura: 1, humor: -1 },
      },
    ],
  },
];

/** The seven preset personas and five preset events for this world. */
export function deterministicCastEvents(base: G9Input, concept: G9Concept): G9CastEventsOutput {
  const pack = packFor(base.genre);
  const seedKey = `${base.slug}|${base.seed}`;
  const chosen = shuffled(EVENT_TEMPLATES, seedKey, "events").slice(0, WORLD_STUDIO.PRESET_EVENTS);

  const personas = PERSONA_TEMPLATES.map((p) => ({
    handle: p.handle,
    displayName: { en: p.displayName.en, ja: p.displayName.ja },
    bio: {
      en: fill(p.bio.en, contextFor(concept, pack, "en")),
      ja: fill(p.bio.ja, contextFor(concept, pack, "ja")),
    },
    avatarKey: `${base.genre}-persona-${p.handle}`,
  }));

  const events = chosen.map((e, i) => {
    // Two named handles per event, stable per (world, event), never the press account.
    const speakers = concept.cast.filter((c) => !c.isPressAccount);
    const self = speakers[pick(Math.max(speakers.length, 1), seedKey, "ev-self", i)];
    const other = speakers[pick(Math.max(speakers.length, 1), seedKey, "ev-other", i, "x")];
    const ctxFor = (locale: Locale): FillContextWithHandles => ({
      ...contextFor(concept, pack, locale),
      self: `@${self?.handle ?? concept.cast[0]?.handle ?? "unknown"}`,
      other: `@${(other?.handle === self?.handle ? speakers[0]?.handle : other?.handle) ?? concept.cast[0]?.handle ?? "unknown"}`,
    });
    const en = ctxFor("en");
    const ja = ctxFor("ja");
    return {
      title: { en: fill(e.title.en, en), ja: fill(e.title.ja, ja) },
      prompt: { en: fill(e.prompt.en, en), ja: fill(e.prompt.ja, ja) },
      choices: e.choices.map((c) => ({
        label: { en: fill(c.label.en, en), ja: fill(c.label.ja, ja) },
        outcomeText: { en: fill(c.outcomeText.en, en), ja: fill(c.outcomeText.ja, ja) },
        statDeltas: { ...c.statDeltas },
      })),
    };
  });

  return { personas, events };
}

type FillContextWithHandles = FillContext;

/* --------------------------------------------------------- G9e — the texture ---- */

/** Ambient chatter, fallback replies and welcome posts for one locale. */
export function deterministicTexture(
  base: G9Input,
  concept: G9Concept,
  locale: Locale,
): G9TextureOutput {
  const pack = packFor(base.genre);
  const fallbackReplies: Record<string, string[]> = {};
  const welcomePosts: Record<string, string> = {};
  const perMember: Array<{ handle: string; posts: string[] }> = [];

  for (const member of concept.cast) {
    const a = archetypeByKey(member.archetype) ?? PRESS_ARCHETYPE;
    const ctx = contextFor(concept, pack, locale, member);
    fallbackReplies[member.handle] = a.lines[locale].slice(0, 5).map((l) => fill(l, ctx));
    welcomePosts[member.handle] = fill(a.welcome[locale], ctx);
    perMember.push({ handle: member.handle, posts: a.ambient.map((p) => fill(p[locale], ctx)) });
  }

  // Round-robin so the pool never opens with three posts from the same account.
  const ambient: Array<{ handle: string; text: string }> = [];
  const seen = new Set<string>();
  const depth = Math.max(0, ...perMember.map((m) => m.posts.length));
  for (let i = 0; i < depth; i += 1) {
    for (const m of perMember) {
      const text = m.posts[i];
      if (text === undefined || text.length === 0 || seen.has(text)) continue;
      seen.add(text);
      ambient.push({ handle: m.handle, text: text.slice(0, 280) });
    }
  }

  return {
    ambient: ambient.slice(0, WORLD_STUDIO.AMBIENT_PER_LOCALE),
    fallbackReplies,
    welcomePosts,
  };
}
