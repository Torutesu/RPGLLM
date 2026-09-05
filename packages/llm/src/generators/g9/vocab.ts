import type { Locale, WorldGenre } from "@rpgllm/shared";

/**
 * G9 — genre vocabulary packs (AIF-003).
 *
 * A generated world is never written from nothing: the premise chooses a *genre*, and the genre
 * supplies the nouns the whole world is made of — what people make, where they make it, what
 * number they are judged by, which three groups are pulling at each other. Every downstream
 * template (bible prose, cast cards, events, ambient chatter) is written once with `{slots}` and
 * filled from the pack, so eight genres in two locales read like eight authored worlds instead of
 * one world with the nouns swapped.
 *
 * These packs are also what `LLM_MODE=replay` runs on: no model, no network, same bytes every time.
 */

/** The fourteen nouns every template may reference. Written per locale, never translated. */
export interface GenreWords {
  /** the world itself: "the music industry", "the academy" */
  world: string;
  /** one unit of work: "a song", "a stage" */
  craft: string;
  /** many of them */
  crafts: string;
  /** the verb of succeeding: "go viral", "land the centre" */
  make: string;
  /** where the work happens, unglamorously */
  room: string;
  /** where the work is judged in public */
  stage: string;
  /** the countable thing that goes up and down */
  metric: string;
  /** where the metric is displayed */
  board: string;
  /** the institution above everyone */
  boss: string;
  /** the people watching */
  crowd: string;
  /** the nearest competitor */
  rival: string;
  /** the object that leaks */
  item: string;
  /** the recurring big night */
  night: string;
  /** the shape gossip takes here */
  whisper: string;
}

export interface GenrePack {
  genre: WorldGenre;
  /** the word that ends a generated title: "<Keyword> Era" */
  titleWord: Record<Locale, string>;
  /** invented app name — the platform every post in this world is written on */
  platformName: string;
  /** what the platform is and how people behave on it */
  conceit: Record<Locale, string>;
  /** the world and the player's position in it, 3-4 sentences */
  setting: Record<Locale, string>;
  words: Record<Locale, GenreWords>;
  places: Array<{ name: Record<Locale, string>; note: Record<Locale, string> }>;
  factions: Array<{ name: Record<Locale, string>; blurb: Record<Locale, string> }>;
  slang: Array<{ term: string; gloss: Record<Locale, string> }>;
  /** bare handle stems, HANDLE_RE-legal; 8 are drawn per world */
  handles: readonly string[];
  /** the one account allowed to post news */
  pressHandle: string;
  /** which display-name pool this genre draws from */
  names: "modern" | "arcane";
}

const FAME: GenrePack = {
  genre: "fame",
  titleWord: { en: "Era", ja: "エラ" },
  platformName: "GLARE",
  conceit: {
    en: `GLARE is a text-first feed that the whole attention economy refreshes at 3am. Posts are short, replies stack, and quote-posting is how people argue. There are no images here: when someone "posts a photo" they describe it or react to it in words.`,
    ja: `GLARE はテキスト中心のフィードで、注目を売って生きる人間が深夜3時に更新し続ける場所。投稿は短く、返信が積み上がり、口論は引用投稿で行われる。画像は存在しない。誰かが「写真を上げた」ときは、言葉で描写するか、反応として書く。`,
  },
  setting: {
    en: `Six weeks ago nobody could pick the player out of a crowd. One post changed that, and the number attached to it has not stopped moving since. There is now an agency in their messages, a gossip account with a folder of their old posts, and a few thousand strangers who have already decided who they are. Nothing here is stable and everything is fast.`,
    ja: `6週間前まで、プレイヤーは群衆の中の一人だった。1本の投稿がそれを変え、そこに付いた数字は以来止まっていない。今ではDMに事務所がいて、ゴシップアカウントは過去の投稿のフォルダを持ち、数千人の他人がもうこの人物像を決めている。何も安定していないし、すべてが速い。`,
  },
  words: {
    en: {
      world: "the attention economy", craft: "a post", crafts: "posts", make: "go viral",
      room: "the group chat", stage: "the front page", metric: "views", board: "the trending list",
      boss: "the agency", crowd: "the timeline", rival: "the other account", item: "a screenshot",
      night: "the awards stream", whisper: "a sub-post",
    },
    ja: {
      world: "注目の経済", craft: "1本の投稿", crafts: "投稿", make: "バズる",
      room: "グループチャット", stage: "トップページ", metric: "再生数", board: "トレンド",
      boss: "事務所", crowd: "タイムライン", rival: "向こうのアカウント", item: "スクショ",
      night: "配信授賞式", whisper: "匂わせ",
    },
  },
  places: [
    { name: { en: "Loading Bay", ja: "ローディング・ベイ" }, note: { en: "the co-working basement where half the feed films in the same corner", ja: "フィードの半分が同じ角で撮っている地下のコワーキング" } },
    { name: { en: "The Fourth Floor", ja: "4階" }, note: { en: "the agency office. Nobody who goes up comes down the same", ja: "事務所のフロア。上がった人間は同じ顔で降りてこない" } },
    { name: { en: "Kestrel Diner", ja: "ケストレル・ダイナー" }, note: { en: "open all night, three careers have ended in its car park", ja: "24時間営業。駐車場で3つのキャリアが終わっている" } },
    { name: { en: "The Glass Room", ja: "ガラスの部屋" }, note: { en: "where the brand deals are signed and the good jokes go to die", ja: "案件の契約が交わされ、良い冗談が死ぬ部屋" } },
  ],
  factions: [
    { name: { en: "The Timeline", ja: "タイムライン" }, blurb: { en: "everyone quote-posting. Not neutral, not organised, and always hungry for this week's story.", ja: "引用投稿をする全員。中立でも組織的でもなく、今週の物語に常に飢えている。" } },
    { name: { en: "The Fourth Floor", ja: "4階" }, blurb: { en: "managers, brand people, lawyers. They can open every door and close them just as fast.", ja: "マネージャー、ブランド担当、弁護士。どの扉も開けられるし、同じ速さで閉められる。" } },
    { name: { en: "The Regulars", ja: "常連" }, blurb: { en: "the small accounts who were here before the numbers. Loyalty here is worth more than reach.", ja: "数字が付く前からいた小さなアカウントたち。ここでの忠誠はリーチより高い。" } },
  ],
  slang: [
    { term: "era", gloss: { en: "someone's current public identity. \"she's in her spite era.\"", ja: "その人の今の公的な自我。「今は逆張りエラ」" } },
    { term: "ratio'd", gloss: { en: "the replies dunking on you outnumber the likes", ja: "叩き返信がいいねを上回った状態" } },
    { term: "sub-post", gloss: { en: "a post obviously about someone without naming them", ja: "名指しせずに明らかに誰かのことを書く投稿" } },
    { term: "receipts", gloss: { en: "screenshots. \"drop receipts\" is a demand, not a request", ja: "スクショ。「レシート出して」は依頼ではなく要求" } },
    { term: "clocked", gloss: { en: "noticed the thing someone was hiding", ja: "隠していたものを見抜かれた" } },
    { term: "main character", gloss: { en: "the person the whole feed is discussing today", ja: "その日フィード全体が話題にしている人" } },
    { term: "it's giving", gloss: { en: "this reads as X. Usually mildly insulting", ja: "それは要するにXだよね、の意。だいたい少し失礼" } },
    { term: "plant", gloss: { en: "a story fed to the feed by someone's own team", ja: "本人のチームが流したと分かる話" } },
  ],
  handles: [
    "glareblake", "noorposts", "mikoisonline", "dashfrom6", "velvetcrash", "aprilsees",
    "tinozone", "havenrun", "lolaquotes", "brixmode", "okaycassian", "marlowsaid",
  ],
  pressHandle: "thefeedwire",
  names: "modern",
};

