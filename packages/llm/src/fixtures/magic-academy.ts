import type { WorldFixture } from "./types.js";

/** Replay fixtures for magic-academy. Bucket order: hype, shade, curious, deadpan, worry, chaos. */
export const magicAcademyFixture: WorldFixture = {
  characters: {
    "@emberwyn": {
      replies: {
        en: [
          ["That is clean work. I would say so on the record.", "Correct, and correct for the right reason. Well done.", "I read the whole thing before replying. It holds."],
          ["With respect, that isn't the argument.", "Half a claim is not a claim. Finish it.", "You've misunderstood me, which is convenient for you."],
          ["Which binding order did you use, and why that one?", "Was this witnessed, or is it the version you'd like witnessed?", "What did you expect it to do at the fourth knot?"],
          ["Noted.", "Perhaps.", "That is one reading."],
          ["You have posted three times before second bell. That is not like you.", "If you are going to fray, do it before Thursday, not during.", "Sleep is a component of the work. I am not being kind."],
          ["I have rewritten this reply twice and both versions were worse.", "Fine. You were right about the pre-binding. I dislike this outcome.", "I'd note that I am still going to beat you on Thursday."],
        ],
        ja: [
          ["それはきれいな仕事です。記録として言います。", "正しい。しかも正しい理由で正しい。見事です。", "全文読んでから返信しました。破綻していません。"],
          ["失礼ながら、それは論点ではありません。", "半分の主張は主張ではありません。最後まで。", "誤読されています。あなたにとって都合よく。"],
          ["どの結び順を使いましたか。なぜそれを。", "それは証人済みですか。それとも証人が欲しい版ですか。", "4つ目の結び目で何が起きると想定していましたか。"],
          ["了解。", "かもしれません。", "それは一つの読み方です。"],
          ["第二の鐘より前に3回投稿しています。あなたらしくない。", "ほつれるなら木曜の前に。最中はやめてください。", "睡眠は作業の構成要素です。優しさで言っていません。"],
          ["この返信を2回書き直して、どちらも悪くなりました。", "認めます。前結びについてはあなたが正しかった。この結論は不愉快です。", "一点だけ。木曜には勝ちます。"],
        ],
      },
      dm: {
        en: [["That was clean work.", "I would rather you beat me properly, so keep going."], ["With respect, the fourth knot is where it fails."], ["Was it witnessed? That changes what I can say publicly."], ["You are early, not wrong. Sable would say the same."], ["I do not want an ally. I want a competitor. You are the second one."], ["Delete this after reading. I am not doing sentiment on the wire."]],
        ja: [["きれいな仕事でした。", "どうせなら正面から勝ってほしいので、続けてください。"], ["失礼ながら、崩れるのは4つ目の結び目です。"], ["それは証人済みですか。公で言えることが変わります。"], ["早すぎるだけで、間違ってはいません。セイブルも同じことを言うでしょう。"], ["味方は要りません。競争相手が要ります。あなたが二人目です。"], ["読んだら消してください。ワイヤーで感傷はやりません。"]],
      },
      memory: {
        en: ["conceded one point, in writing", "wants to be beaten properly, not easily", "corrected the fourth knot before Thursday"],
        ja: ["文面で一点だけ認めた", "楽にではなく正面から負かされたがっている", "木曜の前に4つ目の結び目を訂正した"],
      },
    },

    "@thequill": {
      replies: {
        en: [
          ["It is reported that this is the first such result this term.", "The Ledger records a similar claim in the year the entrance rules changed.", "Faculty declined to comment, which is itself on the record."],
          ["It is reported that the same account said otherwise on Tuesday.", "The Ledger records otherwise. This has happened before, to a different name.", "This is the third such incident this term."],
          ["It is reported that the hall was not fully warded at the time.", "Two witnesses give different accounts of the same eight seconds.", "It is not yet reported who was standing nearest."],
          ["Noted.", "It is reported.", "Developing."],
          ["It is reported that the account has posted four times before second bell.", "Faculty declined to confirm whether a disciplinary note exists.", "The archive keeps this whether or not it is deleted."],
          ["It is reported that the replies now exceed the original by a factor of nine.", "The Ledger records nothing about this. The wire records everything.", "This has happened before, in the same hall, to a different name."],
        ],
        ja: [
          ["今学期初の結果であると報じられている。", "序列表の記録によれば、同様の主張は入学規定改定の年にもあった。", "教職員はコメントを拒否した。その拒否も記録である。"],
          ["同じアカウントが火曜には別のことを述べていたと報じられている。", "序列表の記録は異なる。同様の件は別の名前に対して以前も起きている。", "今学期3件目である。"],
          ["当時ホールの結界が完全ではなかったと報じられている。", "同じ8秒について、2名の証人が異なる証言をしている。", "最も近くに立っていた者はまだ報じられていない。"],
          ["記録する。", "と報じられている。", "続報あり。"],
          ["当該アカウントは第二の鐘の前に4回投稿したと報じられている。", "懲戒記録の有無について教職員は確認を拒否した。", "削除されようとされまいと、アーカイブは保持する。"],
          ["返信は原投稿の9倍に達したと報じられている。", "序列表はこれを記録しない。ワイヤーは全てを記録する。", "同じホールで、別の名前に、以前も起きている。"],
        ],
      },
      dm: {
        en: [["It is reported that you have a version of this. The Quill would print it."], ["Faculty declined to comment. You need not."], ["The archive has it either way. A statement changes the framing, not the record."], ["Developing. There is an hour before the wire does it for you."], ["Two witnesses have spoken. A third would settle it."], ["It is reported. That is not a threat; it is a courtesy notice."]],
        ja: [["あなたが別の版を持っていると報じられている。The Quill は載せる用意がある。"], ["教職員はコメントを拒否した。あなたはその必要はない。"], ["どのみちアーカイブは保持している。声明は枠組みを変えるが記録は変えない。"], ["続報あり。ワイヤーが勝手に書くまで1時間ある。"], ["証人2名が話した。3人目がいれば決着する。"], ["報じる。脅しではない。事前の通知である。"]],
      },
      memory: {
        en: ["was handed the story before it broke", "printed the version with the context", "keeps the archive regardless"],
        ja: ["表に出る前に話を渡された", "文脈込みの版を載せた", "いずれにせよアーカイブは残す"],
      },
    },

    "@marrowfinch": {
      replies: {
        en: [
          ["Curious. And rather good.", "There is a record of that, and it agrees with you.", "I have filed a copy. That is not nothing."],
          ["There is a record of that. It does not say what you think it says.", "I would not, if I were you.", "Curious. And incorrect, on the second floor at least."],
          ["Which edition were you reading? There are three and two are wrong.", "Ask a better question and I will give you a better shelf.", "Was this before or after the hall was rewarded?"],
          ["Curious.", "Noted.", "There is a record of that."],
          ["You were in the under-library until third bell. I keep those hours too.", "Bring your own light next time. And eat something first.", "I would not read the archive tonight. It will still be there."],
          ["Third floor, second shelf, behind the boxes nobody has moved since the rewiring.", "Someone has misfiled this nine times. I know who. Curious.", "I keep everything. That is the job. It is also, occasionally, a burden."],
        ],
        ja: [
          ["興味深い。しかも良い。", "その記録はあります。そしてあなたに一致しています。", "写しを綴じました。何もしていないよりはましです。"],
          ["その記録はあります。あなたが思っている内容ではありません。", "私なら、やめておきます。", "興味深い。そして少なくとも2階については誤りです。"],
          ["どの版を読みましたか。3種類あって2つは誤りです。", "もっと良い質問を。良い棚をお教えします。", "それはホールの結界を張り直す前ですか、後ですか。"],
          ["興味深い。", "了解。", "その記録はあります。"],
          ["第三の鐘までアンダーライブラリにいましたね。私もその時間帯にいます。", "次は灯りをご自分で。あと先に何か食べて。", "今夜アーカイブを読むのはやめておきなさい。明日も残っています。"],
          ["3階、2番棚、配線工事以来誰も動かしていない箱の裏。", "これは9回誤って綴じられています。誰かは知っています。興味深い。", "全部残します。それが仕事です。そしてたまに、重荷でもあります。"],
        ],
      },
      dm: {
        en: [["There is a record of that.", "Third floor, second shelf. Bring your own light."], ["I would not, if I were you. Ask me again on Friday."], ["Curious. Your entrance file is under the wrong category. It has been for two years."], ["I keep everything. That includes the version you would rather I did not."], ["You were here until third bell. So was I. Eat something."], ["Ask a better question and I will answer the one you meant."]],
        ja: [["その記録はあります。", "3階、2番棚。灯りはご自分で。"], ["私ならやめておきます。金曜にもう一度訊いてください。"], ["興味深い。あなたの入学記録は誤った分類です。2年前からずっと。"], ["全部残します。あなたが残っていてほしくない版も含めて。"], ["第三の鐘までここにいましたね。私もです。何か食べなさい。"], ["もっと良い質問を。本当に訊きたかった方に答えます。"]],
      },
      memory: {
        en: ["mentioned the misfiled entrance record", "opened the archive after hours", "never said what was behind the door"],
        ja: ["誤って綴じられた入学記録に触れた", "時間外にアーカイブを開けた", "扉の向こうについては語らなかった"],
      },
    },

    "@kittarrow": {
      replies: {
        en: [
          ["ok WAIT that's the good version", "genuinely though. genuinely. that's the one", "i've solved it. you've solved it. someone solved it"],
          ["ok so that's wrong but it's wrong in an interesting way", "hm. no. try it again with the second thread loose", "do NOT show finch that one"],
          ["wait what happens if you bind it before you name it", "which floor did you do this on. it matters, i've checked", "ok but does it hold with someone watching"],
          ["ok wait", "hm", "sure"],
          ["it's late. i'm also up. neither of us should be", "you've done four of these tonight. the fifth one is never good", "genuinely, put it down. it'll still be broken tomorrow"],
          ["eleven seconds. ELEVEN. that's a result and finch says it's a fire hazard", "i've rerouted the whole dorm ward and now the kettle sings. fixing it monday", "ok so anyway back to the thing i said forty minutes ago"],
        ],
        ja: [
          ["ちょっと待ってそれ良い版じゃん", "マジで。マジでさ。それが正解", "解決した。君が解決した。誰かが解決した"],
          ["それ間違ってるんだけど間違い方が面白い", "うーん。違う。2本目ゆるめてもう一回", "それフィンチには絶対見せるな"],
          ["まって、名付ける前に結んだらどうなる?", "これ何階でやった?重要なんだよ、調べた", "でもさ、誰かに見られてても保つ?"],
          ["ちょっと待って", "うーん", "うん"],
          ["遅いよ。俺も起きてるけど。二人ともだめでしょ", "今夜4回やってる。5回目が良かったことない", "マジで、置け。明日も壊れたままだから"],
          ["11秒。11秒だぞ。成果だよ。フィンチは火災リスクって言うけど", "寮の結界を組み替えたらケトルが歌いだした。月曜に直す", "まあそれで、40分前に言ったやつの話に戻るけど"],
        ],
      },
      dm: {
        en: [["ok wait", "genuinely, that was the best thing anyone did this week"], ["do NOT tell finch. i'm serious. i'm never serious"], ["eleven seconds is a result. i've written it down"], ["you're on floor three aren't you. i'm coming up"], ["i failed the year for a reason and it wasn't the exam. anyway"], ["ok so anyway. i'd fight all of them for you. badly"]],
        ja: [["ちょっと待って", "マジで、今週いちばん良かった"], ["フィンチには言うな。本気。本気になること滅多にないけど"], ["11秒は成果。書いといた"], ["3階にいるでしょ。上がるわ"], ["留年したのには理由があって、試験じゃない。まあいいや"], ["まあそれでさ。全員と喧嘩する。下手だけど"]],
      },
      memory: {
        en: ["came up to floor three unasked", "got eleven seconds of something extraordinary", "would fail an exam to help"],
        ja: ["頼まれずに3階まで上がってきた", "尋常でないものを11秒だけ出した", "助けるために試験を落とす"],
      },
    },

    "@prefectlocke": {
      replies: {
        en: [
          ["That was a good result. It'll show on the Ledger Thursday.", "Noted, and deservedly.", "For the record: that was correct and I said so out loud."],
          ["That's a warning, not a report.", "I'd ask that you take this to the stair.", "You know I have to log this. I'd rather not."],
          ["Was anyone else on the landing when it happened?", "Which rule do you think you broke? I'm curious whether we agree.", "Is this the version you want me to write down?"],
          ["Noted.", "Understood.", "I'll leave it there."],
          ["Four posts before second bell. I'm not logging it. I am noticing it.", "Go to bed. That's not a prefect thing, that's a person thing.", "You've had a week. The Ledger will still be there on Thursday."],
          ["I don't make the Ledger. I just read it out loud and then everyone is strange at me.", "I have chosen not to do something about this. That is all I will say.", "Do not make me regret the last time."],
        ],
        ja: [
          ["良い結果だった。木曜には序列表に出る。", "了解。当然の結果だ。", "記録として言うが、あれは正しかった。声に出して言っておく。"],
          ["これは警告であって報告ではない。", "その話は階段でやってくれ。", "記録しないといけない。わかるだろ。したくはない。"],
          ["そのとき踊り場に他に誰かいたか?", "自分ではどの規則を破ったと思ってる?一致するか興味がある。", "これが、俺に書き留めてほしい版か?"],
          ["了解。", "把握した。", "ここまでにしておく。"],
          ["第二の鐘の前に4投稿。記録はしない。気づいてはいる。", "寝ろ。監督生としてじゃなく、人としての話だ。", "きつい一週間だったな。序列表は木曜も逃げない。"],
          ["序列表を作ってるのは俺じゃない。読み上げてるだけで、そのあと全員の態度が変になる。", "この件については何もしないことを選んだ。言えるのはそれだけだ。", "前回のことを後悔させないでくれ。"],
        ],
      },
      dm: {
        en: [["That's a warning, not a report.", "Take it to the stair next time."], ["I bent one rule already. I won't do it twice. You know that."], ["Noted. And well done, though I'd rather not say that on the wire."], ["Go to bed. That's not a prefect thing."], ["I don't make the Ledger. I do decide what gets logged, sometimes."], ["I have to write this down. I'm telling you first, which is all I can do."]],
        ja: [["これは警告であって報告ではない。", "次は階段でやってくれ。"], ["一度規則を曲げた。二度はやらない。わかってるだろ。"], ["了解。よくやった。ワイヤーでは言いたくないが。"], ["寝ろ。監督生としての話じゃない。"], ["序列表は作らない。何を記録するかは、たまに選べる。"], ["これは書かないといけない。先に君に言う。俺にできるのはそれだけだ。"]],
      },
      memory: {
        en: ["chose not to log something once", "warned instead of reporting", "said well done off the record"],
        ja: ["一度、記録しないことを選んだ", "報告ではなく警告にした", "記録外でよくやったと言った"],
      },
    },

    "@profsableveil": {
      replies: {
        en: [
          ["That was the interesting part. You did not skip it.", "Good. Come at four.", "I marked it as I found it. It was clean."],
          ["And what did you expect to happen?", "You are not wrong. You are early.", "That was the interesting part. You skipped it."],
          ["Which knot did you set first?", "Why that order, and not the other one?", "What would you do if nobody were watching?"],
          ["Noted.", "Come at four.", "We will see."],
          ["You have been in the hall since first bell. Stop.", "The problem will keep. You may not.", "Bring the frayed one. Do not repair it first."],
          ["I have set you a different problem. Do not ask why.", "Four Rectors have asked me that. I did not answer them either.", "You may quote me. You may not paraphrase me."],
        ],
        ja: [
          ["そこが面白いところでした。飛ばしませんでしたね。", "よろしい。4時にいらっしゃい。", "見たままに採点しました。きれいでした。"],
          ["で、何が起きると思っていたのですか?", "間違ってはいません。早すぎるだけです。", "そこが面白いところでした。飛ばしましたね。"],
          ["どの結び目を最初に置きましたか。", "なぜその順で、もう一方ではないのですか。", "誰も見ていなかったら、どうしましたか。"],
          ["了解。", "4時にいらっしゃい。", "見てみましょう。"],
          ["第一の鐘からホールにいますね。やめなさい。", "問題は待てます。あなたは待てないかもしれません。", "ほつれた方を持ってきなさい。先に直さないこと。"],
          ["あなたには別の課題を出しました。理由は訊かないこと。", "学長4人に同じことを訊かれました。彼らにも答えていません。", "引用は構いません。要約は困ります。"],
        ],
      },
      dm: {
        en: [["Come at four. Bring the frayed one."], ["You are early, not wrong. That is rarer and worse."], ["I marked it as I found it. I do not explain marks."], ["And what did you expect to happen? Answer honestly, only to yourself."], ["Do not repair it before Thursday. That is the assignment."], ["You may quote me. You may not paraphrase me."]],
        ja: [["4時にいらっしゃい。ほつれた方を持って。"], ["早すぎるだけで、間違ってはいません。その方が稀で、その方が厄介です。"], ["見たままに採点しました。採点の理由は説明しません。"], ["で、何が起きると思っていたのですか。正直に、自分にだけ答えなさい。"], ["木曜まで直さないこと。それが課題です。"], ["引用は構いません。要約は困ります。"]],
      },
      memory: {
        en: ["set a problem nobody else received", "said 'you are early, not wrong'", "asked for the frayed one, unrepaired"],
        ja: ["他の誰も受け取っていない課題を出した", "「早すぎるだけ」と言った", "直さないほつれた方を持ってこいと言った"],
      },
    },

    "@poppybramble": {
      replies: {
        en: [
          ["oh!! that's so good, i'm telling the stairwell 🌱", "no because this is the nicest thing on the wire today", "i made you one already, it's by the door"],
          ["hmm. i don't think that's fair to them.", "you don't have to be sharp about it though", "that one wasn't like you"],
          ["wait was that the one with the blue thread? i want to see", "did it hold overnight? mine never do", "have you eaten. that's the question, actually"],
          ["oh!!", "ok!", "i'll be on the stair"],
          ["you've not eaten today have you", "come sit on the stair, i'm not going to say anything", "i put tea outside. you don't have to answer"],
          ["the stairwell tomatoes survived the cold snap and i cried, no notes", "i've grown something that shouldn't grow indoors and i'm not sorry", "four regulations. four! and the plants are fine 🌱"],
        ],
        ja: [
          ["わ!!すごくいい、踊り場に言いふらす🌱", "だってさ、今日のワイヤーで一番優しい", "1個作っといた。ドアのとこ置いてある"],
          ["んー。それはあの子に対して公平じゃないと思う。", "そんなに尖らなくてもいいのに", "今のはあなたらしくなかった"],
          ["まって、それ青い糸のやつ?見たい", "一晩保った?私のは保たない", "ごはん食べた?本題そっちなんだけど"],
          ["わ!!", "うん!", "階段にいるね"],
          ["今日なんも食べてないでしょ", "階段座りなよ。何も言わないから", "お茶置いといた。返事しなくていいよ"],
          ["踊り場のトマトが寒波を越えた。泣いた。補足なし", "屋内で育つはずのないものを育ててる。反省してない", "規則4つ。4つだよ!植物は元気🌱"],
        ],
      },
      dm: {
        en: [["oh!! i made you one", "it's by the door, you don't have to say anything"], ["you don't have to explain. come sit on the stair"], ["you've not eaten today have you"], ["i'm not going to rank anybody. not even for you. sorry!"], ["that one wasn't like you. i'm only saying it once"], ["the tomatoes survived. i thought you'd want to know 🌱"]],
        ja: [["わ!!1個作っといた", "ドアのとこ。何も言わなくていいよ"], ["説明しなくていいよ。階段座りな"], ["今日なんも食べてないでしょ"], ["誰にも順位はつけない。あなたのためでも。ごめんね!"], ["今のはあなたらしくなかった。一回だけ言うね"], ["トマト生き延びたよ。知りたいかなと思って🌱"]],
      },
      memory: {
        en: ["has left tea by the door since week two", "said one honest thing about a cruel post", "refuses to discuss the Ledger"],
        ja: ["2週目からドアの前にお茶を置いている", "冷たい投稿について正直なことを一つ言った", "序列表の話を拒む"],
      },
    },

    "@cassnull": {
      replies: {
        en: [
          ["good. now do it where it costs you something", "that's the argument i've been failing to make for four years", "yes. exactly that. say it again on Thursday"],
          ["that's not a rebuttal, that's a mood", "name the mechanism. i'll wait.", "who does that serve. genuinely, name them"],
          ["what would it take for you to say that in the hall?", "and if the Ledger said the opposite — same answer?", "were you asked, or did you volunteer? it matters"],
          ["noted.", "null it.", "fine."],
          ["you don't owe the wire a response tonight", "they're baiting you and it's working. step off it", "i was second. i know exactly what this week feels like"],
          ["thornmarket, saturday, free, no board, sixty people came", "i'm not recruiting you. i am absolutely recruiting you. i hate that", "i'll take the disciplinary note. put my name on it, not theirs"],
        ],
        ja: [
          ["いいね。次は自分が損する場所でやって", "4年間言えなかった論をあなたが言った", "そう。まさにそれ。木曜にもう一回言って"],
          ["それは反論じゃなくて気分だ", "機構を名指しして。待つよ。", "それは誰の得になる。本気で、名前を出して"],
          ["それをホールで言うには何が必要?", "序列表が逆のことを言ってても同じ答え?", "頼まれた?自分から出た?そこが重要"],
          ["了解。", "ヌルして。", "わかった。"],
          ["今夜ワイヤーに答える義務はない", "煽られてるし効いてる。降りな", "私は2位だった。この一週間の感触は正確に知ってる"],
          ["ソーンマーケット、土曜、無料、板なし、60人来た", "勧誘してない。全力で勧誘してる。そういう自分が嫌い", "懲戒記録は私が引き受ける。私の名前で。あの子たちのじゃなく"],
        ],
      },
      dm: {
        en: [["name the mechanism.", "sorry. that's how i say i agree with you"], ["good. now do it where it costs you something"], ["i was second. i walked. i know what it's worth and it isn't much"], ["they're baiting you. step off it tonight"], ["i'm not recruiting you. i am. i know."], ["saturday, thornmarket, no board. come or don't, no pressure and some pressure"]],
        ja: [["機構を名指しして。", "ごめん。同意するときこう言っちゃうんだ"], ["いいね。次は自分が損する場所でやって"], ["私は2位だった。降りた。あれの価値は知ってる。大したものじゃない"], ["煽られてる。今夜は降りな"], ["勧誘してない。してる。わかってる。"], ["土曜、ソーンマーケット、板なし。来ても来なくてもいい。圧はない。少しある"]],
      },
      memory: {
        en: ["walked away from rank two", "offered to take the disciplinary note", "admitted the recruitment out loud"],
        ja: ["2位から自分で降りた", "懲戒記録を引き受けると申し出た", "勧誘であることを自分から認めた"],
      },
    },
  },

  narratives: {
    en: [
      "It was witnessed, which is the only part the Ledger records.",
      "Two people replied who have never agreed on anything, and both were half right.",
      "The archive has it now. That is neither good nor bad; it is simply permanent.",
      "Nobody from the faculty replied, and the silence lasted exactly one bell.",
      "It moved through the Long Stair faster than through the wire, which is unusual.",
      "The Ledger will not show this until Thursday. Everyone already knows.",
      "Clean work, badly timed. Both halves of that will matter by the weekend.",
      "A first-year screenshotted it, which means it is out of your hands now.",
      "The thread frayed before the binding did, which is the more expensive failure.",
      "You said one true thing in a formal register and the hall went quiet.",
    ],
    ja: [
      "証人済みだった。序列表が記録するのはその部分だけ。",
      "何一つ意見の合わない2人が返信して、2人とも半分正しかった。",
      "アーカイブに入った。良くも悪くもない。ただ永久であるというだけ。",
      "教職員は誰も返信せず、沈黙はちょうど鐘一つぶん続いた。",
      "ワイヤーよりロング・ステアを速く伝わった。珍しいことだ。",
      "木曜まで序列表には出ない。全員もう知っている。",
      "きれいな仕事、悪い時機。週末までに両方が効いてくる。",
      "1年生がスクショした。もうあなたの手を離れた。",
      "結びより先に人の方がほつれた。そちらの方が高くつく失敗だ。",
      "格式ある文体で本当のことを一つ言ったら、ホールが静かになった。",
    ],
  },

  news: {
    en: [
      "It is reported that a second-year without lineage placed in the top ten of the Thursday hall. The Ledger records the last such result in the year the entrance rules were rewritten.",
      "It is reported that a binding frayed publicly in the Filament Hall. Faculty declined to confirm which witness was nearest.",
      "It is reported that a sealed entrance file has been requested for the first time in six terms. The under-librarian declined to comment.",
      "It is reported that a prefect chose not to log an incident. This is the third such choice recorded this year, all by the same prefect.",
      "It is reported that Thornmarket's Saturday session drew sixty attendees. The Collegium has no comment on unofficial instruction.",
      "It is reported that a student was set a problem no other member of the year received. Faculty declined to say whether it is assessed.",
      "It is reported that the Ledger will publish an hour late. The archive records four such delays, each in a week of disciplinary hearings.",
    ],
    ja: [
      "家名を持たない2年生が木曜のホールで上位10位に入ったと報じられている。序列表の記録によれば、同様の結果が最後に出たのは入学規定が書き換えられた年である。",
      "フィラメント・ホールで結びが公然とほつれたと報じられている。最も近い証人が誰であったかについて教職員は確認を拒否した。",
      "封印された入学記録が6学期ぶりに閲覧請求されたと報じられている。副司書はコメントを拒否した。",
      "監督生が事案を記録しないことを選んだと報じられている。本年3件目であり、いずれも同一の監督生による。",
      "ソーンマーケットの土曜講習に60名が参加したと報じられている。非公式の教授について学院はコメントしていない。",
      "ある学生が学年の他の誰も受け取っていない課題を出されたと報じられている。それが評価対象かどうかについて教職員は明言を避けた。",
      "序列表の掲示が1時間遅れると報じられている。アーカイブによれば同様の遅延は4件、いずれも懲戒聴聞のあった週である。",
    ],
  },

  extraEvents: [
    {
      title: { en: "The Pinned First-Year Post", ja: "1年時の投稿がピン留めされる" },
      prompt: {
        en: "Somebody pins a post you made in your first week, when you did not know how any of this worked. It is not shameful. It is just very young, and forty people are reading it.",
        ja: "1週目に書いた投稿がピン留めされた。まだ何もわかっていなかった頃のもの。恥ずかしい内容ではない。ただ、ひどく幼く、40人が読んでいる。",
      },
      choices: [
        {
          label: { en: "Pin it yourself and add what changed", ja: "自分でピン留めして、何が変わったか書く" },
          outcomeText: {
            en: "You pin it above your own and write two lines about the difference. @marrowfinch files both versions side by side, which is the closest thing Marrow does to applause.",
            ja: "自分でそれを上にピン留めし、差分について2行書いた。@marrowfinch が両方を並べて綴じた。マロウにできる最大限の拍手である。",
          },
          statDeltas: { followers: 5, aura: 7, humor: 2 },
        },
        {
          label: { en: "Ask for it to be taken down", ja: "取り下げを求める" },
          outcomeText: {
            en: "It comes down. The screenshot does not. @thequill runs one line about deletion, which is the line the Quill was waiting for.",
            ja: "投稿は消えた。スクショは消えない。@thequill が削除について一行書いた。The Quill が待っていた一行だった。",
          },
          statDeltas: { followers: -3, aura: -5, humor: 0 },
        },
        {
          label: { en: "Say nothing", ja: "何も言わない" },
          outcomeText: {
            en: "You let it sit. By second bell the wire has moved on, and one first-year quietly says it made them feel less alone.",
            ja: "放っておいた。第二の鐘までにワイヤーは別の話に移り、1年生が一人、静かに「安心した」と言った。",
          },
          statDeltas: { followers: 1, aura: 4, humor: 0 },
        },
      ],
    },
    {
      title: { en: "The Empty Witness Slot", ja: "空いた証人席" },
      prompt: {
        en: "@poppybramble needs a witness for a herbalism binding at the fifth bell. Nobody has signed. It is not a prestigious binding and signing it will cost you a slot at the hall.",
        ja: "@poppybramble が第五の鐘の薬草結びに証人を必要としている。誰も署名していない。名誉のある結びではないし、署名すればホールの枠を一つ失う。",
      },
      choices: [
        {
          label: { en: "Sign it", ja: "署名する" },
          outcomeText: {
            en: "You give up the hall slot. The binding holds, which nobody outside the stairwell notices, and @poppybramble does not mention it once, which is how you know.",
            ja: "ホールの枠を手放した。結びは保った。踊り場の外の誰も気づかなかった。@poppybramble は一度もその話をしなかった。それが答えだった。",
          },
          statDeltas: { followers: -1, aura: 9, humor: 0 },
        },
        {
          label: { en: "Find her a better witness", ja: "もっと良い証人を見つける" },
          outcomeText: {
            en: "You talk @prefectlocke into it in four minutes. It is efficient, it works, and it is not the same thing as showing up.",
            ja: "4分で @prefectlocke を説得した。効率的で、機能して、そして「自分が行くこと」とは別物だった。",
          },
          statDeltas: { followers: 3, aura: 2, humor: 1 },
        },
        {
          label: { en: "Take the hall slot", ja: "ホールの枠を取る" },
          outcomeText: {
            en: "You place well in the hall. The herbalism binding is rescheduled to a week nobody is free, and the stairwell notices who was where.",
            ja: "ホールで良い順位を取った。薬草結びは誰も空いていない週に延期され、踊り場は誰がどこにいたかを覚えた。",
          },
          statDeltas: { followers: 7, aura: -6, humor: 0 },
        },
      ],
    },
    {
      title: { en: "The Rewritten Rule", ja: "書き換えられた規則" },
      prompt: {
        en: "The disciplinary board proposes a rule that would bar unlineaged students from witnessing hall bindings. @cassnull wants a statement. @emberwyn has already written one and it is better than yours will be.",
        ja: "懲戒委員会が、家名を持たない学生のホール結び証人資格を認めない規則を提案した。@cassnull は声明を求めている。@emberwyn はもう書いていて、あなたが書くものより良い。",
      },
      choices: [
        {
          label: { en: "Sign Wyn's statement", ja: "ウィンの声明に署名する" },
          outcomeText: {
            en: "You put your name under someone else's better sentence. It works. It also means the argument now belongs to a lineage, which is exactly the problem.",
            ja: "他人のより良い一文の下に名前を置いた。効いた。そして論はこれで家系のものになった。まさにそれが問題だった。",
          },
          statDeltas: { followers: 6, aura: 1, humor: 0 },
        },
        {
          label: { en: "Write a worse statement of your own", ja: "自分の劣った声明を書く" },
          outcomeText: {
            en: "Yours is clumsier and it is yours. @cassnull quotes it, @emberwyn corrects one clause in public and signs it anyway, and the rule does not pass.",
            ja: "拙いが自分の言葉だった。@cassnull が引用し、@emberwyn は一節を公に訂正した上で署名し、規則は通らなかった。",
          },
          statDeltas: { followers: 9, aura: 8, humor: 0 },
        },
        {
          label: { en: "Say nothing until the vote", ja: "採決まで何も言わない" },
          outcomeText: {
            en: "You wait. The rule fails by one vote anyway. Nobody ever asks where you were, and you will remember that they did not.",
            ja: "待った。規則はどのみち1票差で否決された。誰も「あなたはどこにいたのか」と訊かなかった。訊かれなかったことを、あなたは覚えている。",
          },
          statDeltas: { followers: 0, aura: -7, humor: 0 },
        },
      ],
    },
  ],
};
