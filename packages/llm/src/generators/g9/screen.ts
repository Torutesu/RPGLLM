import { WORLD_PREMISE_BLOCKED, type Locale } from "@rpgllm/shared";

/**
 * G9 — premise screen (AIF-003).
 *
 * A world premise is the most dangerous string in the product: the player writes one line, and
 * that line becomes the seed of a **system prompt** that thousands of later generations inherit.
 * apps/api calls `screenPremise` before it spends a gem or a token, so this function has to be
 * pure, synchronous, gateway-free and offline. It fails **closed**: when a rule matches, the
 * premise is blocked, and the categories are exactly `WORLD_PREMISE_BLOCKED`.
 *
 * Two matching modes, because one does not fit both languages:
 *   - Latin terms match on word boundaries against an accent-folded haystack, so "youtube" does
 *     not fire on "youtuber" and "beyoncé" and "beyonce" are the same string.
 *   - Japanese terms match as substrings against a width-folded haystack, because Japanese has no
 *     word boundaries and `\b` is meaningless there. Accents are NOT stripped from this haystack:
 *     NFKD would tear dakuten off ("が" -> "か" + combining mark) and break every term.
 *
 * Sexualised-minor detection is deliberately a **combination** rule rather than a keyword list:
 * "high schooler" and "trainee" and "pupil" are the ordinary vocabulary of two of our eight
 * genres. It fires when a minor term and a sexual term appear in the same premise, plus on a
 * short list of terms that mean nothing else.
 *
 * This screen is not the only defence. It runs before generation; the generated world is written
 * by prompts that carry the fleet-wide safety block, and every in-game action still passes G8.
 */

export type PremiseVerdict = "allow" | "block";
export interface PremiseScreenResult {
  verdict: PremiseVerdict;
  /** one of WORLD_PREMISE_BLOCKED when blocked, null when allowed */
  category: string | null;
}

type BlockedCategory = (typeof WORLD_PREMISE_BLOCKED)[number];

interface Rule {
  category: BlockedCategory;
  /** matched with word boundaries on the accent-folded lowercase haystack */
  latin: readonly string[];
  /** matched as substrings on the width-folded lowercase haystack */
  ja: readonly string[];
  /** structural patterns run against the raw premise (shape, not vocabulary) */
  patterns?: readonly RegExp[];
}

/* ------------------------------------------------------------- vocabulary ---- */

/**
 * Minor markers, split by strength.
 *
 * STRONG markers can only mean a child: an explicit age under 18, "child", "小学生". SOFT markers
 * are the ordinary vocabulary of two of our eight genres — "student", "high school", "生徒",
 * "trainee" — and a screen that blocked on them alone would refuse half the academy and idol
 * premises anyone would ever write.
 *
 *   any minor marker + explicit sexual term  -> sexual_minor
 *   STRONG marker    + romance term          -> sexual_minor
 *
 * So "a high school romance" is allowed and "a romance between a teacher and a 15 year old" is not.
 */
const STRONG_MINOR: readonly string[] = [
  "child", "children", "kid", "kids", "minor", "minors", "underage", "under age", "under-age",
  "preteen", "pre-teen", "toddler", "infant", "schoolgirl", "schoolboy", "schoolkid",
  "school girl", "school boy", "elementary", "primary school", "middle school",
  "middle schooler", "junior high", "grade schooler", "jailbait", "loli", "lolicon",
  "shota", "shotacon",
];
const STRONG_MINOR_JA: readonly string[] = [
  "子供", "子ども", "こども", "児童", "未成年", "幼女", "幼児", "幼稚園", "小学生", "小学校",
  "中学生", "中学校", "女児", "男児", "ロリ", "ショタ",
];
const SOFT_MINOR: readonly string[] = [
  "pupil", "pupils", "student", "students", "teen", "teens", "teenager", "teenagers", "teenage",
  "high school", "high schooler", "highschooler", "freshman", "sixth form", "trainee", "trainees",
  "cadet", "classmate", "classmates",
];
const SOFT_MINOR_JA: readonly string[] = [
  "高校生", "女子高生", "男子高校生", "女子中学生", "少女", "少年", "生徒", "学生",
  "jk", "jc", "研修生", "練習生", "同級生",
];
/** Explicit minority markers that are only ever used in one way. */
const MINOR_AGE_RE = /(?<![0-9])(?:[0-9]|1[0-7])[\s-]?(?:year|yr)s?[\s-]?old\b/;
const MINOR_AGE_JA_RE = /(?<![0-9])(?:1[0-7]|[0-9]|[〇一二三四五六七八九十]{1,3})\s*(?:歳|才)/;