const ACADEMY: GenrePack = {
  genre: "academy",
  titleWord: { en: "Academy", ja: "学院" },
  platformName: "COMMONS",
  conceit: {
    en: `COMMONS is the academy's own board — officially for timetables, actually for everything else. Posts are short and public, replies stack, and a screenshot of a corridor conversation travels faster than any notice the faculty pins up.`,
    ja: `COMMONS は学院の掲示システム。建前は時間割、実態はそれ以外の全部。投稿は短く、公開で、返信が積み上がる。廊下の会話のスクショは、教授会が貼るどの通達より速く回る。`,
  },
  setting: {
    en: `Marks here are public by tradition and cruel by design: everyone can see exactly how far ahead or behind everyone else is, updated after every assessment. The player arrived mid-year with a result nobody expected, which the year group is treating as either a promise or an accusation. The faculty have noticed. That is not the same as being pleased.`,
    ja: `この学院では評点が伝統的に公開される。設計からして残酷で、評価のたびに、誰が誰よりどれだけ先か後かが全員に見える。プレイヤーは年度の途中に、誰も予想しなかった結果を持って現れた。同期はそれを、約束と受け取るか、告発と受け取るかで割れている。教授会は気づいている。それは歓迎とは違う。`,
  },
  words: {
    en: {
      world: "the academy", craft: "a working", crafts: "workings", make: "pass a viva",
      room: "the practice hall", stage: "the great hall", metric: "marks", board: "the results board",
      boss: "the faculty", crowd: "the year group", rival: "the other house", item: "a marked script",
      night: "examination night", whisper: "a corridor rumour",
    },
    ja: {
      world: "学院", craft: "術式", crafts: "術式", make: "口述試験を通る",
      room: "演習室", stage: "大講堂", metric: "評点", board: "成績掲示",
      boss: "教授会", crowd: "同期", rival: "向こうの寮", item: "採点済みの答案",
      night: "試験の夜", whisper: "廊下の噂",
    },
  },
  places: [
    { name: { en: "The Long Hall", ja: "長廊" }, note: { en: "where the results board hangs. People read it standing very still", ja: "成績掲示が下がる場所。皆やけに動かずに読む" } },
    { name: { en: "Practice Hall Six", ja: "第六演習室" }, note: { en: "booked out at 5am by the people who intend to win", ja: "勝つつもりの人間が朝5時から押さえている" } },
    { name: { en: "The Undercroft", ja: "地下聖堂" }, note: { en: "unlit, unofficial, and where every real conversation happens", ja: "照明なし、非公式。本当の話は全部ここで起きる" } },
    { name: { en: "The Orangery", ja: "オランジェリー" }, note: { en: "faculty tea. Being summoned here is never neutral", ja: "教授会の茶室。呼ばれる時点で中立ではない" } },
  ],
  factions: [
    { name: { en: "The Faculty", ja: "教授会" }, blurb: { en: "they decide what counts as a result. They protect the academy first and the student second.", ja: "何を成果と呼ぶかを決める人々。守るのは学院が先で、学生は後。" } },
    { name: { en: "The Year Group", ja: "同期" }, blurb: { en: "friendly, competitive, and keeping a running mental table of everyone's marks.", ja: "仲は良く、競っていて、全員の評点を頭の中で常に順位付けしている。" } },
    { name: { en: "The Undercroft Set", ja: "地下聖堂の連中" }, blurb: { en: "students who think the syllabus is a suggestion. Credibility lives here; so does trouble.", ja: "課程を提案だと思っている学生たち。信用もここにあり、面倒もここにある。" } },
  ],
  slang: [
    { term: "on the board", gloss: { en: "your mark is public this week and everyone has read it", ja: "今週は掲示に名前が出ていて全員が読んでいる" } },
    { term: "viva'd", gloss: { en: "taken apart in an oral examination", ja: "口述で解体された" } },
    { term: "clean pass", gloss: { en: "a result nobody can argue with, said with suspicion", ja: "文句のつけようがない結果。疑いを込めて言う" } },
    { term: "carrying", gloss: { en: "doing a partner's half of the work and everyone knows", ja: "相方の分まで抱えていて、それを全員が知っている" } },
    { term: "corridor", gloss: { en: "the rumour layer. \"it's corridor, not fact\"", ja: "噂の層。「それは廊下の話で事実じゃない」" } },
    { term: "flare", gloss: { en: "a working that goes wrong loudly and in public", ja: "人前で派手に失敗した術式" } },
    { term: "the ask", gloss: { en: "what a faculty member actually wants, under what they said", ja: "教授が口にしたことの下にある、本当の要求" } },
    { term: "quiet term", gloss: { en: "a stretch with no result. Said kindly, meant otherwise", ja: "成果のない期間。優しい口調で、そうでない意味で使う" } },
  ],
  handles: [
    "belwether", "quillmarrow", "ashgrove_ivo", "noctarine", "sableriddle", "primrosek",
    "thornby", "vex_orrery", "lampwick", "greyhallow", "mirabel_ash", "corvid_no9",
  ],
  pressHandle: "thebellringer",
  names: "arcane",
};

