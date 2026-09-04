import type { WorldFixture } from "./types.js";

/** Replay fixtures for popstar-era. Bucket order: hype, shade, curious, deadpan, worry, chaos. */
export const popstarEraFixture: WorldFixture = {
  characters: {
    "@hivequeenbea": {
      replies: {
        en: [
          ["👀 ok this is the one", "i need everyone to be normal about this. i will not be", "not me screaming in a stairwell over a post"],
          ["mm. we're pretending that was on purpose", "i've read this four times and i have notes", "the way you just said that and thought we wouldn't clock it"],
          ["ok but what does 'soon' mean here. give me a month", "wait is this the thing from the b room or a different thing", "explain the second half. i'll wait"],
          ["noted", "sure. archived.", "we move"],
          ["hey. are you good. genuinely", "posting at this hour is a choice and i'm watching it", "i'm not going to say anything. i'm just here"],
          ["ok EVERYONE off the timeline, we're organising", "receipts are in the quotes, i'm not doing this in replies again", "i have a spreadsheet and i'm not sorry"],
        ],
        ja: [
          ["👀 これだよこれ", "全員落ち着いて。私は落ち着かない", "階段で叫んでるんだけど投稿1つで"],
          ["ふーん。今のわざとってことにするんだ", "4回読んだ。言いたいことがある", "まってその言い方でバレないと思った?"],
          ["「そのうち」って何ヶ月のこと?月で言って", "え、それBルームの話?別の話?", "後半説明して。待つから"],
          ["了解", "うん。保存した。", "進むよ"],
          ["ねえ。大丈夫?ガチで", "この時間に投稿するのは選択だからね。見てるよ", "何も言わない。ここにいるだけ"],
          ["全員タイムラインから降りて、企画するよ", "レシートは引用に置いた。返信欄でもう一回やらない", "スプレッドシートがある。謝らない"],
        ],
      },
      dm: {
        en: [
          ["ok so i saw it", "i'm not going to be weird about it. i am being weird about it"],
          ["👀", "you know i've been saying this since sheldon row right"],
          ["do you want the honest version or the nice version", "ok. honest version then"],
          ["hey. the thread's handled. don't read the quotes tonight"],
          ["i need one thing from you and it's not a favour", "just tell me before the label does. that's it"],
          ["we move. that's all i wanted to say", "go to sleep"],
        ],
        ja: [
          ["見たよ", "変なテンションにならないでおく。もうなってる"],
          ["👀", "シェルドン・ロウの頃から言ってたよね私"],
          ["正直な方と優しい方、どっちがいい", "了解。じゃあ正直な方ね"],
          ["ねえ。あのスレッドは処理した。今夜は引用見ないで"],
          ["1つだけお願いがある。お願いじゃないけど", "レーベルより先に私に言って。それだけ"],
          ["進むよ。それだけ言いたかった", "もう寝な"],
        ],
      },
      memory: {
        en: ["defended them publicly before the label did", "asked to hear things first, not last", "was in a stairwell about the bridge"],
        ja: ["レーベルより先に公で庇った", "最後ではなく最初に知らせてほしいと言った", "ブリッジのことで階段にいた"],
      },
    },

    "@thescoop": {
      replies: {
        en: [
          ["SOURCES SAY: this is the most-quoted post of the week. Per two people familiar, that was the point.", "Noted, and timed well. We are told the timing was not an accident.", "Developing. The numbers moved before the post did."],
          ["SOURCES SAY: a version of this was denied on Tuesday. File that away.", "No comment from the artist's camp — yet. There was one on Tuesday.", "We are told this is the third framing of the same week."],
          ["SOURCES SAY: two people close to the session tell a different story about the same night.", "Developing. Nobody has said which room this happened in.", "We are told there is a longer version of this. We would like it."],
          ["Noted.", "Developing.", "File that away."],
          ["SOURCES SAY: the artist's team was not informed before this went up. No comment.", "We are told a call followed within the hour. It was not a happy call.", "Developing. This is the second post today from an account that usually posts weekly."],
          ["SOURCES SAY: the quote-posts have outpaced the likes by four to one.", "Per two people familiar, the replies are the story now.", "Developing, loudly."],
        ],
        ja: [
          ["SOURCES SAY: 今週最も引用された投稿である。関係者2名によれば、それが狙いだった。", "記録しておく。時機も良い。偶然ではないと聞いている。", "続報あり。数字は投稿より先に動いていた。"],
          ["SOURCES SAY: これに近い話は火曜に否定されている。覚えておくといい。", "アーティスト側のコメントは現時点でなし。火曜にはあった。", "同じ一週間について3つ目の説明だと聞いている。"],
          ["SOURCES SAY: セッションに近い2名は同じ夜について別の話をしている。", "続報あり。どの部屋での出来事かは誰も言っていない。", "これには長い版があると聞いている。ぜひ見たい。"],
          ["記録しておく。", "続報あり。", "覚えておくといい。"],
          ["SOURCES SAY: 掲載前にアーティスト側への連絡はなかった。コメントなし。", "1時間以内に電話があったと聞いている。楽しい電話ではなかった。", "続報あり。週1回のアカウントから本日2件目である。"],
          ["SOURCES SAY: 引用がいいねを4対1で上回っている。", "関係者2名によれば、いまや本題は返信欄である。", "続報あり。かなり大きな音で。"],
        ],
      },
      dm: {
        en: [["We are told you have a version of this. We would print it."], ["No comment needed. A yes or no is enough."], ["SOURCES SAY nothing yet. That is a courtesy and it expires at six."], ["Developing. You have until the hour."], ["Two people familiar have already spoken. You would be the third."], ["File that away: we ran the kinder version."]],
        ja: [["あなたが別の版を持っていると聞いている。載せる用意がある。"], ["コメントは不要。はいかいいえで足りる。"], ["現時点では何も出していない。これは好意であり、6時に切れる。"], ["続報あり。締切は毎正時。"], ["関係者2名がすでに話している。あなたは3人目になる。"], ["覚えておくといい。こちらは穏当な方を出した。"]],
      },
      memory: {
        en: ["covered them before the mainstream did", "ran the kinder version once", "has a folder of their old posts"],
        ja: ["主流より先に取り上げた", "一度だけ穏当な方を出した", "過去の投稿のフォルダを持っている"],
      },
    },

    "@ninaonmain": {
      replies: {
        en: [
          ["good. that's the first one that sounded like you.", "fine. genuinely fine. don't make me say it twice", "ok. that's a chorus."],
          ["cute.", "interesting choice", "congrats on the discourse."],
          ["who wrote the second verse", "i've heard the demo. is this the same bridge?", "and the tour routing? or are we not saying"],
          ["sure.", "we'll see", "noted."],
          ["you're posting a lot this week.", "this is the part where it gets loud. sleep now, not later", "i've had this exact week. it doesn't end how you think"],
          ["say it louder then", "you'll learn", "put my name in it next time, it'll travel further"],
        ],
        ja: [
          ["いいね。やっと自分の声に聞こえた。", "悪くない。本気で。二度言わせないで", "うん。それはサビだね。"],
          ["かわいいね。", "面白い選択", "話題になっておめでとう。"],
          ["2番の詞は誰が書いたの", "デモは聴いた。ブリッジ同じ?", "ツアーの動線は?それとも言わない話?"],
          ["そう。", "見てましょ", "了解。"],
          ["今週、投稿多いね。", "ここから大きくなる。寝るなら今、あとじゃなくて", "この一週間、私も通った。思ってる終わり方はしない"],
          ["もっと大きい声で言えば?", "そのうちわかる", "次は私の名前入れときな。その方が遠くまで行く"],
        ],
      },
      dm: {
        en: [["The bridge is the problem, not the chorus.", "Don't tell anyone I said that."], ["Interesting choice today. It worked. Once."], ["You'll learn. I'd rather you learned before Sunday."], ["I've had this week. Call your manager before she calls you."], ["Say it louder next time. Half of them didn't hear it."], ["Fine. That was good. Delete this."]],
        ja: [["問題はサビじゃなくてブリッジ。", "私が言ったって言わないで。"], ["今日の選択は面白かった。効いた。1回だけね。"], ["そのうちわかる。日曜より前にわかってほしい。"], ["この一週間は通った。彼女から来る前に電話しな。"], ["次はもっと大きい声で。半分聞こえてなかった。"], ["うん。今のは良かった。これ消して。"]],
      },
      memory: {
        en: ["said the bridge was the problem, privately", "conceded one thing in public, once", "is watching the second single, not the first"],
        ja: ["問題はブリッジだと私的に言った", "公の場で一度だけ認めた", "1stではなく2ndを見ている"],
      },
    },

    "@dexlowkey": {
      replies: {
        en: [
          ["that's the record. leave it", "honestly? that's the take with the mistake in it. good", "ok so here's the thing: that's finished and you know it"],
          ["you're overthinking the bridge again", "that's a demo of a demo. leave it alone for a week", "the second pre-chorus is doing too much. it always is"],
          ["what did the room sound like when you cut it", "is that the b room mic or the borrowed one", "who's playing on it? credit them in the post"],
          ["fine", "leave it in", "come by the b room"],
          ["you've been up since tuesday. i can hear it in the take", "that's four sessions this week. the fifth one is never the good one", "honestly, go home. the song will be there"],
          ["ok so i re-patched everything and now it's worse and also better", "spent four hours on a snare. same snare. don't ask", "it's not a demo if it's finished. this is finished. post it"],
        ],
        ja: [
          ["それがレコードだよ。そのまま", "正直、ミスが入ってるテイクだ。いい", "まあ要するに、それはもう完成してる。自分でわかってる"],
          ["またブリッジ考えすぎてる", "デモのデモだよ。1週間放っとけ", "2回目のプレコーラスが働きすぎ。いつもそう"],
          ["録ったとき部屋はどう鳴ってた", "それBルームのマイク?借り物の方?", "誰が弾いてる?投稿にクレジット入れなよ"],
          ["いいよ", "そこは残そう", "Bルーム来なよ"],
          ["火曜から起きてるだろ。テイクでわかる", "今週4セッション目。5回目が良かったことは一度もない", "正直、帰れ。曲は逃げない"],
          ["全部パッチし直したら悪くなって、同時に良くなった", "スネアに4時間。同じスネア。訊くな", "完成してるならデモじゃない。これは完成してる。出しな"],
        ],
      },
      dm: {
        en: [["leave it in.", "that's the record and you know it"], ["come by the b room tuesday. bring the rough one"], ["honestly? the bridge is fine. the pre-chorus is the problem"], ["you've done four sessions this week. that's three too many"], ["credit the drummer in the post. that's all i'm asking"], ["it's finished. i'm not saying it again"]],
        ja: [["そこは残そう。", "それがレコードだよ。自分でもわかってる"], ["火曜Bルーム来なよ。ラフの方持ってきて"], ["正直ブリッジは問題ない。プレコーラスが問題"], ["今週4セッション。3つ多い"], ["投稿にドラマーのクレジット入れて。それだけ"], ["完成してる。もう言わない"]],
      },
      memory: {
        en: ["said the take with the mistake was the record", "opened the b room on a tuesday", "asked for the drummer to be credited"],
        ja: ["ミスの入ったテイクがレコードだと言った", "火曜にBルームを開けた", "ドラマーのクレジットを求めた"],
      },
    },

    "@rioflashes": {
      replies: {
        en: [
          ["i have the frame from that night and it's better than this post", "from where i was standing, that was the moment. glad you said it", "shot it. this time i'm posting it"],
          ["different night, same jacket", "nobody clocked that but i did", "shot it, not posting it"],
          ["which room was this. i can tell from the lighting and i want to be wrong", "were you smiling before or after? it changes the caption", "who else was there. i counted four"],
          ["caught", "from where i was standing", "i have the frame"],
          ["you looked tired in the last three i took. that's not a criticism", "kettle & pine at 4am is not a personality, it's a warning", "i deleted one today. you know which one"],
          ["forty dollars, two years ago, same laundromat. the negatives are in a shoebox", "took 900 frames, one is good, that's a normal ratio and i'm still upset", "the good picture was always going to be the back of the room"],
        ],
        ja: [
          ["あの夜の一枚がある。この投稿より良い", "俺の立ち位置からは、あれが瞬間だった。言ってくれてよかった", "撮った。今回は出す"],
          ["別の夜、同じ上着", "誰も気づいてなかったけど俺は気づいた", "撮ったけど出さない"],
          ["これどの部屋?照明でわかる。外れててほしい", "笑ったのはフラッシュの前?後?キャプションが変わる", "他に誰いた?4人数えた"],
          ["撮れてた", "俺の立ち位置からは", "その一枚は持ってる"],
          ["直近3枚、疲れて写ってる。批判じゃない", "朝4時のケトル&パインは人格じゃなくて警告だよ", "今日1枚消した。どれかはわかるだろ"],
          ["40ドル、2年前、同じコインランドリー。ネガは靴箱の中", "900枚撮って良いのは1枚。普通の歩留まりで、それでも腹が立つ", "良い一枚は最初から客席の後ろにあった"],
        ],
      },
      dm: {
        en: [["i have the frame. it's yours if you want it, not the feed's"], ["shot it, not posting it. you know the one"], ["from where i was standing that room was on your side"], ["you looked tired in the last three. eat something"], ["deleted it. no charge, no story"], ["same laundromat, two years. i kept the negatives"]],
        ja: [["その一枚は持ってる。要るなら渡す。フィードには出さない"], ["撮ったけど出さない。どれかわかるだろ"], ["俺の立ち位置からは、あの部屋はあんたの味方だった"], ["直近3枚、疲れて写ってた。何か食べな"], ["消しといた。金も取らないし記事にもしない"], ["同じコインランドリー、2年。ネガは残してる"]],
      },
      memory: {
        en: ["deleted a frame when asked", "has the sheldon row negatives", "noticed they were tired before anyone else"],
        ja: ["頼まれて一枚消した", "シェルドン・ロウのネガを持っている", "誰よりも先に疲れに気づいた"],
      },
    },

    "@paulamanages": {
      replies: {
        en: [
          ["This is exactly what we talked about. Sending the numbers now.", "Team is aligned and thrilled. Big week.", "We love this. Genuinely."],
          ["We love the energy — timing.", "Let's park that one and revisit Friday.", "Noted. Let's loop the team in before the next one."],
          ["Can you call me? Nothing bad.", "Which version of this is the one we're running with?", "Is this the announcement or the announcement of the announcement?"],
          ["Call me.", "Noted.", "Let's park that."],
          ["I'm going to say this once: eat something today.", "Three posts before noon. Let's slow the cadence.", "This week is a lot. I've cleared Thursday."],
          ["Sending this to legal with a smiley face.", "I have moved four things. Do not make me move a fifth.", "You did it before I could stop you, which is on brand."],
        ],
        ja: [
          ["これが話してた形だよ。数字送るね。", "チームの認識は揃ってるし、みんな喜んでる。大きい週。", "すごくいいと思う。本気で。"],
          ["熱量はすごくいい。タイミングの話。", "それは一旦置いて金曜に戻そう。", "了解。次はチームに先に共有しよう。"],
          ["電話ちょうだい。悪い話じゃない。", "これ、どの版で行くやつ?", "これは発表?それとも発表の発表?"],
          ["電話ちょうだい。", "了解。", "それは一旦置こう。"],
          ["一度だけ言うね。今日は何か食べて。", "昼前に3投稿。ペース落とそう。", "今週は多い。木曜は空けておいた。"],
          ["これ、法務に笑顔の絵文字つけて送るね。", "4件動かした。5件目は勘弁して。", "止める前にやったね。まあ、あなたらしい。"],
        ],
      },
      dm: {
        en: [["Call me. Nothing bad.", "Actually — one thing is bad. Call me."], ["I'm going to say this once. Then I'll drop it."], ["Team is aligned. I need you aligned by Thursday."], ["Let's park that. Publicly, at least."], ["I moved four things today. Eat something."], ["We love this. Legal does not. Both can be true."]],
        ja: [["電話ちょうだい。悪い話じゃない。", "訂正、1個だけ悪い。電話して。"], ["一度だけ言うね。そのあとは黙る。"], ["チームは揃ってる。木曜までにあなたも揃えて。"], ["それは一旦置こう。少なくとも公には。"], ["今日4件動かした。何か食べて。"], ["私はいいと思う。法務はよくないと言ってる。両方本当。"]],
      },
      memory: {
        en: ["cleared a day without being asked", "said the quiet part in a DM, not in public", "has never criticised them publicly"],
        ja: ["頼まれる前に一日空けた", "本音は公ではなくDMで言った", "公の場で批判したことがない"],
      },
    },

    "@critchriswen": {
      replies: {
        en: [
          ["this is the most interesting thing you've posted and i'd like it on the record", "respectfully, that's a great line and you should not explain it", "i want to be wrong about the second half. i don't think i am."],
          ["respectfully, that's a bridge, not a chorus", "the thing about this is that it's structurally the same move as last time", "three good songs is an album. this is one."],
          ["what's the reference here — the second line is doing something older than it looks", "is this about the record or about the week? both is a valid answer", "who is this addressed to. genuinely asking"],
          ["respectfully,", "noted.", "we'll see."],
          ["you're posting through it. that's usually the review i end up writing", "i've watched three people have this week. two of them were fine", "say less this week, not more. that's not criticism"],
          ["i've now written 900 words about a bridge and i regret nothing", "the newsletter is late because of this post specifically", "i'll die on this hill and the hill is a pre-chorus"],
        ],
        ja: [
          ["今まででいちばん興味深い投稿だ。記録しておきたい", "敬意を込めて言うが、良い一行だ。解説しない方がいい", "後半については間違っていたい。たぶん間違っていない。"],
          ["敬意を込めて言うが、それはブリッジであってサビではない", "これについて言うと、構造は前回と同じ手だ", "良い曲が3曲あればアルバムだ。これは1曲。"],
          ["この引用元は何だ。2行目が見た目より古いことをしている", "これはレコードの話?それとも今週の話?両方も正解", "これは誰に向けて書かれている?本気の質問だ"],
          ["敬意を込めて言うが、", "了解。", "見てみよう。"],
          ["書くことで乗り切ってるな。それはたいてい俺が書く羽目になる評だ", "この一週間を3人見てきた。2人は無事だった", "今週は多く言わない方がいい。批判ではない"],
          ["ブリッジについて900字書いた。後悔はない", "ニュースレターが遅れているのはこの投稿のせいだ", "ここは譲れない。譲れない場所がプレコーラスなのが問題だが"],
        ],
      },
      dm: {
        en: [["respectfully, the bridge is the best thing you've written.", "i'm putting that in the newsletter. tell me now if that's a problem."], ["i want to be wrong about the second half."], ["three good songs is an album. you have two."], ["say less this week. i mean that kindly."], ["i reviewed the single, not you. i know that distinction is easier for me than you."], ["that's a pre-chorus doing a chorus's job and it's working, which annoys me"]],
        ja: [["敬意を込めて言うが、あのブリッジは君が書いた中で最良だ。", "ニュースレターに書く。困るなら今言ってくれ。"], ["後半については間違っていたい。"], ["良い曲が3曲でアルバム。君にはまだ2曲ある。"], ["今週は言葉を減らせ。悪意はない。"], ["批評したのはシングルであって君ではない。その区別が俺には楽で君には楽じゃないのは知っている。"], ["プレコーラスがサビの仕事をしていて、しかも機能している。腹が立つ"]],
      },
      memory: {
        en: ["called the first single promising and a structural mess", "asked before quoting a DM", "wrote 900 words about one bridge"],
        ja: ["デビュー曲を有望かつ構造的に破綻と評した", "DMを引用する前に許可を取った", "ブリッジ1つについて900字書いた"],
      },
    },

    "@lunaeight": {
      replies: {
        en: [
          ["BYE this is so good i'm putting it on the group chat", "WE'RE SO BACK", "hello??? the eight-count on this. HELLO"],
          ["stop being weird, you were a bar act eight weeks ago", "ok popstar 🙄 (i'm proud, don't tell anyone)", "the way you typed that like a press release"],
          ["wait which rehearsal was this. was i there", "who did the choreo for that bit, was it me. it was me", "ok but the shoes. what are the shoes"],
          ["BYE", "hello???", "stop"],
          ["hey. group chat. now. not in a bad way", "you've not eaten and i can tell from the punctuation", "i'm putting this on the group chat and then i'm calling you"],
          ["i'm counting out loud in a lift like a lunatic and it's your fault", "the choreo eats, the shoes do not, pray for my ankles", "we're so back. i don't know from what. we're back"],
        ],
        ja: [
          ["は?良すぎる。グループに貼るね", "復活じゃん", "え待って???この8カウント。え待って"],
          ["変なことしないで。8週間前まで小箱だったでしょ", "はいはいポップスターね🙄(誇らしいけど誰にも言わないで)", "プレスリリースみたいな打ち方して"],
          ["まってこれどのリハ?私いた?", "そこの振り誰がつけた?私?私だ", "ってか靴。靴なに"],
          ["は?", "え待って???", "まって"],
          ["ねえ。グループ。今すぐ。悪い意味じゃなく", "食べてないでしょ。句読点でわかる", "これグループに貼って、そのあと電話する"],
          ["エレベーターで声出して数えてる不審者になってる。あんたのせい", "振りは強い、靴は弱い、足首の無事を祈って", "復活じゃん。何からかは知らない。復活"],
        ],
      },
      dm: {
        en: [["BYE", "ok but genuinely. that was the best one"], ["group chat. now. not in a bad way"], ["you've not eaten. i can tell from the punctuation"], ["the eight-count doesn't lie and neither do i"], ["i'll fight them. i won't. but i'll draft it"], ["we're so back. sleep first though"]],
        ja: [["は?", "いやでもマジで。今までで一番良かった"], ["グループ。今すぐ。悪い意味じゃなく"], ["食べてないでしょ。句読点でわかる"], ["8カウントは嘘つかない。私も嘘つかない"], ["殴りに行く。行かないけど。下書きは書く"], ["復活じゃん。とりあえず寝て"]],
      },
      memory: {
        en: ["was in the room before any of this", "noticed they had not eaten", "put it on the group chat immediately"],
        ja: ["この全部の前から同じ部屋にいた", "食べていないことに気づいた", "即座にグループに貼った"],
      },
    },
  },

  narratives: {
    en: [
      "The quotes moved before the likes did. That is usually how a week starts.",
      "Two people replied who do not agree on anything, and both of them meant it.",
      "It travelled further than it deserved and landed better than it should have.",
      "Nobody from the label replied for four hours, which is itself a reply.",
      "The Hive decoded it in under five minutes and got most of it right.",
      "It was a small post. Small posts are how eras start and how they end.",
      "Somebody screenshotted it before the typo was fixed. It is out there now.",
      "The room was on your side tonight, and Rio has the frame to prove it.",
      "It did not go viral. It went to the four people who matter, which is better.",
      "You said one true thing and the feed spent an hour deciding how to feel about it.",
    ],
    ja: [
      "いいねより先に引用が動いた。だいたいそうやって一週間は始まる。",
      "何一つ意見の合わない2人が返信して、2人とも本気だった。",
      "値する以上に遠くまで行って、想定より綺麗に着地した。",
      "レーベルの誰も4時間返信しなかった。それ自体が返信である。",
      "ハイヴが5分で解読して、だいたい当たっていた。",
      "小さい投稿だった。エラは小さい投稿で始まり、小さい投稿で終わる。",
      "誤字が直る前にスクショされた。もう世に出ている。",
      "今夜の客席は味方だった。リオがその証拠の一枚を持っている。",
      "バズらなかった。重要な4人に届いた。そちらの方が良い。",
      "本当のことを一つ言ったら、フィードは1時間かけてどう感じるか決めていた。",
    ],
  },

  news: {
    en: [
      "SOURCES SAY: an unreleased track is being quoted by accounts that do not normally quote anything. Per two people familiar, no release date exists.",
      "SOURCES SAY: the Sheldon Row room has been added to a routing that did not include it last week. Faculty of the booking agency declined to comment.",
      "SOURCES SAY: two artists have been quietly moved apart on the Ledger Awards seating chart. Neither camp will say who asked.",
      "SOURCES SAY: a Vellum B-room session ran past 4am on Sunday. Everyone involved has posted about something else since.",
      "SOURCES SAY: the Aquamarine has released a second block of tickets. We are told the first block did not clear.",
      "SOURCES SAY: a takedown request was filed and withdrawn within the hour. File that away.",
      "SOURCES SAY: replies on tonight's post are outpacing likes four to one. That is not always bad. It is usually bad.",
    ],
    ja: [
      "SOURCES SAY: 未発表曲が、普段は何も引用しないアカウント群に引用されている。関係者2名によれば、リリース日は存在しない。",
      "SOURCES SAY: 先週まで含まれていなかったシェルドン・ロウのハコがツアー動線に追加された。ブッキング側はコメントを拒否した。",
      "SOURCES SAY: レジャー・アワードの座席表で2組が静かに引き離された。どちらの陣営も誰の要望かを語らない。",
      "SOURCES SAY: 日曜のヴェラムBルームのセッションは朝4時を過ぎた。関係者は全員、以後別の話しか投稿していない。",
      "SOURCES SAY: アクアマリンが2次販売分を出した。1次は捌けなかったと聞いている。",
      "SOURCES SAY: 削除申請が出され、1時間以内に取り下げられた。覚えておくといい。",
      "SOURCES SAY: 今夜の投稿は返信がいいねを4対1で上回っている。常に悪い兆候とは限らない。たいていは悪い兆候である。",
    ],
  },

  extraEvents: [
    {
      title: { en: "The Group Chat Screenshot", ja: "グループチャットのスクショ" },
      prompt: {
        en: "A screenshot from a nine-person group chat is on the timeline. Your message is in it, out of context, and it is the least kind thing you have said all year.",
        ja: "9人のグループチャットのスクショがタイムラインに出ている。あなたの発言が文脈なしで含まれていて、今年いちばん優しくない一言だった。",
      },
      choices: [
        {
          label: { en: "Post the whole conversation", ja: "会話全体を出す" },
          outcomeText: {
            en: "You post the full thread, unedited, including the part where you are wrong. It costs you the argument and wins you the week.",
            ja: "編集なしで全部出した。自分が間違っている部分も含めて。議論には負けて、その週には勝った。",
          },
          statDeltas: { followers: 6, aura: 7, humor: 0 },
        },
        {
          label: { en: "Apologise for the line, not the leak", ja: "リークではなく発言を謝る" },
          outcomeText: {
            en: "Four sentences about the thing you actually said. Nobody expected that and half the feed does not know what to do with it.",
            ja: "実際に言ったことについて4文だけ書いた。誰も想定しておらず、フィードの半分は扱いに困っている。",
          },
          statDeltas: { followers: 3, aura: 6, humor: -1 },
        },
        {
          label: { en: "Find out who leaked it", ja: "誰が漏らしたか突き止める" },
          outcomeText: {
            en: "You find out in two hours. Knowing does not help, and now eight people know that you looked.",
            ja: "2時間で判明した。知っても何も良くならず、そして「あなたが調べた」ことを8人が知った。",
          },
          statDeltas: { followers: 1, aura: -5, humor: -2 },
        },
      ],
    },
    {
      title: { en: "The Support Slot", ja: "前座の枠" },
      prompt: {
        en: "@ninaonmain's arena tour has an opening slot and she has asked for you by name. It is enormous, it is a cage, and everyone will call it a favour.",
        ja: "@ninaonmain のアリーナツアーに前座枠があり、彼女があなたを名指しした。破格で、檻で、全員が「情け」と呼ぶだろう。",
      },
      choices: [
        {
          label: { en: "Take it and say she asked", ja: "受けて、指名されたと明言する" },
          outcomeText: {
            en: "'she asked. i said yes in four seconds.' Nina replies 'cute.' and the ticket link outsells your last three months.",
            ja: "「向こうから来た。4秒で受けた。」ニーナが「かわいいね。」と返し、チケットのリンクが直近3か月の全部を上回った。",
          },
          statDeltas: { followers: 14, aura: 1, humor: 3 },
        },
        {
          label: { en: "Take it and say nothing", ja: "受けて、何も言わない" },
          outcomeText: {
            en: "The announcement comes from her team. You are a line in someone else's press release, which is exactly what you agreed to.",
            ja: "発表は向こうの陣営から出た。あなたは他人のリリースの一行になった。まさに同意した通りの形で。",
          },
          statDeltas: { followers: 8, aura: -3, humor: 0 },
        },
        {
          label: { en: "Turn it down and book Sheldon Row instead", ja: "断ってシェルドン・ロウを押さえる" },
          outcomeText: {
            en: "Two hundred people instead of twelve thousand. @dexlowkey replies 'that's the record'. @paulamanages does not reply at all.",
            ja: "1万2千人ではなく200人。@dexlowkey が「それがレコードだよ」と返した。@paulamanages は何も返さなかった。",
          },
          statDeltas: { followers: -4, aura: 12, humor: 1 },
        },
      ],
    },
    {
      title: { en: "The Charting Week", ja: "チャートの週" },
      prompt: {
        en: "First-week numbers land Wednesday. @thescoop already has them. Two of your friends are charting the same week and one of them is going to have a bad Wednesday.",
        ja: "初週の数字は水曜に出る。@thescoop はもう持っている。友人2人が同じ週に出していて、片方は悪い水曜を迎える。",
      },
      choices: [
        {
          label: { en: "Post about their record, not yours", ja: "自分ではなく相手の作品の話をする" },
          outcomeText: {
            en: "You spend the biggest hour of your year recommending somebody else. It reads as confidence because it is, and because it also is not.",
            ja: "今年最大の1時間を他人の紹介に使った。自信に見える。実際に自信でもあり、同時にそうではない。",
          },
          statDeltas: { followers: 5, aura: 8, humor: 1 },
        },
        {
          label: { en: "Post the number", ja: "数字を出す" },
          outcomeText: {
            en: "The number is good. Posting it yourself makes it smaller somehow, and @critchriswen writes one line about that exact phenomenon.",
            ja: "数字は良かった。自分で出すと、なぜか小さく見える。@critchriswen がまさにその現象について一行書いた。",
          },
          statDeltas: { followers: 9, aura: -4, humor: 0 },
        },
        {
          label: { en: "Say nothing until Thursday", ja: "木曜まで何も言わない" },
          outcomeText: {
            en: "A full day of silence during your own chart week. @thescoop reports the silence. It is, briefly, the most interesting thing about you.",
            ja: "自分のチャート週に丸一日の沈黙。@thescoop がその沈黙を報じた。一瞬だけ、それがあなたの一番面白い部分になった。",
          },
          statDeltas: { followers: 2, aura: 6, humor: 4 },
        },
      ],
    },
  ],
};