/** Romance without sex. Only escalates when it meets a STRONG minor marker. */
const ROMANCE_TERMS: readonly string[] = [
  "romance", "romantic", "dating", "date with", "crush on", "love story", "in love with",
  "fall in love", "falls in love", "falling in love", "fell in love", "love affair",
  "affair with", "kiss", "kissing", "boyfriend", "girlfriend", "marry", "marriage", "lovers",
];
const ROMANCE_TERMS_JA: readonly string[] = [
  "恋愛", "恋人", "付き合う", "キス", "デート", "告白する", "結婚", "初恋", "恋に落ち",
  "好きになる", "両想い", "同棲",
  // Loanwords and the bare stem. Broad on purpose: these only escalate next to a STRONG marker
  // (小学生, an explicit age under 18), never next to the ordinary 高校生 of two genres.
  "ロマンス", "ラブ", "交際", "恋", "純愛", "熱愛", "ラブコメ",
];

/** Sexual vocabulary. On its own most of these are `sexual_explicit`; combined they are worse. */
const SEXUAL_TERMS: readonly string[] = [
  "sex", "sexual", "sexually", "sexy", "nude", "nudes", "naked", "nsfw", "porn", "porno",
  "pornography", "pornographic", "erotic", "erotica", "hentai", "ecchi", "lewd", "fetish",
  "orgy", "bdsm", "blowjob", "handjob", "masturbate", "masturbation", "genitals", "genitalia",
  "penis", "vagina", "breasts", "boobs", "cleavage", "lingerie", "underwear", "seduce",
  "seduction", "molest", "molestation", "rape", "raping", "incest", "groping", "prostitute",
  "prostitution", "escort service", "strip club", "stripper", "onlyfans", "smut", "gangbang",
  "in bed with", "sleep with", "make out with",
];
const SEXUAL_TERMS_JA: readonly string[] = [
  "性的", "性行為", "セックス", "エロ", "えっち", "ヌード", "全裸", "裸", "猥褻", "わいせつ",
  "ポルノ", "官能", "陵辱", "痴漢", "強姦", "レイプ", "近親相姦", "風俗", "援交", "援助交際",
  "18禁", "アダルト", "おっぱい", "巨乳", "下着", "脱がせ", "誘惑して", "エッチ", "むちむち",
];

/* ----------------------------------------------------------------- rules ---- */