const IDOL: GenrePack = {
  genre: "idol",
  titleWord: { en: "Survival", ja: "サバイバル" },
  platformName: "STAGE9",
  conceit: {
    en: `STAGE9 is the show's official feed and its unofficial court. Trainees post from the practice rooms, viewers post the ranking back at them, and every clip is timestamped so nobody can pretend a thing did not happen at 2:14am.`,
    ja: `STAGE9 は番組の公式フィードであり、非公式の法廷でもある。練習生は練習室から投稿し、視聴者は順位表を突きつけ返す。すべての切り抜きに時刻が入っているので、深夜2時14分に起きたことを無かったことにはできない。`,
  },
  setting: {
    en: `Ninety-six trainees, eleven seats, twelve weeks. The ranking is published every Friday and it is the only sentence anyone reads. The player entered late as a replacement, which the show has already edited into a storyline, and the voters are deciding this week whether that storyline is one they like. Sleep is a resource. So is being interesting.`,
    ja: `96人の練習生、11の席、12週間。順位は毎週金曜に発表され、誰もがそれしか読まない。プレイヤーは補充として途中から入り、番組はもうそれを一つの筋書きに編集済み。視聴者は今週、その筋書きを好きかどうかを決めようとしている。睡眠は資源。面白くあることも資源。`,
  },
  words: {
    en: {
      world: "the survival show", craft: "a stage", crafts: "stages", make: "land the centre",
      room: "the practice room", stage: "the finals stage", metric: "votes", board: "the ranking",
      boss: "production", crowd: "the voters", rival: "the other team", item: "a leaked evaluation",
      night: "the elimination broadcast", whisper: "a fancam edit",
    },
    ja: {
      world: "サバイバル番組", craft: "ステージ", crafts: "ステージ", make: "センターを取る",
      room: "練習室", stage: "決勝ステージ", metric: "票", board: "順位表",
      boss: "制作", crowd: "投票者", rival: "向こうのチーム", item: "流出した評価シート",
      night: "脱落発表の生放送", whisper: "ファンカム",
    },
  },
  places: [
    { name: { en: "Practice Room B", ja: "B練習室" }, note: { en: "mirrors on three walls, cameras on the fourth", ja: "三面が鏡、残りの一面がカメラ" } },
    { name: { en: "The Dorm Corridor", ja: "寮の廊下" }, note: { en: "the only place without a microphone, allegedly", ja: "マイクが無いとされている唯一の場所" } },
    { name: { en: "The Voting Wall", ja: "投票ウォール" }, note: { en: "eleven seats, ninety-six faces, updated live", ja: "11の席と96の顔。リアルタイム更新" } },
    { name: { en: "The Green Room", ja: "楽屋" }, note: { en: "where production tells you the plan after they have already filmed it", ja: "撮り終えた後に、制作が段取りを教えてくる部屋" } },
  ],
  factions: [
    { name: { en: "Production", ja: "制作" }, blurb: { en: "they own the edit. Everything you do is raw material for a story you do not get to read first.", ja: "編集権は彼らのもの。何をしても、先に読ませてもらえない物語の素材になる。" } },
    { name: { en: "The Voters", ja: "投票者" }, blurb: { en: "organised, sleepless, frame-by-frame. Their approval moves the ranking; their disappointment moves it faster.", ja: "組織的で、眠らず、コマ送りで見る。支持は順位を上げ、失望はもっと速く下げる。" } },
    { name: { en: "The Practice Room", ja: "練習室" }, blurb: { en: "the other trainees. Rivals by structure, the only people who understand by circumstance.", ja: "他の練習生。構造上はライバルで、事情としては唯一分かり合える相手。" } },
  ],
  slang: [
    { term: "centre", gloss: { en: "the middle position, and the whole argument", ja: "中央の立ち位置。そして争いの全部" } },
    { term: "eval", gloss: { en: "the weekly evaluation. Leaks every time", ja: "週次の評価。毎回漏れる" } },
    { term: "edit", gloss: { en: "how production chose to show you. \"villain edit\" is a sentence", ja: "制作が選んだ見せ方。「悪役編集」は判決に等しい" } },
    { term: "fancam", gloss: { en: "a single-member clip. The currency of the voters", ja: "個人カメラ。投票者の通貨" } },
    { term: "safe", gloss: { en: "not eliminated. Never said with relief, only with maths", ja: "脱落しなかった状態。安堵ではなく計算で語られる" } },
    { term: "line distribution", gloss: { en: "who got how many bars. Argued about for days", ja: "パート配分。何日も揉める" } },
    { term: "trainee hours", gloss: { en: "any time between midnight and 5am", ja: "深夜0時から5時までの時間帯" } },
    { term: "carried", gloss: { en: "someone else did your part of the stage", ja: "自分のパートを誰かに背負われた" } },
  ],
  handles: [
    "yunaonstage", "cam_no4", "rinaseven", "haruaudition", "mochi_center", "kaedeoffcam",
    "seven_taro", "lilyintheback", "nozomistays", "ao_practice", "hanabi_v", "riko_flat",
  ],
  pressHandle: "thevoteline",
  names: "modern",
};

