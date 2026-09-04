import type { WorldSeed } from "@rpgllm/shared";
import { buildWorld, type WorldSource } from "./build.js";
import { cast, outro, prose } from "./popstar-era.bible.js";

/**
 * popstar-era (difficulty 2) — press account @thescoop.
 * First-follower candidates: @hivequeenbea, @ninaonmain, @dexlowkey, @rioflashes,
 * @critchriswen, @lunaeight.
 */
const source: WorldSource = {
  slug: "popstar-era",
  difficulty: 2,
  title: { en: "Popstar Era", ja: "ポップスター・エラ" },
  scenario: {
    en: "One song blew up. Now the label, the press and ten thousand fans all want a different version of you.",
    ja: "1曲だけがバズった。レーベルも、press も、1万人のファンも、それぞれ違うあなたを求めている。",
  },
  prose,
  outro,
  cast,

  presetPersonas: [
    {
      handle: "@hivequeen",
      displayName: { en: "Hive", ja: "ハイヴ" },
      bio: {
        en: "came for the bridge, stayed for the drama. i organise things.",
        ja: "ブリッジ目当てで来て、ドラマで居座った。企画する人。",
      },
      avatarKey: "pop-persona-hive",
    },
    {
      handle: "@sixdrey",
      displayName: { en: "Six Drey", ja: "シックス・ドレイ" },
      bio: {
        en: "six songs, no album, one very expensive haircut.",
        ja: "6曲、アルバムなし、やたら高い髪型1つ。",
      },
      avatarKey: "pop-persona-six",
    },
    {
      handle: "@ari",
      displayName: { en: "Ari", ja: "アリ" },
      bio: {
        en: "whisper-singer. i will not be belting. ever.",
        ja: "囁き系。張り上げません。一生。",
      },
      avatarKey: "pop-persona-ari",
    },
    {
      handle: "@taytay19",
      displayName: { en: "Tay", ja: "テイ" },
      bio: {
        en: "writes everything herself, allegedly. sheldon row alum.",
        ja: "全曲自作、らしい。シェルドン・ロウ出身。",
      },
      avatarKey: "pop-persona-tay",
    },
    {
      handle: "@dune",
      displayName: { en: "Dune", ja: "デューン" },
      bio: {
        en: "synths, sunglasses, silence. the album is done.",
        ja: "シンセ、サングラス、沈黙。アルバムはもう出来ている。",
      },
      avatarKey: "pop-persona-dune",
    },
    {
      handle: "@jbsorry",
      displayName: { en: "JB", ja: "ジェイビー" },
      bio: {
        en: "apologising in the key of C. tour starts whenever.",
        ja: "ハ長調で謝罪中。ツアーはそのうち。",
      },
      avatarKey: "pop-persona-jb",
    },
    {
      handle: "@kingkay",
      displayName: { en: "Kay", ja: "ケイ" },
      bio: {
        en: "i said what i said and then i said it louder.",
        ja: "言ったことは言った。そのあともう一回大きい声で言った。",
      },
      avatarKey: "pop-persona-kay",
    },
  ],

  presetEvents: [
    {
      title: { en: "The Leaked Demo", ja: "流出したデモ" },
      prompt: {
        en: "An unfinished demo from the Vellum B room is on every feed by lunchtime. It is rough, honest, and better than anything on the release plan. @paulamanages wants a takedown. @dexlowkey has not said a word.",
        ja: "ヴェラムBルームの未完成デモが昼前には全フィードに乗っている。粗くて、正直で、リリース計画のどの曲より良い。@paulamanages は削除申請したがっている。@dexlowkey は何も言っていない。",
      },
      choices: [
        {
          label: { en: "Post it yourself, finished or not", ja: "未完成のまま自分で出す" },
          outcomeText: {
            en: "You put the demo up with three words: 'it's not done'. The Hive treats it like a gift. Legal treats it like a fire. By evening it is the most-quoted thing you have ever made.",
            ja: "「まだ途中」の一言を添えてデモを上げた。ハイヴは贈り物として受け取り、法務は火事として扱った。夜には、これまでで最も引用された自分の音になっていた。",
          },
          statDeltas: { followers: 9, aura: 4, humor: 0 },
        },
        {
          label: { en: "Let the label take it down", ja: "レーベルに削除させる" },
          outcomeText: {
            en: "The takedown lands in an hour. So does the screenshot of the takedown. The song survives anyway, in worse quality, with your name on the wrong side of it.",
            ja: "削除は1時間で通った。削除通知のスクショも1時間で回った。曲はどのみち生き残った。音質だけ落ちて、あなたの名前は間違った側に置かれたまま。",
          },
          statDeltas: { followers: -3, aura: -4, humor: 0 },
        },
        {
          label: { en: "Say nothing and post a photo of the mixing desk", ja: "何も言わず卓の写真だけ上げる" },
          outcomeText: {
            en: "No comment, one photo, faders half up. @rioflashes quote-posts it with 'shot it, not posting it' and the whole feed decides you are unbothered. You are not unbothered.",
            ja: "コメントなし、写真1枚、フェーダーは半分。@rioflashes が「撮ったけど出さない」と引用し、フィード全体が「余裕だ」と判断した。余裕ではない。",
          },
          statDeltas: { followers: 2, aura: 5, humor: 2 },
        },
      ],
    },
    {
      title: { en: "The Seating Chart", ja: "座席表" },
      prompt: {
        en: "The Ledger Awards seating chart leaks. You are two rows behind @ninaonmain and directly in front of a camera. @thescoop has already written the headline.",
        ja: "レジャー・アワードの座席表が漏れた。あなたは @ninaonmain の2列後ろ、カメラの真正面。@thescoop はもう見出しを書いている。",
      },
      choices: [
        {
          label: { en: "Post the chart with one dry line", ja: "座席表に一行だけ添えて投稿する" },
          outcomeText: {
            en: "'two rows is two rows.' It gets quoted four thousand times before the ceremony. @ninaonmain likes it, which nobody can decode.",
            ja: "「2列は2列」。式典の前に4千回引用された。@ninaonmain がいいねを押した。誰にも解読できない。",
          },
          statDeltas: { followers: 6, aura: 2, humor: 5 },
        },
        {
          label: { en: "Ask your manager to have it fixed", ja: "マネージャーに直させる" },
          outcomeText: {
            en: "You move up one row. The email asking for it moves further than you did. @paulamanages is proud of you and nobody else is.",
            ja: "1列前に移動した。移動を頼んだメールの方が、あなたより遠くまで移動した。@paulamanages は満足し、他の誰も満足しなかった。",
          },
          statDeltas: { followers: 0, aura: -5, humor: -2 },
        },
        {
          label: { en: "Ignore it and post about the support act", ja: "無視して前座の話をする" },
          outcomeText: {
            en: "You spend your one viral hour recommending a band nobody has heard of. Three of the four people who mattered noticed. The band sells out a room in Sheldon Row.",
            ja: "バズる1時間を、誰も知らないバンドの紹介に使った。重要な4人のうち3人がそれに気づいた。そのバンドはシェルドン・ロウの小箱を売り切った。",
          },
          statDeltas: { followers: -1, aura: 7, humor: 1 },
        },
      ],
    },
    {
      title: { en: "The Loyalty Test", ja: "踏み絵" },
      prompt: {
        en: "The label wants a feature with an artist the Hive has publicly hated for two years. The money is real. @hivequeenbea has not posted since the rumour started.",
        ja: "レーベルが、ハイヴが2年間公然と嫌ってきたアーティストとの客演を求めている。金額は本物。噂が出てから @hivequeenbea は一度も投稿していない。",
      },
      choices: [
        {
          label: { en: "Take the feature and say why", ja: "受けて、理由をちゃんと言う" },
          outcomeText: {
            en: "You explain the decision in four sentences with no apology in them. Half the Hive accepts it. The other half writes a thread. @dexlowkey replies 'that's the record' and that carries more weight than it should.",
            ja: "謝罪を1つも入れずに4文で説明した。ハイヴの半分は納得し、半分は連投を書いた。@dexlowkey が「それがレコードだよ」と返し、その一言が不相応な重さを持った。",
          },
          statDeltas: { followers: 7, aura: -2, humor: 0 },
        },
        {
          label: { en: "Turn it down publicly", ja: "公に断る" },
          outcomeText: {
            en: "You post 'not this one' and nothing else. The Hive treats it as a coronation. Somewhere a spreadsheet gets a red cell with your name in it.",
            ja: "「これは違う」とだけ投稿した。ハイヴはそれを戴冠式として扱った。どこかのスプレッドシートで、あなたの名前の入ったセルが赤くなった。",
          },
          statDeltas: { followers: 4, aura: 8, humor: 0 },
        },
        {
          label: { en: "Stall until someone decides for you", ja: "誰かが決めるまで引き延ばす" },
          outcomeText: {
            en: "You say nothing for three days. On the fourth, @thescoop reports that the feature is off, sourced to 'the artist's camp'. You did not tell anyone that. Somebody did.",
            ja: "3日間何も言わなかった。4日目、@thescoop が「アーティスト側の関係者」を情報源に客演の中止を報じた。あなたは誰にも言っていない。誰かが言った。",
          },
          statDeltas: { followers: -2, aura: -3, humor: -1 },
        },
      ],
    },
    {
      title: { en: "The Bad Review", ja: "酷評" },
      prompt: {
        en: "@critchriswen's newsletter calls your last three songs 'a great artist doing an impression of a bigger one'. It is well argued. It is also, annoyingly, mostly right.",
        ja: "@critchriswen のニュースレターが、直近3曲を「素晴らしいアーティストが、より大きい誰かの物真似をしている」と評した。論理は通っている。そして腹立たしいことに、だいたい当たっている。",
      },
      choices: [
        {
          label: { en: "Quote it and agree", ja: "引用して同意する" },
          outcomeText: {
            en: "'yeah. the third one especially.' The feed does not know what to do with an artist who agrees. @critchriswen writes 900 more words, this time about you being interesting.",
            ja: "「うん。特に3曲目」。同意するアーティストの扱い方をフィードは知らなかった。@critchriswen はさらに900字書いた。今度は「あなたが面白い」という話で。",
          },
          statDeltas: { followers: 3, aura: 7, humor: 3 },
        },
        {
          label: { en: "Fight it line by line", ja: "一行ずつ反論する" },
          outcomeText: {
            en: "Eleven replies deep, you are winning the argument and losing the week. @lunaeight sends 'log off' to the group chat. You do not log off.",
            ja: "返信11個目、議論には勝っていて、その週には負けている。@lunaeight がグループに「落ちな」と送った。落ちなかった。",
          },
          statDeltas: { followers: 5, aura: -6, humor: -3 },
        },
        {
          label: { en: "Post the unreleased song instead", ja: "代わりに未発表曲を上げる" },
          outcomeText: {
            en: "No response, just 40 seconds of something nobody has heard. It is not an answer to the review. It is a better answer than the review deserved.",
            ja: "反論なし。誰も聴いたことのない40秒だけ。レビューへの回答ではない。レビューが値する以上の回答だった。",
          },
          statDeltas: { followers: 8, aura: 5, humor: 0 },
        },
      ],
    },
    {
      title: { en: "Sheldon Row Calls", ja: "シェルドン・ロウからの電話" },
      prompt: {
        en: "The 200-cap room above the laundromat is closing. They want you for the last night, for the same fee they paid you two years ago. It is the same night as a festival slot.",
        ja: "コインランドリーの上のキャパ200のハコが閉まる。最終日に出てほしいと言われた。ギャラは2年前と同額。同じ日にフェスの出番が入っている。",
      },
      choices: [
        {
          label: { en: "Play the last night", ja: "最終日に出る" },
          outcomeText: {
            en: "You cancel a festival and play to two hundred people for eighty dollars. @rioflashes shoots it and posts one frame. It is the picture everyone uses for the next two years.",
            ja: "フェスをキャンセルし、80ドルで200人の前に立った。@rioflashes が撮り、一枚だけ上げた。それが以後2年、全員が使う写真になった。",
          },
          statDeltas: { followers: 4, aura: 9, humor: 1 },
        },
        {
          label: { en: "Take the festival, send a video message", ja: "フェスを取り、映像メッセージを送る" },
          outcomeText: {
            en: "The video plays between sets. It is kind and it is thirty seconds long and everyone in that room understands exactly what it cost you to send instead of come.",
            ja: "映像は転換中に流れた。優しくて、30秒で、その場の全員が「来る代わりに送った」ことの意味を正確に理解した。",
          },
          statDeltas: { followers: 6, aura: -2, humor: 0 },
        },
        {
          label: { en: "Buy the room", ja: "そのハコを買う" },
          outcomeText: {
            en: "You do not have the money. You say it anyway, out loud, on the feed. Now four people are trying to make it true and @paulamanages is calling.",
            ja: "そんな金はない。それでも公に、フィードで言ってしまった。今、4人がそれを本当にしようと動いていて、@paulamanages から着信が来ている。",
          },
          statDeltas: { followers: 11, aura: 3, humor: 6 },
        },
      ],
    },
  ],

  fallbackReplies: {
    "@hivequeenbea": {
      en: ["👀", "ok noted", "the way you just said that", "we move", "i'm not normal about this"],
      ja: ["👀", "了解", "まってその言い方", "進むよ", "冷静ではいられない"],
    },
    "@thescoop": {
      en: ["Developing.", "Noted, per two people familiar.", "File that away.", "No comment from the artist's camp.", "We are told there is more."],
      ja: ["続報あり。", "関係者2名によると、と記録しておく。", "覚えておくといい。", "アーティスト側のコメントはなし。", "まだ続きがあると聞いている。"],
    },
    "@ninaonmain": {
      en: ["cute.", "interesting choice", "sure.", "we'll see", "i've heard the demo"],
      ja: ["かわいいね。", "面白い選択", "そう。", "見てましょ", "デモは聴いた"],
    },
    "@dexlowkey": {
      en: ["leave it in", "come by the b room", "that's the record", "honestly? fine", "the bridge though"],
      ja: ["そこは残そう", "Bルーム来なよ", "それがレコードだよ", "正直、悪くない", "ブリッジはね"],
    },
    "@rioflashes": {
      en: ["i have the frame", "from where i was standing, different story", "shot it, not posting it", "same jacket", "you were smiling before the flash"],
      ja: ["その一枚は持ってる", "俺の立ち位置からは別の話", "撮ったけど出さない", "同じ上着", "フラッシュの前は笑ってた"],
    },
    "@paulamanages": {
      en: ["call me", "let's park that", "team is aligned", "we love the energy", "i'm going to say this once"],
      ja: ["電話ちょうだい", "それは一旦置こう", "チームの認識は揃ってる", "熱量はすごくいい", "一度だけ言うね"],
    },
    "@critchriswen": {
      en: ["respectfully,", "i want to be wrong about this", "that's a bridge, not a chorus", "the thing about this is", "three good songs is an album"],
      ja: ["敬意を込めて言うが、", "間違っていたい", "それはブリッジであってサビではない", "これについて言うと", "良い曲が3曲あればアルバムだ"],
    },
    "@lunaeight": {
      en: ["BYE", "hello???", "the eight-count doesn't lie", "we're so back", "stop being weird"],
      ja: ["は?", "え待って???", "8カウントは嘘つかない", "復活じゃん", "変なことしないで"],
    },
  },

  welcomePosts: {
    "@hivequeenbea": {
      en: "ok everyone. new account, real one, i checked. i've been saying this since sheldon row and nobody listened so i'm saying it louder now. follow them. that's the post.",
      ja: "はい全員集合。新しいアカウント、本物、確認済み。シェルドン・ロウの頃から言ってて誰も聞かなかったから、今もっと大きい声で言う。フォローして。以上。",
    },
    "@ninaonmain": {
      en: "so you're really doing this. good. i'll be watching the second single, not the first one.",
      ja: "本当にやるんだ。いいと思う。私が見るのは1stじゃなくて2ndの方だから。",
    },
    "@dexlowkey": {
      en: "for anyone new here: i've heard what's coming and the b room door is open on tuesdays. that's all i'm saying.",
      ja: "初めての人へ。これから出るやつは聴いた。Bルームの扉は火曜なら開いてる。言えるのはそれだけ。",
    },
    "@rioflashes": {
      en: "shot this one at sheldon row for forty dollars two years ago. still have the negatives. still the best room i've been in.",
      ja: "2年前、シェルドン・ロウで40ドルで撮った。ネガはまだ持ってる。今でも一番いい部屋だった。",
    },
    "@paulamanages": {
      en: "Delighted to be working with a artist this focused. Big year ahead. Team is aligned.",
      ja: "これだけ芯のあるアーティストと組めて嬉しいです。大きな一年になります。チームの認識は揃っています。",
    },
    "@critchriswen": {
      en: "respectfully, this is the most promising thing i've heard this year and structurally a mess. i want to be wrong about the second half of that.",
      ja: "敬意を込めて言うが、今年聴いた中で最も有望で、構造は破綻している。後半については間違っていたい。",
    },
    "@lunaeight": {
      en: "BYE they made an account. i've been in every rehearsal room this person has ever cried in. we're so back",
      ja: "は?アカウント作ってる。この人が泣いたリハ室、全部一緒にいたんだけど。復活じゃん",
    },
    "@thescoop": {
      en: "SOURCES SAY: a new account has appeared and the usual people are already replying to it. Per two people familiar, that is not an accident.",
      ja: "SOURCES SAY: 新しいアカウントが現れ、いつもの面々がすでに返信している。関係者2名によれば、それは偶然ではない。",
    },
  },

  ambientPool: {
    en: [
      { handle: "@lunaeight", text: "rehearsal room smells like burnt coffee and ambition. mostly burnt coffee" },
      { handle: "@critchriswen", text: "respectfully, the second chorus on that record is doing the work of an entire bridge and nobody is talking about it" },
      { handle: "@thescoop", text: "SOURCES SAY: two Ledger Awards performers are refusing to be scheduled back to back. Per two people familiar, neither will say why." },
      { handle: "@dexlowkey", text: "spent four hours on a snare. it's the same snare. it's better now. i can't explain it" },
      { handle: "@rioflashes", text: "kettle & pine at 4am, three separate careers at three separate tables, all pretending not to see each other" },
      { handle: "@ninaonmain", text: "people keep asking about the third album. the third album is fine. next question." },
      { handle: "@hivequeenbea", text: "i need everyone to be normal about the tracklist leak. i will not be normal about it. do as i say" },
      { handle: "@paulamanages", text: "Proud of this team today. More news soon." },
      { handle: "@lunaeight", text: "hello??? who put a 7/8 bar in the middle of a pop song. i'm counting out loud in a lift like a lunatic" },
      { handle: "@critchriswen", text: "the thing about a comeback single is that it has to be a good song first and a comeback second. this order is not optional" },
      { handle: "@rioflashes", text: "photographed a sold out room from the back tonight. the good picture was always going to be the back" },
      { handle: "@thescoop", text: "SOURCES SAY: the Aquamarine has quietly released a second block of tickets. We are told the first block did not sell out." },
      { handle: "@dexlowkey", text: "if the demo makes you feel something and the master doesn't, the master is wrong. that's not a hot take, it's just tuesday" },
      { handle: "@ninaonmain", text: "someone sub-posted me at 2am and deleted it at 2:04. i have the screenshot and no interest." },
      { handle: "@hivequeenbea", text: "four minutes to decode that post. four. we are unwell and we are efficient" },
      { handle: "@lunaeight", text: "the choreo eats. the shoes do not. pray for my ankles" },
      { handle: "@critchriswen", text: "three good songs is an album. eleven fine songs is a content strategy. i'll die on this hill" },
      { handle: "@rioflashes", text: "someone asked me to delete a frame today and i did. that's the whole job actually" },
      { handle: "@thescoop", text: "SOURCES SAY: a Vellum session ran until 6am on Sunday. No one involved has posted since." },
      { handle: "@paulamanages", text: "Reminder that tickets for the spring dates go on sale Friday. Set an alarm, team." },
      { handle: "@dexlowkey", text: "the take with the mistake in it is the take. put it out. stop calling me" },
      { handle: "@ninaonmain", text: "congrats to everyone pretending they liked that song before this week." },
      { handle: "@hivequeenbea", text: "receipts are in the quotes. i'm not doing this in the replies again" },
      { handle: "@lunaeight", text: "we're so back. i don't know from what. we're back" },
    ],
    ja: [
      { handle: "@lunaeight", text: "リハ室、焦げたコーヒーと野心の匂い。ほぼ焦げたコーヒー" },
      { handle: "@critchriswen", text: "敬意を込めて言うが、あのレコードの2番のサビはブリッジ1本分の仕事をしていて、誰もその話をしていない" },
      { handle: "@thescoop", text: "SOURCES SAY: レジャー・アワードの出演者2組が連続の出番を拒否している。関係者2名によれば、どちらも理由を語らない。" },
      { handle: "@dexlowkey", text: "スネアに4時間かけた。同じスネアだよ。でも良くなった。説明はできない" },
      { handle: "@rioflashes", text: "朝4時のケトル&パイン。別々のテーブルに別々のキャリアが3つ、互いに気づいてないふりをしてる" },
      { handle: "@ninaonmain", text: "3枚目について何度も訊かれる。3枚目は問題ない。次の質問。" },
      { handle: "@hivequeenbea", text: "曲順の流出について全員落ち着いて。私は落ち着かない。言う通りにして" },
      { handle: "@paulamanages", text: "今日のチームを誇りに思います。近日中にお知らせがあります。" },
      { handle: "@lunaeight", text: "え待って???ポップスの真ん中に7/8入れたの誰。エレベーターで声出して数えてる不審者になってる" },
      { handle: "@critchriswen", text: "復帰シングルについて言うと、まず良い曲であり、そのあとで復帰であるべきだ。この順番は交渉不可" },
      { handle: "@rioflashes", text: "今夜、満員の客席を後ろから撮った。良い一枚は最初から後ろにあった" },
      { handle: "@thescoop", text: "SOURCES SAY: アクアマリンが静かに2次販売分を出した。1次は売り切れなかったと聞いている。" },
      { handle: "@dexlowkey", text: "デモで心が動いてマスターで動かないなら、間違ってるのはマスター。過激な意見じゃなくてただの火曜日" },
      { handle: "@ninaonmain", text: "深夜2時に匂わせされて2時4分に消された。スクショはあるし興味はない。" },
      { handle: "@hivequeenbea", text: "あの投稿の解読に4分。4分。病んでるし有能" },
      { handle: "@lunaeight", text: "振りは強い。靴は弱い。足首の無事を祈って" },
      { handle: "@critchriswen", text: "良い曲が3曲あればアルバムだ。まあまあが11曲あるのはコンテンツ戦略だ。ここは譲れない" },
      { handle: "@rioflashes", text: "今日、一枚消してくれと頼まれて消した。実はそれが仕事の全部なんだよな" },
      { handle: "@thescoop", text: "SOURCES SAY: 日曜のヴェラムのセッションは朝6時まで続いた。関係者は誰も以後投稿していない。" },
      { handle: "@paulamanages", text: "春公演のチケットは金曜発売です。アラームを設定してください、チーム。" },
      { handle: "@dexlowkey", text: "ミスが入ってるテイクが正解のテイク。出しなよ。電話してこないで" },
      { handle: "@ninaonmain", text: "今週より前からあの曲が好きだったふりをしている全員におめでとう。" },
      { handle: "@hivequeenbea", text: "レシートは引用に置いた。返信欄でもう一回やるつもりはない" },
      { handle: "@lunaeight", text: "復活じゃん。何からかは知らない。復活" },
    ],
  },
};

export const popstarEra: WorldSeed = buildWorld(source);
export default popstarEra;