const RULES: readonly Rule[] = [
  {
    // Combination-only above; these terms have no innocent reading.
    category: "sexual_minor",
    latin: [
      "loli", "lolicon", "shota", "shotacon", "jailbait", "child porn", "child pornography",
      "cp material", "underage sex", "underage sexual", "sexualise a child", "sexualize a child",
      "sexualise minors", "sexualize minors", "minor attracted", "grooming a child",
      "adult minor romance", "student teacher romance", "teacher student romance",
    ],
    ja: [
      "ロリコン", "ショタコン", "児童ポルノ", "未成年 性", "援助交際", "円光", "パパ活",
      "教師と生徒の恋愛", "先生と生徒の恋", "女子高生 エロ", "jk エロ",
    ],
  },
  {
    category: "sexual_explicit",
    latin: [
      "porn", "porno", "pornography", "pornographic", "hentai", "xxx", "blowjob", "handjob",
      "orgy", "bdsm", "masturbate", "masturbation", "explicit sex", "sex scene", "sex scenes",
      "smut", "nsfw", "r18", "r-18", "onlyfans", "gangbang", "rape", "raping", "molest",
      "molestation", "incest", "genitals", "genitalia", "erotica", "sexually explicit",
      "strip club", "brothel", "prostitution",
    ],
    ja: [
      "性行為", "ポルノ", "エロゲ", "官能小説", "猥褻", "わいせつ", "陵辱", "強姦", "レイプ",
      "近親相姦", "18禁", "アダルト作品", "風俗店", "痴漢", "えっちな", "エロい世界",
    ],
  },
  {
    // The product is original-worlds-only by an explicit decision: no real people, no real
    // brands, no existing franchises, and nothing brand-adjacent.
    category: "real_person",
    latin: [
      "real person", "real people", "real celebrity", "real celebrities", "actual celebrity",
      "based on a real person", "taylor swift", "beyonce", "kanye", "kim kardashian",
      "elon musk", "donald trump", "joe biden", "obama", "putin", "messi", "ronaldo", "lebron",
      "mrbeast", "pewdiepie", "ariana grande", "billie eilish", "rihanna", "bts", "blackpink",
      "twice", "newjeans", "aespa", "yoasobi", "kenshi yonezu", "ohtani", "hikakin",
      "harry potter", "hogwarts", "marvel", "avengers", "spider man", "spiderman", "batman",
      "superman", "star wars", "jedi", "sith", "disney", "pixar", "pokemon", "pikachu",
      "nintendo", "super mario", "zelda", "minecraft", "roblox", "fortnite", "naruto",
      "one piece", "dragon ball", "demon slayer", "kimetsu", "jujutsu kaisen",
      "attack on titan", "sailor moon", "gundam", "evangelion", "hatsune miku", "vocaloid",
      "sanrio", "hello kitty", "doraemon", "ghibli", "totoro", "netflix", "tiktok",
      "instagram", "twitter", "facebook", "youtube", "snapchat", "reddit", "coca cola",
      "mcdonalds", "starbucks", "nike", "adidas", "google", "amazon prime", "k pop idol group",
    ],
    ja: [
      "実在の人物", "実在する人物", "実在の有名人", "実在の芸能人", "本物の芸能人",
      "ディズニー", "ポケモン", "ピカチュウ", "任天堂", "マリオ", "ゼルダ", "マイクラ",
      "フォートナイト", "ナルト", "ワンピース", "ドラゴンボール", "鬼滅の刃", "呪術廻戦",
      "進撃の巨人", "セーラームーン", "ガンダム", "エヴァンゲリオン", "初音ミク", "ボカロ",
      "サンリオ", "ハローキティ", "ドラえもん", "ジブリ", "トトロ", "ハリーポッター",
      "ホグワーツ", "マーベル", "スターウォーズ", "ネットフリックス", "ティックトック",
      "インスタグラム", "ツイッター", "ユーチューブ", "ジャニーズ", "乃木坂46", "akb48",
      "米津玄師", "大谷翔平", "ヒカキン",
    ],
  },
  {
    category: "hate",
    latin: [
      "nigger", "nigga", "faggot", "tranny", "kike", "spic", "chink", "gook", "wetback",
      "towelhead", "raghead", "retard", "retarded", "subhuman", "sub human", "white power",
      "white supremacy", "white supremacist", "heil hitler", "nazi", "nazis", "neo nazi",
      "ethnic cleansing", "racial purity", "master race", "kill all", "exterminate the",
      "gas the", "holocaust denial", "race war", "inferior race",
    ],
    ja: [
      "チョン", "土人", "キチガイ", "気違い", "非国民", "劣等人種", "民族浄化", "皆殺しにしろ",
      "在日は出て行け", "ナチス", "ヒトラー万歳", "人種差別を推奨", "劣った民族",
    ],
  },
  {
    category: "self_harm",
    // First-person and instructional framings. These block on their own — there is no premise in
    // which "how to kill myself" is the subject rather than the request.
    latin: [
      "kill myself", "killing myself", "kill yourself", "kys",
      "self harm", "self-harm", "selfharm", "cut myself", "cutting myself", "slit my wrists",
      "hang myself", "overdose on", "pro ana", "pro-ana", "pro mia", "thinspo", "thinspiration",
      "starve myself", "starving myself", "end my life", "want to die", "anorexia tips",
      "suicide pact", "suicide method", "how to commit suicide", "encourage suicide",
    ],
    ja: [
      "自傷", "リストカット", "リスカ", "首吊り", "首を吊", "死にたい", "練炭",
      "飛び降り自殺", "拒食", "過食嘔吐", "オーバードーズ", "od する", "消えたい世界",
      "自殺の方法", "自殺を勧", "自殺サークル",
    ],
  },
  {
    category: "violence_graphic",
    latin: [
      "torture", "torturing", "tortured", "gore", "gory", "dismember", "dismemberment",
      "decapitate", "decapitation", "behead", "beheading", "mutilate", "mutilation",
      "disembowel", "snuff film", "flay", "flaying", "vivisection", "animal cruelty",
      "skinned alive", "burned alive", "graphic violence", "bloodbath", "massacre",
    ],
    ja: [
      "拷問", "惨殺", "虐殺", "グロテスク", "グロ画像", "首を切断", "生きたまま焼", "内臓",
      "死体を切", "動物虐待", "なぶり殺し", "四肢切断", "残虐描写",
    ],
  },
  {
    category: "illegal",
    latin: [
      "make a bomb", "build a bomb", "how to make explosives", "pipe bomb", "molotov",
      "make meth", "cook meth", "synthesise drugs", "synthesize drugs", "buy drugs online",
      "sell drugs", "drug dealing guide", "credit card fraud", "steal credit card",
      "how to hack", "hacking guide", "hacking tutorial", "ddos attack", "ransomware",
      "counterfeit money", "ghost gun", "untraceable gun", "buy a gun illegally", "silencer",
      "human trafficking", "money laundering", "launder money", "child trafficking",
    ],
    ja: [
      "爆弾の作り方", "爆薬の作り方", "覚醒剤", "大麻の育て方", "大麻栽培", "拳銃の入手",
      "銃の作り方", "麻薬の売り方", "偽造カード", "ハッキングの方法", "マネーロンダリング",
      "人身売買", "児童買春", "脱税の方法", "毒物の作り方",
    ],
  },
  {
    // The premise becomes part of a system prompt. Anything shaped like an instruction to the
    // model, a role marker, or a delimiter that could close our own block is refused outright.
    category: "prompt_injection",
    latin: [
      "ignore previous", "ignore all previous", "ignore the above", "ignore your instructions",
      "ignore all instructions", "disregard previous", "disregard the above", "disregard your",
      "forget your instructions", "forget everything above", "new instructions",
      "system prompt", "your system prompt", "you are now", "from now on you are",
      "act as if you are", "pretend you are an ai", "override your", "bypass your",
      "jailbreak", "dan mode", "developer mode", "print your instructions",
      "reveal your prompt", "repeat the above", "end of prompt", "begin system",
      "your real instructions", "output your rules",
    ],
    ja: [
      "以前の指示", "これまでの指示", "指示を無視", "命令を無視", "上記を無視",
      "システムプロンプト", "あなたは今から", "今からあなたは", "役割を変更",
      "プロンプトを表示", "指示を全て忘れ", "前の指示を忘れ", "ルールを無視",
      "設定を書き換え", "本当の指示を",
    ],
    patterns: [
      /```/, // a fenced block would close ours
      /^[ \t]*(?:system|assistant|user|human|developer)[ \t]*[:：]/im, // role marker
      /<\|[^|]*\|>/, // chat-template control token
      /\[\/?inst\]/i, // instruction delimiters
      /<\/?(?:system|assistant|user|instructions?|prompt)\b[^>]*>/i, // xml-ish role tag
      /\{\{[^}]*\}\}/, // template interpolation
      /^\s*#{1,3}\s*(?:task|role|system|instructions?)\b/im, // a header impersonating our own
    ],
  },
];

/* ------------------------------------------------------------- normalise ---- */

const ZERO_WIDTH_RE = /[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g;

/** Latin haystack: width-folded, accent-stripped, lowercase, punctuation-normalised. */
function latinHaystack(premise: string): string {
  return premise
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(ZERO_WIDTH_RE, "")
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[^a-z0-9'\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Japanese haystack: width-folded only. NFKD would destroy dakuten, so it is never applied here. */
function jaHaystack(premise: string): string {
  return premise.normalize("NFKC").replace(ZERO_WIDTH_RE, "").toLowerCase();
}

function escapeRe(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const latinCache = new Map<string, RegExp>();

/** Word-bounded match, so "youtube" misses "youtuber" and "kid" misses "kidney". */
function latinHit(haystack: string, term: string): boolean {
  let re = latinCache.get(term);
  if (re === undefined) {
    const body = escapeRe(term.toLowerCase()).replace(/\s+/g, "[\\s-]+");
    re = new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`, "i");
    latinCache.set(term, re);
  }
  return re.test(haystack);
}