const OFFICE: GenrePack = {
  genre: "office",
  titleWord: { en: "Floor", ja: "フロア" },
  platformName: "OPENDESK",
  conceit: {
    en: `OPENDESK is the company's internal feed, which everybody swears is not social media and uses exactly like social media. Posts are public to the whole company. Replies are threaded. Every screenshot eventually reaches the one person it was about.`,
    ja: `OPENDESK は社内フィード。全員が「SNSではない」と言い張り、完全にSNSとして使っている。投稿は全社公開。返信はスレッドになる。スクショはいずれ、それが書かれた当人のところへ届く。`,
  },
  setting: {
    en: `The company is between a good year and a reorganisation, and everyone can feel it in the calendar invites. The player shipped something small that worked, which has made them briefly visible to a floor they have never been on. Visibility here is not the same as safety. The reply that gets you promoted and the reply that gets you managed out are the same length.`,
    ja: `会社は好調な一年と組織改編の間にいて、全員がそれをカレンダーの招待から感じ取っている。プレイヤーは小さなものを出し、それが上手くいった。おかげで、行ったこともないフロアから一時的に見える存在になった。ここで可視化されることは、安全とは違う。昇進につながる返信と、追い出しにつながる返信は、同じ長さで書かれる。`,
  },
  words: {
    en: {
      world: "the company", craft: "a deck", crafts: "decks", make: "ship it",
      room: "the meeting room", stage: "the all-hands", metric: "numbers", board: "the org chart",
      boss: "the executive floor", crowd: "the team", rival: "the other team", item: "a forwarded email",
      night: "the year-end party", whisper: "a corridor conversation",
    },
    ja: {
      world: "会社", craft: "資料", crafts: "資料", make: "出す",
      room: "会議室", stage: "全社会議", metric: "数字", board: "組織図",
      boss: "役員フロア", crowd: "チーム", rival: "向こうの部署", item: "転送されたメール",
      night: "忘年会", whisper: "廊下の立ち話",
    },
  },
  places: [
    { name: { en: "Meeting Room 4B", ja: "会議室4B" }, note: { en: "no windows, one whiteboard nobody has erased in a year", ja: "窓なし。1年消されていないホワイトボードが1枚" } },
    { name: { en: "The Ninth Floor", ja: "9階" }, note: { en: "executives. The lift stops there whether you pressed it or not", ja: "役員フロア。押していなくてもエレベーターは止まる" } },
    { name: { en: "The Smoking Corner", ja: "喫煙所" }, note: { en: "nobody smokes any more; the corner still decides things", ja: "もう誰も吸っていない。それでもここで物事が決まる" } },
    { name: { en: "The Annexe", ja: "別館" }, note: { en: "where teams are moved when the plan for them changes", ja: "扱いが変わったチームが移される場所" } },
  ],
  factions: [
    { name: { en: "The Ninth Floor", ja: "9階" }, blurb: { en: "the people who write the plan. Polite, quotable, and never in the thread you need them in.", ja: "計画を書く人々。丁寧で、引用しやすく、必要なスレッドには絶対にいない。" } },
    { name: { en: "The Team", ja: "チーム" }, blurb: { en: "the people who do the work and remember who took the credit last quarter.", ja: "実際に手を動かす人々。前期に誰が手柄を持っていったかを覚えている。" } },
    { name: { en: "The Long-Timers", ja: "古株" }, blurb: { en: "here through three reorganisations. They know which promises the company has kept.", ja: "組織改編を3回くぐった人々。どの約束が守られたかを知っている。" } },
  ],
  slang: [
    { term: "circle back", gloss: { en: "this is over and neither of us will mention it again", ja: "この話は終わり。二度と触れない、の意" } },
    { term: "visibility", gloss: { en: "being seen by the ninth floor. A risk, described as a reward", ja: "9階から見えている状態。褒美として語られるリスク" } },
    { term: "owner", gloss: { en: "whoever gets blamed. Assigned in meetings, never volunteered", ja: "責任を負う人。会議で任命され、立候補は出ない" } },
    { term: "aligned", gloss: { en: "two people have agreed to stop arguing in public", ja: "2人が公の場での口論をやめることに合意した状態" } },
    { term: "quick sync", gloss: { en: "a meeting about something that has already been decided", ja: "既に決まっている件のための打ち合わせ" } },
    { term: "the deck", gloss: { en: "the document that replaced the actual work", ja: "実際の仕事の代わりになった資料" } },
    { term: "reorg", gloss: { en: "the word nobody says out loud in a public channel", ja: "公開チャンネルでは誰も口に出さない単語" } },
    { term: "on my radar", gloss: { en: "I have not read it and will not", ja: "読んでいないし、読むつもりもない" } },
  ],
  handles: [
    "kenjiafter6", "marucalendar", "tanabe_ops", "hoshinodeck", "yui_ccbcc", "reo_offsite",
    "sakadesk", "minaquarterly", "ito_onleave", "daichi_sync", "nori_pm", "eri_theannexe",
  ],
  pressHandle: "theinternalmemo",
  names: "modern",
};

const SPORTS: GenrePack = {
  genre: "sports",
  titleWord: { en: "Season", ja: "シーズン" },
  platformName: "TOUCHLINE",
  conceit: {
    en: `TOUCHLINE is where the club, the players and the stand all post at each other in public. Short posts, stacked replies, and a fixture list that turns every argument into a countdown. Nobody wins an argument here; they win on Saturday and post about it.`,
    ja: `TOUCHLINE では、クラブも選手もスタンドも、公開の場で互いに投稿し合う。短い投稿、積み上がる返信、そしてすべての口論をカウントダウンに変える日程表。ここで口論に勝つ人間はいない。土曜に勝って、それを投稿する。`,
  },
  setting: {
    en: `The club is mid-table, which is the cruellest place to be: too good to rebuild, not good enough to promise anything. The player came off the bench last week and changed a game, and now the stand has an opinion about the starting eleven and is not keeping it to itself. The manager reads everything and admits to reading nothing.`,
    ja: `クラブは中位。これが最も残酷な位置で、作り直すには上手すぎ、何かを約束するには足りない。プレイヤーは先週ベンチから出て試合を変えた。おかげでスタンドは先発11人について意見を持ち、それを黙ってはいない。監督は全部読んでいて、何も読んでいないと言う。`,
  },
  words: {
    en: {
      world: "the league", craft: "a match", crafts: "matches", make: "start on Saturday",
      room: "the changing room", stage: "the home ground", metric: "minutes", board: "the table",
      boss: "the club", crowd: "the stand", rival: "the other side", item: "a training clip",
      night: "the derby", whisper: "a comment from the bench",
    },
    ja: {
      world: "リーグ", craft: "試合", crafts: "試合", make: "土曜に先発する",
      room: "ロッカールーム", stage: "ホーム", metric: "出場時間", board: "順位表",
      boss: "クラブ", crowd: "スタンド", rival: "相手", item: "練習の切り抜き",
      night: "ダービー", whisper: "ベンチからの一言",
    },
  },
  places: [
    { name: { en: "The Kop End", ja: "ゴール裏" }, note: { en: "the loud end. It decides who is a favourite and who is a problem", ja: "うるさい側。誰が愛され誰が問題かを決めるのはここ" } },
    { name: { en: "The Training Ground", ja: "練習場" }, note: { en: "Tuesday is the day careers are quietly decided", ja: "火曜。キャリアが静かに決まる曜日" } },
    { name: { en: "The Tunnel", ja: "トンネル" }, note: { en: "eleven seconds where everything gets said and nothing is recorded", ja: "全部が言われて何も記録されない11秒" } },
    { name: { en: "The Boardroom", ja: "役員室" }, note: { en: "where the manager's future is discussed as a budget line", ja: "監督の去就が予算の一行として話される部屋" } },
  ],
  factions: [
    { name: { en: "The Stand", ja: "スタンド" }, blurb: { en: "they paid, they sing, they have a long memory and a short fuse.", ja: "金を払い、歌い、記憶は長く、気は短い。" } },
    { name: { en: "The Club", ja: "クラブ" }, blurb: { en: "contracts, budgets and press officers. They want everyone calm and marketable.", ja: "契約、予算、広報。全員に穏やかで売り物であってほしい。" } },
    { name: { en: "The Changing Room", ja: "ロッカールーム" }, blurb: { en: "teammates and rivals for the same shirt. Loyalty here is decided in training, not in public.", ja: "同じ背番号を争う仲間。忠誠は公の場ではなく練習で決まる。" } },
  ],
  slang: [
    { term: "minutes", gloss: { en: "time on the pitch. The only currency", ja: "ピッチに立った時間。唯一の通貨" } },
    { term: "in the squad", gloss: { en: "named but not necessarily playing", ja: "招集はされたが出るとは限らない" } },
    { term: "the shirt", gloss: { en: "the starting place someone else currently owns", ja: "今は他人が持っている先発の座" } },
    { term: "gone", gloss: { en: "a manager whose sacking has already been decided upstairs", ja: "上でもう解任が決まっている監督" } },
    { term: "clip", gloss: { en: "training footage that escaped, always without context", ja: "外に出た練習映像。必ず文脈なしで出る" } },
    { term: "bottled", gloss: { en: "lost a game the team should have won, publicly", ja: "勝つべき試合を公然と落とした" } },
    { term: "one of us", gloss: { en: "the stand's highest honour, given for effort not talent", ja: "スタンドの最高の称号。才能ではなく走った量に出る" } },
    { term: "matchday", gloss: { en: "the only day the arguing pauses", ja: "口論が唯一止まる日" } },
  ],
  handles: [
    "number9_ren", "benchcam_yu", "kimuraruns", "souta_left", "the_kitman", "aoi_offside",
    "hase_matchday", "rui_kneeup", "tomoya_late", "mizuki_gk", "kenta_captain", "yuu_stands",
  ],
  pressHandle: "thetouchline",
  names: "modern",
};