function anyLatin(haystack: string, terms: readonly string[]): boolean {
  return terms.some((t) => latinHit(haystack, t));
}

function anyJa(haystack: string, terms: readonly string[]): boolean {
  return terms.some((t) => haystack.includes(t.toLowerCase()));
}

/**
 * "How to make X" is the shape that matters, not the noun.
 *
 * A world can be *about* meth, guns or a bomb plot — that is a whole genre of television — so the
 * nouns below do not block on their own. What blocks is a premise that asks for the procedure:
 * an instruction marker next to contraband. `RULES`' `illegal` list still catches the phrasings
 * that are only ever a request ("cook meth", "爆弾の作り方").
 */
/**
 * Bare `suicide` / `自殺` used to block outright, which took a whole class of ordinary drama with
 * it — a town still recovering from one, a death that looks like one. The word is not the problem;
 * asking the world to teach, encourage or stage it is. So the noun is soft and only blocks next to
 * one of these.
 */
const SELF_HARM_SOFT: readonly string[] = ["suicide", "suicidal", "self-inflicted"];
const SELF_HARM_SOFT_JA: readonly string[] = ["自殺", "自死"];
const SELF_HARM_ESCALATORS: readonly string[] = [
  "how to", "guide", "method", "teach", "tutorial", "step by step", "step-by-step", "instructions",
  // Inflections spelled out: matching is word-boundaried, so a stem would never fire.
  "encourage", "encourages", "encouraging", "glorify", "glorifies", "glorifying",
  "romanticise", "romanticises", "romanticize", "romanticizes", "celebrate", "celebrates",
  "celebrating", "teaches", "invites", "inviting",
  "pact", "challenge", "dare", "compete", "contest", "game where", "together", "join me",
  "help me", "talk me into", "convince", "plan my", "plan our", "coach", "way out",
];
const SELF_HARM_ESCALATORS_JA: readonly string[] = [
  "方法", "やり方", "手順", "教え", "指南", "勧め", "推奨", "美化", "賛美", "誘", "煽",
  "一緒に", "手伝", "計画", "コツ",
];