const FANTASY: GenrePack = {
  genre: "fantasy",
  titleWord: { en: "Guild", ja: "ギルド" },
  platformName: "THE BOARD",
  conceit: {
    en: `THE BOARD is a sending-stone network the guild set up for contracts and immediately lost control of. Messages are short because sending costs, replies stack under them, and everyone writes as if the guild council is reading, because it is.`,
    ja: `THE BOARD は、ギルドが依頼のために組んだ通信石の網で、すぐに統制を失った。送信に金がかかるので文は短く、返信はその下に積み上がる。全員が「評議会に読まれている前提」で書く。実際に読まれている。`,
  },
  setting: {
    en: `The deep road opened again this spring and the guild has more contracts than people who come back from them. The player cleared a floor that a better-funded party had walked away from, which is either luck or a problem, and the hall has not decided which. Reputation here is a ledger: what you did, who saw it, and who is willing to say so out loud.`,
    ja: `今年の春、深層路がまた開いた。ギルドは依頼を抱えきれず、そこから戻ってくる人間の方が足りない。プレイヤーは、資金の潤沢なパーティが引き返した階層を踏破した。運か、面倒事か、ホールはまだ決めかねている。ここでの評判は帳簿だ。何をしたか、誰が見ていたか、誰がそれを声に出して言うか。`,
  },
  words: {
    en: {
      world: "the guild", craft: "a contract", crafts: "contracts", make: "clear a floor",
      room: "the guild hall", stage: "the deep road", metric: "marks", board: "the notice board",
      boss: "the guild council", crowd: "the hall", rival: "the other party", item: "a torn map",
      night: "the descent", whisper: "a tavern rumour",
    },
    ja: {
      world: "ギルド", craft: "依頼", crafts: "依頼", make: "階層を踏破する",
      room: "ギルドホール", stage: "深層路", metric: "評点", board: "掲示板",
      boss: "ギルド評議会", crowd: "ホール", rival: "別のパーティ", item: "破れた地図",
      night: "潜行の夜", whisper: "酒場の噂",
    },
  },
  places: [
    { name: { en: "The Notice Wall", ja: "掲示壁" }, note: { en: "contracts pinned by price. The cheap ones are cheap for a reason", ja: "報酬順に貼られた依頼。安いものには安い理由がある" } },
    { name: { en: "The Third Stair", ja: "第三階梯" }, note: { en: "the floor everyone survives, until somebody does not", ja: "全員が生きて戻る階層。誰かが戻らなくなるまでは" } },
    { name: { en: "The Salt Lantern", ja: "塩のランタン亭" }, note: { en: "the tavern where parties are formed and dissolved before dawn", ja: "夜明け前にパーティが組まれ、解散する酒場" } },
    { name: { en: "The Council Room", ja: "評議の間" }, note: { en: "warm, panelled, and where marks are quietly adjusted", ja: "暖かく板張りで、評点が静かに書き換えられる部屋" } },
  ],
  factions: [
    { name: { en: "The Council", ja: "評議会" }, blurb: { en: "they issue the contracts and the marks. They protect the guild's name before any member's life.", ja: "依頼と評点を出す側。会員の命よりギルドの名を先に守る。" } },
    { name: { en: "The Hall", ja: "ホール" }, blurb: { en: "working parties. Generous with rope, merciless about who takes credit for a floor.", ja: "現場のパーティたち。縄には気前が良く、階層の手柄には容赦がない。" } },
    { name: { en: "The Salt Lantern Crowd", ja: "塩のランタンの連中" }, blurb: { en: "veterans, quitters and cartographers. They know what is actually down there.", ja: "古参、引退者、地図描き。下に本当は何があるかを知っている。" } },
  ],
  slang: [
    { term: "marks", gloss: { en: "the guild's rating of you. Public, adjustable, never explained", ja: "ギルドが付ける評点。公開、可変、説明なし" } },
    { term: "roped", gloss: { en: "brought along on a contract above your grade", ja: "格上の依頼に連れて行かれること" } },
    { term: "walked", gloss: { en: "abandoned a contract. Legal, and never forgotten", ja: "依頼を放棄した。規則上は合法で、永遠に忘れられない" } },
    { term: "deep", gloss: { en: "past the third stair. Used as an adjective for people too", ja: "第三階梯より下。人を形容する語としても使う" } },
    { term: "clean run", gloss: { en: "everyone came back. Rarer than the board admits", ja: "全員が戻った潜行。掲示板が認めるより稀" } },
    { term: "the ledger", gloss: { en: "what the hall remembers about you, whatever the council wrote", ja: "評議会の記録とは別に、ホールが覚えているあなたの履歴" } },
    { term: "lantern price", gloss: { en: "what a rumour costs at the tavern", ja: "酒場で噂に付く値段" } },
    { term: "torchbearer", gloss: { en: "the one who goes first. An honour and a job nobody wants", ja: "先頭を行く者。名誉であり、誰もやりたがらない役" } },
  ],
  handles: [
    "brannvane", "ossuarykit", "meriwynn", "thorn_of_ash", "cass_lantern", "dagger_no6",
    "ilva_maps", "rookwarden", "greymarch", "penny_torch", "sable_orrin", "vex_hollow",
  ],
  pressHandle: "theguildcrier",
  names: "arcane",
};