const HOWTO_MARKERS: readonly string[] = [
  "how to make", "how to build", "how to cook", "how to synthesise", "how to synthesize",
  "how to manufacture", "guide to making", "guide to building", "step by step", "step-by-step",
  "recipe for", "instructions for", "tutorial on", "walkthrough for", "teaches you to make",
];
const HOWTO_MARKERS_JA: readonly string[] = [
  "の作り方", "作り方を", "の製造方法", "の合成方法", "手順を教え", "レシピを教え", "手取り足取り",
];
const CONTRABAND: readonly string[] = [
  "meth", "methamphetamine", "fentanyl", "heroin", "cocaine", "lsd", "mdma", "ecstasy pills",
  "explosives", "explosive", "bomb", "grenade", "napalm", "nerve agent", "sarin", "ricin",
  "poison", "nerve gas", "silencer", "suppressor", "gun", "firearm", "rifle", "pistol",
  "ammunition", "thermite", "chlorine gas", "pipe bomb",
];
const CONTRABAND_JA: readonly string[] = [
  "覚醒剤", "覚せい剤", "麻薬", "薬物", "大麻", "コカイン", "ヘロイン", "爆弾", "爆薬", "火薬",
  "銃", "拳銃", "毒物", "毒ガス", "サリン", "神経ガス", "手榴弾",
];