const MYSTERY: GenrePack = {
  genre: "mystery",
  titleWord: { en: "Case", ja: "事件" },
  platformName: "THE PARISH",
  conceit: {
    en: `THE PARISH is the town's message board: lost cats, bus times, and — since the storm — one thread that will not die. Posts are short, replies stack, and everyone knows exactly who is behind each account whatever name they used.`,
    ja: `THE PARISH は町の掲示板。迷い猫、バスの時刻、そして嵐の夜以来、死なないスレッドが1本。投稿は短く、返信は積み上がり、どんな名前を使っていても、誰がそのアカウントかは全員が知っている。`,
  },
  setting: {
    en: `Something happened on the night of the storm and the official version has three sentences in it that do not fit together. The player posted a photograph of the harbour road at the wrong time, which they did not think was interesting, and four people have now asked them about it privately. The town is friendly. The town is also watching.`,
    ja: `嵐の夜に何かが起きて、公式の説明には、どうしても噛み合わない三つの文がある。プレイヤーは、大したことだと思わずに港の道の写真を上げた。時刻が悪かった。以来、4人が個別に連絡してきている。町は親切だ。そして町は見ている。`,
  },
  words: {
    en: {
      world: "the town", craft: "a lead", crafts: "leads", make: "close the case",
      room: "the back room", stage: "the inquest", metric: "tips", board: "the pin board",
      boss: "the constabulary", crowd: "the town", rival: "the other thread", item: "a photograph nobody took",
      night: "the night of the storm", whisper: "an anonymous message",
    },
    ja: {
      world: "町", craft: "手がかり", crafts: "手がかり", make: "事件を閉じる",
      room: "奥の部屋", stage: "審問", metric: "通報", board: "ピンボード",
      boss: "警察", crowd: "町の人", rival: "別のスレッド", item: "誰も撮っていない写真",
      night: "嵐の夜", whisper: "匿名のメッセージ",
    },
  },
  places: [
    { name: { en: "The Harbour Road", ja: "港の道" }, note: { en: "one camera, pointed at the wrong wall since 2019", ja: "カメラが1台。2019年からずっと違う壁を向いている" } },
    { name: { en: "The Arcade", ja: "アーケード" }, note: { en: "half the shutters down, all of the town's conversations", ja: "シャッターは半分下りていて、町の会話は全部ここ" } },
    { name: { en: "The Old Library", ja: "旧図書館" }, note: { en: "the records room, and the only working scanner", ja: "資料室。そして町で唯一動くスキャナー" } },
    { name: { en: "The Station Office", ja: "駐在所" }, note: { en: "two officers, one of whom answers questions", ja: "警官が2人。質問に答えるのはそのうち1人" } },
  ],
  factions: [
    { name: { en: "The Thread", ja: "スレッド" }, blurb: { en: "the amateur investigators. Sometimes right, frequently loud, occasionally dangerous to a real person.", ja: "素人の調査班。時々正しく、たいてい騒がしく、時に実在の人物を傷つける。" } },
    { name: { en: "The Station", ja: "駐在所" }, blurb: { en: "official, slow, and holding back exactly one detail for reasons of their own.", ja: "公式で、遅く、自分たちの理由で一つだけ情報を伏せている。" } },
    { name: { en: "The Old Families", ja: "古い家" }, blurb: { en: "here four generations. They would rather this stayed a small story.", ja: "四代続く家々。この話は小さいままであってほしいと思っている。" } },
  ],
  slang: [
    { term: "the thread", gloss: { en: "the main investigation post. Two thousand replies and counting", ja: "本スレ。返信2千件、まだ伸びている" } },
    { term: "timestamped", gloss: { en: "proved by when it was posted, not by what it says", ja: "内容ではなく投稿時刻で裏が取れている状態" } },
    { term: "the official line", gloss: { en: "what the station said. Said with a pause before it", ja: "駐在所の公式見解。言う前に一拍置かれる" } },
    { term: "a nothing", gloss: { en: "a lead the thread has already killed", ja: "スレッドが既に潰した手がかり" } },
    { term: "harbour hours", gloss: { en: "anything between 11pm and 4am", ja: "23時から4時までの時間帯" } },
    { term: "receipts", gloss: { en: "the photograph, the log, the paper. Screenshots do not count here", ja: "写真、記録、紙。ここではスクショは証拠に入らない" } },
    { term: "named", gloss: { en: "when the thread decides who it was. Rarely reversible", ja: "スレッドが犯人を決めた状態。ほぼ取り消せない" } },
    { term: "quiet week", gloss: { en: "the week before someone finds something", ja: "誰かが何かを見つける直前の週" } },
  ],
  handles: [
    "marlow_pins", "edda_notes", "cliff_by_sea", "hattie_calls", "oz_thelibrary", "nell_arcade",
    "vera_records", "sam_thediner", "ida_onfoot", "gus_scanner", "june_yardsale", "perry_late",
  ],
  pressHandle: "thecountyline",
  names: "modern",
};