/* ---------------------------------------------------------------- screen ---- */

function strongMinor(latin: string, ja: string): boolean {
  return (
    anyLatin(latin, STRONG_MINOR) ||
    anyJa(ja, STRONG_MINOR_JA) ||
    MINOR_AGE_RE.test(latin) ||
    MINOR_AGE_JA_RE.test(ja)
  );
}

function anyMinor(latin: string, ja: string): boolean {
  return strongMinor(latin, ja) || anyLatin(latin, SOFT_MINOR) || anyJa(ja, SOFT_MINOR_JA);
}

function mentionsSexual(latin: string, ja: string): boolean {
  return anyLatin(latin, SEXUAL_TERMS) || anyJa(ja, SEXUAL_TERMS_JA);
}

function mentionsRomance(latin: string, ja: string): boolean {
  return anyLatin(latin, ROMANCE_TERMS) || anyJa(ja, ROMANCE_TERMS_JA);
}

/**
 * Screen a player-written world premise. Pure, offline, no gateway, no model.
 *
 * `locale` is the creator's language. Both term sets always run regardless of it — a Japanese
 * user can type English and vice versa, and a screen that trusted the locale flag would be
 * bypassable by switching it. The parameter is kept because apps/api logs the pair and because
 * the signature has to stay stable for the API's own tests.
 */
export function screenPremise(premise: string, locale: Locale): PremiseScreenResult {
  void locale;
  const raw = premise ?? "";
  const latin = latinHaystack(raw);
  const ja = jaHaystack(raw);

  // Sexualised minors first: the combination rules fire on words that are individually fine.
  if (anyMinor(latin, ja) && mentionsSexual(latin, ja)) {
    return { verdict: "block", category: "sexual_minor" };
  }
  if (strongMinor(latin, ja) && mentionsRomance(latin, ja)) {
    return { verdict: "block", category: "sexual_minor" };
  }

  // A world *about* a suicide is drama; a world that teaches, stages or cheers one is not.
  if (
    (anyLatin(latin, SELF_HARM_SOFT) && anyLatin(latin, SELF_HARM_ESCALATORS))
    || (anyJa(ja, SELF_HARM_SOFT_JA) && anyJa(ja, SELF_HARM_ESCALATORS_JA))
  ) {
    return { verdict: "block", category: "self_harm" };
  }

  // Asking for the procedure, not writing a world about it.
  if (
    (anyLatin(latin, HOWTO_MARKERS) && anyLatin(latin, CONTRABAND))
    || (anyJa(ja, HOWTO_MARKERS_JA) && anyJa(ja, CONTRABAND_JA))
  ) {
    return { verdict: "block", category: "illegal" };
  }

  for (const rule of RULES) {
    if (anyLatin(latin, rule.latin)) return { verdict: "block", category: rule.category };
    if (anyJa(ja, rule.ja)) return { verdict: "block", category: rule.category };
    if (rule.patterns?.some((p) => p.test(raw)) === true) {
      return { verdict: "block", category: rule.category };
    }
  }

  return { verdict: "allow", category: null };
}

/**
 * Everything the studio does to a premise before it is allowed near a prompt: strip anything that
 * could act as a delimiter or a role marker, collapse it to one line, and cap it. The result is
 * what goes into the *user* block of G9a, inside a quoted DATA section — never into a system
 * block, and never into the generated world.
 */
export function sanitizePremise(premise: string): string {
  return (premise ?? "")
    .normalize("NFKC")
    .replace(ZERO_WIDTH_RE, "")
    .replace(/[`"'<>{}|\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}