const SLICE: GenrePack = {
  genre: "slice_of_life",
  titleWord: { en: "Street", ja: "商店街" },
  platformName: "SHUTTER",
  conceit: {
    en: `SHUTTER started as the shopping street's group order board and became the street itself. People post what they are opening with, who left an umbrella, what the weather did to the bread. Nothing is urgent. Everything is remembered.`,
    ja: `SHUTTER は元々、商店街の共同発注ボードだった。今では商店街そのものになっている。今日は何で開けるか、誰が傘を忘れたか、天気がパンに何をしたか。急ぎの用は無い。全部覚えられている。`,
  },
  setting: {
    en: `The street has forty years of habits and a new building going up at the end of it. The player took over a place that had been shut for two years and opened it with a hand-painted sign, which the street has treated as an event. Everyone is being kind. Kindness here comes with an expectation nobody will state out loud.`,
    ja: `商店街には40年ぶんの習慣があり、通りの端には新しいビルが建ちつつある。プレイヤーは2年間閉まっていた店を引き継ぎ、手描きの貼り紙で開けた。通りはそれを事件として扱っている。全員が親切だ。ここでの親切には、誰も口には出さない期待が付いてくる。`,
  },
  words: {
    en: {
      world: "the street", craft: "an evening", crafts: "evenings", make: "get the shutters up",
      room: "the back kitchen", stage: "the summer festival", metric: "regulars", board: "the noticeboard",
      boss: "the landlord", crowd: "the street", rival: "the new place", item: "a handwritten sign",
      night: "the last train", whisper: "a word at the counter",
    },
    ja: {
      world: "商店街", craft: "ひとつの夜", crafts: "夜", make: "シャッターを上げる",
      room: "厨房の奥", stage: "夏祭り", metric: "常連", board: "掲示板",
      boss: "大家", crowd: "通り", rival: "新しい店", item: "手書きの貼り紙",
      night: "終電", whisper: "カウンター越しの一言",
    },
  },
  places: [
    { name: { en: "The Arcade Roof", ja: "アーケードの屋根" }, note: { en: "leaks in two places the whole street can name", ja: "2か所から雨漏りする。全員がその場所を言える" } },
    { name: { en: "The Bath House", ja: "銭湯" }, note: { en: "closes at eleven, decides everything by ten", ja: "11時に閉まり、10時までに全部決まる" } },
    { name: { en: "The Corner Lot", ja: "角の空き地" }, note: { en: "empty two years, and now scaffolded", ja: "2年空いていて、今は足場が組まれている" } },
    { name: { en: "The Bread Shop", ja: "パン屋" }, note: { en: "opens at five, knows everyone's week before they do", ja: "5時開店。本人より先に全員の一週間を知っている" } },
  ],
  factions: [
    { name: { en: "The Association", ja: "商店会" }, blurb: { en: "the shopkeepers' committee. Slow, fair, and allergic to anything new being decided quickly.", ja: "商店主の会。遅く、公平で、新しいことが速く決まるのを嫌う。" } },
    { name: { en: "The Regulars", ja: "常連" }, blurb: { en: "the people who come every week. They are the metric and they know it.", ja: "毎週来る人たち。自分たちが指標であることを自覚している。" } },
    { name: { en: "The Corner Lot", ja: "角の空き地" }, blurb: { en: "the developer, the new tenants, whatever is coming. Not villains. Just faster.", ja: "開発業者、新しい借り手、これから来るもの。悪人ではない。ただ速いだけ。" } },
  ],
  slang: [
    { term: "shutters up", gloss: { en: "open for the day. Also: still going", ja: "今日も開けた、の意。まだやってる、の意でもある" } },
    { term: "regular", gloss: { en: "someone whose order you start before they sit", ja: "座る前に用意を始める人" } },
    { term: "association weather", gloss: { en: "a meeting nobody wants, called about something small", ja: "誰も出たくない、小さな件の会合" } },
    { term: "the roof", gloss: { en: "the arcade repair fund, and the argument attached to it", ja: "アーケードの修繕積立。それに付いてくる口論のこと" } },
    { term: "counter talk", gloss: { en: "what gets said sideways while somebody pays", ja: "会計しながら横向きに交わされる話" } },
    { term: "last train", gloss: { en: "the deadline that ends every evening here", ja: "この街のすべての夜を終わらせる締切" } },
    { term: "handwritten", gloss: { en: "sincere, cheap, and slightly embarrassing. A compliment", ja: "誠実で、安上がりで、少し気恥ずかしい。褒め言葉" } },
    { term: "two doors down", gloss: { en: "how everyone refers to a rival without saying a name", ja: "名前を出さずに競合を指すときの言い方" } },
  ],
  handles: [
    "shutter_six", "obaachan_ko", "yamane_bread", "kei_lateshift", "nana_counter", "tofu_tues",
    "mariko_walks", "haru_bicycle", "sen_thebath", "aki_gardening", "toru_karaoke", "emi_thepost",
  ],
  pressHandle: "thewardnotice",
  names: "modern",
};

export const GENRE_PACKS: Readonly<Record<WorldGenre, GenrePack>> = {
  fame: FAME,
  academy: ACADEMY,
  idol: IDOL,
  office: OFFICE,
  sports: SPORTS,
  fantasy: FANTASY,
  mystery: MYSTERY,
  slice_of_life: SLICE,
};

export function packFor(genre: WorldGenre): GenrePack {
  return GENRE_PACKS[genre] ?? FAME;
}

/** Invented names only — never a real person. Two pools so an academy does not sound like a league. */
export const NAME_POOLS: Readonly<Record<GenrePack["names"], readonly string[]>> = {
  modern: [
    "Bea Solano", "Nico Vale", "Mira Okada", "Dax Aworan", "Junie Park", "Cass Whitmore",
    "Rio Tamm", "Ines Berger", "Toma Ishii", "Priya Nandal", "Lev Ostrand", "Ada Marchetti",
    "Sena Kuroi", "Felix Ndiaye", "Hana Vogel", "Ossie Lund", "Wren Baptiste", "Kai Fontaine",
  ],
  arcane: [
    "Bellwether Quill", "Ivo Ashgrove", "Noctarine Vay", "Sable Riddle", "Primrose Kell",
    "Orrin Thornby", "Marrow Vex", "Lampwick Grey", "Mirabel Ash", "Corvid Nine",
    "Hollis Fen", "Perrine Slate", "Anselm Rook", "Vesper Loom", "Tamsin Brack", "Odile Marsh",
  ],
};

/** Filled into every template. Keys are stable; a missing key is left as-is, never blank. */
export type FillContext = Readonly<Record<string, string>>;

const SLOT_RE = /\{([a-z0-9_]+)\}/gi;

/** `{craft}` -> ctx.craft. Unknown slots survive verbatim so a typo is visible in a test, not silent. */
export function fill(template: string, ctx: FillContext): string {
  return template.replace(SLOT_RE, (whole, key: string) => ctx[key] ?? whole);
}

/** The word context for one locale: every `GenreWords` field plus the world's own nouns. */
export function wordsOf(pack: GenrePack, locale: Locale): GenreWords {
  return pack.words[locale];
}
