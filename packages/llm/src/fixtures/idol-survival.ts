import type { WorldFixture } from "./types.js";

/** Replay fixtures for idol-survival. Bucket order: hype, shade, curious, deadpan, worry, chaos. */
export const idolSurvivalFixture: WorldFixture = {
  characters: {
    "@mikan_hoshino": {
      replies: {
        en: [
          ["ok ok ok that's the one. i'm saying it first", "we run it again tomorrow and it'll be even better", "i'm not being nice, i'm being right: that was good"],
          ["hm. that's the safe version and you know it", "you did the hard part already, so why post the easy part", "that sounded like a form. you're not a form"],
          ["wait was that the take from tuesday or the new one", "which eight are you counting from? i keep losing it", "did sensei hear this yet"],
          ["ok", "noted", "we run it again"],
          ["floor three was busy tonight. you don't have to say anything", "have you eaten. that's the whole message", "you've posted three times since the reading. put it down"],
          ["i've counted this in my sleep and now i'm counting it awake, help", "someone put honey in the kettle again and i think it was you", "ok ok ok one more run and then i'm sleeping. one more"],
        ],
        ja: [
          ["はいはいはい、それ。私が最初に言うね", "明日もう一回まわそ。もっと良くなるよ", "優しくしてるんじゃなくて正しいこと言ってる。今の良かった"],
          ["んー。安全な方でしょ。自分でわかってる", "難しいとこもう終わってるのに、なんで簡単な方を出すの", "テンプレっぽかった。あなたテンプレじゃないでしょ"],
          ["まってそれ火曜のテイク?新しい方?", "どのエイトから数えてる?見失うんだけど", "先生もう聴いた?"],
          ["うん", "了解", "もう一回まわそ"],
          ["今夜の3階は混んでた。何も言わなくていいよ", "ごはん食べた?それだけ", "読み上げから3回投稿してる。いったん置こう"],
          ["寝ながらカウント取ってて、起きてもカウント取ってる。助けて", "またケトルに蜂蜜入ってた。あなたでしょ", "はいはいはい、もう一回だけまわして寝る。もう一回だけ"],
        ],
      },
      dm: {
        en: [["ok ok ok", "that was the best run you've done. i'm not being nice"], ["floor three was busy. i didn't say anything to anyone"], ["have you eaten. that's the whole message"], ["we run it again tomorrow. 7am. i've booked the room"], ["i'm going to take that position next week. telling you now, not after"], ["you did the hard part already. go to sleep"]],
        ja: [["はいはいはい", "今までで一番良い通しだった。優しくしてるんじゃないよ"], ["3階混んでた。誰にも何も言ってない"], ["ごはん食べた?それだけ"], ["明日もう一回まわそ。7時。部屋押さえた"], ["来週そのポジション取りに行く。後じゃなくて今言っとく"], ["難しいとこはもう終わってる。もう寝な"]],
      },
      memory: {
        en: ["booked the 7am room without being asked", "said she would take the position, in advance", "never repeats what happens on floor three"],
        ja: ["頼まれずに朝7時の部屋を押さえた", "ポジションを取りに行くと事前に宣言した", "3階の出来事を他所で話さない"],
      },
    },

    "@stagewire": {
      replies: {
        en: [
          ["[NEXT STAGE] A mid-ranked trainee posted the most-shared clip of the week. According to production figures, that has preceded a rank rise five times this season.", "[NEXT STAGE] The post has been shared past the fandom. This is the first time this season for this account.", "[NEXT STAGE] Noted ahead of Sunday's reading."],
          ["[NEXT STAGE] A similar statement was made two weeks ago with a different outcome.", "[NEXT STAGE] The production company has not commented. It commented on Tuesday.", "[NEXT STAGE] The figure has not been confirmed."],
          ["[NEXT STAGE] It is unclear which day the footage is from. The broadcast did not say.", "[NEXT STAGE] Two trainees have described the same practice differently.", "[NEXT STAGE] The order of Sunday's reading has not been released."],
          ["[NEXT STAGE] Noted.", "[NEXT STAGE] According to Sunday's broadcast.", "[NEXT STAGE] Developing."],
          ["[NEXT STAGE] The account has posted four times since the reading. Historically that correlates with a withdrawal announcement, though not in this case.", "[NEXT STAGE] The production company has not commented on the schedule overrun.", "[NEXT STAGE] Practice-building access logs show 1:40am. The company declined to confirm."],
          ["[NEXT STAGE] Replies now exceed the original post by a factor of twelve.", "[NEXT STAGE] The clip is at two million views. This is the first time since season one.", "[NEXT STAGE] A vote drive reached its target in ninety minutes. The figure has not been confirmed."],
        ],
        ja: [
          ["【NEXT STAGE】中位の練習生が今週最も共有されたクリップを投稿した。制作側の数値によれば、今季5回、これは順位上昇に先行している。", "【NEXT STAGE】当該投稿はファンダムの外まで広がった。このアカウントでは今季初である。", "【NEXT STAGE】日曜の読み上げを前に記録しておく。"],
          ["【NEXT STAGE】2週間前にも同様の発言があり、結果は異なった。", "【NEXT STAGE】制作側はコメントを出していない。火曜には出していた。", "【NEXT STAGE】数値は未確認。"],
          ["【NEXT STAGE】映像がいつのものかは不明。放送は明示しなかった。", "【NEXT STAGE】同じ練習について2名の練習生が異なる説明をしている。", "【NEXT STAGE】日曜の読み上げの順番は公表されていない。"],
          ["【NEXT STAGE】記録。", "【NEXT STAGE】日曜の放送によると。", "【NEXT STAGE】続報あり。"],
          ["【NEXT STAGE】当該アカウントは読み上げ以降4回投稿している。過去には辞退発表と相関したが、本件は該当しない。", "【NEXT STAGE】編成超過について制作側はコメントを出していない。", "【NEXT STAGE】練習棟の入退館記録は1時40分を示している。制作側は確認を拒否した。"],
          ["【NEXT STAGE】返信数が原投稿の12倍に達した。", "【NEXT STAGE】クリップは200万再生。シーズン1以来のことである。", "【NEXT STAGE】投票企画が90分で目標に到達した。数値は未確認。"],
        ],
      },
      dm: {
        en: [["[NEXT STAGE] A statement would be printed verbatim."], ["The production company has not commented. You may."], ["Developing. There is an hour before this runs."], ["Two trainees have already spoken. A third would settle the timeline."], ["According to the access logs, 1:40am. No comment is also an answer."], ["[NEXT STAGE] Noted. This is a courtesy, not a request."]],
        ja: [["【NEXT STAGE】声明があれば逐語で掲載する。"], ["制作側はコメントを出していない。あなたは出せる。"], ["続報あり。掲載まで1時間ある。"], ["練習生2名がすでに話した。3人目がいれば時系列が確定する。"], ["入退館記録によれば1時40分。ノーコメントも回答である。"], ["【NEXT STAGE】記録。これは通知であって依頼ではない。"]],
      },
      memory: {
        en: ["ran the correction with the date", "reported the rise before the fandom did", "never reported the family question"],
        ja: ["日付入りの訂正を出した", "ファンダムより先に上昇を報じた", "家族の件は一度も報じなかった"],
      },
    },

    "@ruri_kurosaki": {
      replies: {
        en: [
          ["That was better and you know it.", "Fine. Genuinely fine.", "From the second eight. That part was right."],
          ["Rank isn't a personality.", "That's the version you rehearsed. I've heard the other one.", "No."],
          ["Which eight are you counting from?", "Did you record it, or are we guessing?", "Was that the first take or the ninth?"],
          ["Fine.", "Noted.", "Again."],
          ["You were in the building at 1:40. I saw the log.", "Do it tomorrow. Not tonight.", "I don't do camera-off. But I saw."],
          ["I fixed the second eight for you. Don't mention it.", "Six years and I still count out loud in lifts. It never goes away.", "I said one sentence and the timeline wrote four hundred. Predictable."],
        ],
        ja: [
          ["今のは良くなった。自分でわかってるでしょ。", "いい。本当にいい。", "2エイト目から。そこは合ってた。"],
          ["順位は人格じゃない。", "それは練習した方の版。もう片方も聴いた。", "違う。"],
          ["どのエイトから数えてる?", "録った?それとも当てずっぽう?", "今のは1テイク目?9テイク目?"],
          ["いい。", "了解。", "もう一回。"],
          ["1時40分に建物にいたでしょ。記録見た。", "明日やって。今夜じゃなく。", "カメラ切れてからの話はしない。でも見てた。"],
          ["2エイト目、直しておいた。言わないで。", "6年やってもエレベーターで声出して数えてる。抜けない。", "一文言ったらタイムラインが400文書いた。想定内。"],
        ],
      },
      dm: {
        en: [["From the second eight. The first one is fine."], ["Fine. That was good. Don't make it a thing."], ["I fixed it. Don't mention it on the timeline."], ["You were in the building at 1:40. Stop."], ["Rank isn't a personality. Neither is exhaustion."], ["I don't do camera-off. This is not camera-off. This is a message."]],
        ja: [["2エイト目から。1エイト目はいい。"], ["いい。今のは良かった。大ごとにしないで。"], ["直しておいた。タイムラインでは触れないで。"], ["1時40分に建物にいたでしょ。やめて。"], ["順位は人格じゃない。疲労も人格じゃない。"], ["カメラ切れてからの話はしない。これは違う。これはメッセージ。"]],
      },
      memory: {
        en: ["fixed the second eight without being asked", "noticed the 1:40am log", "gave one correction a week, unasked"],
        ja: ["頼まれずに2エイト目を直した", "1時40分の記録に気づいた", "週に1回、頼まれない指摘をくれる"],
      },
    },

    "@pd_takagi": {
      replies: {
        en: [
          ["Real growth this week. Please keep supporting them.", "The trainees worked incredibly hard on this. It shows.", "This is what the mission was for. Well done."],
          ["That's the show.", "I don't edit the votes.", "Everyone here chose to be here."],
          ["Which mission is this from?", "Has the team seen this version?", "Is this for Sunday or for after?"],
          ["Noted.", "Thank you.", "Please keep supporting them."],
          ["Four posts since the reading. Take Monday off the timeline.", "The building closes at 2. Please use that.", "It has been a heavy week for everyone. That is not a criticism."],
          ["I have said one thing on a stage once and it follows me still.", "The edit is not a person. I understand why you talk to it like one.", "I moved the schedule twice. Do not ask me to move it again."],
        ],
        ja: [
          ["今週は確かな成長が見えました。引き続き応援をお願いします。", "練習生たちは本当によく頑張りました。出ています。", "このミッションはそのためのものでした。よくやりました。"],
          ["それが番組です。", "票は編集できません。", "ここにいる全員が、自分でここを選びました。"],
          ["これはどのミッションの映像ですか?", "この版はチームが確認していますか?", "これは日曜向けですか、それとも後ですか?"],
          ["了解。", "ありがとうございます。", "引き続き応援をお願いします。"],
          ["読み上げ以降4投稿。月曜はタイムラインから離れてください。", "建物は2時に閉まります。使ってください。", "全員にとって重い一週間でした。批判ではありません。"],
          ["一度ステージで言ったことが、今も付いてきています。", "編集は人ではありません。人のように話しかける理由は理解します。", "編成を2回動かしました。3回目は勘弁してください。"],
        ],
      },
      dm: {
        en: [["Please keep supporting them. And please rest."], ["That's the show. I know that isn't an answer."], ["I don't edit the votes. I do decide the order of the broadcast."], ["The building closes at 2. Use it."], ["Everyone here chose to be here. I have not forgotten what that costs."], ["I moved the schedule twice for this. Once was for you."]],
        ja: [["引き続き応援をお願いします。そして休んでください。"], ["それが番組です。答えになっていないのはわかっています。"], ["票は編集できません。放送の順番は決めています。"], ["建物は2時に閉まります。使ってください。"], ["ここにいる全員が自分で選びました。その代償は忘れていません。"], ["この件で編成を2回動かしました。1回はあなたのためです。"]],
      },
      memory: {
        en: ["moved the schedule once for them", "never criticised a trainee publicly", "said the quiet part on a stage, once"],
        ja: ["一度だけ編成を動かした", "練習生を公に批判したことがない", "一度だけステージで本音を言った"],
      },
    },

    "@aoi_nanase": {
      replies: {
        en: [
          ["oh!! i wrote that down last week and now it makes sense 🙇", "one more run and i'll get it. thank you for the real version", "this is the best thing on the timeline today, i think"],
          ["i think maybe that's not quite it? sorry — not sorry, working on that", "i don't want to say it but i wrote it down and it's still true", "hm."],
          ["which part should i be listening to, the second verse or the bridge", "did sensei say that or did you? i want to write it down correctly", "can i ask what you were counting there"],
          ["ok!", "i wrote it down", "one more run"],
          ["you don't have to answer this. i just wanted to say i saw it", "floor 5 mirrors are the honest ones. i've been avoiding them too", "please eat something. sorry — that's not my business. still though"],
          ["i've filled a whole notebook and it's week nine, is that normal", "sorry i replied three times, i keep thinking of the better version", "i genuinely can't see it yet but everyone keeps saying it so i wrote that down too"],
        ],
        ja: [
          ["わ!!先週書き留めたやつ、今わかりました🙇", "もう一回だけやれば掴めます。本当のほう言ってくれてありがとうございます", "今日のタイムラインで一番いいと思います"],
          ["たぶんですけど、そこは少し違う気がします。すみません、あ、直します", "言いたくないんですけど、書き留めてあって、まだ本当なんです", "うーん。"],
          ["どこを聴けばいいですか、2番?ブリッジ?", "それ先生が言ったやつですか?正確に書き留めたくて", "そこ何を数えてたか訊いてもいいですか"],
          ["はい!", "書いときました", "もう一回だけ"],
          ["返事しなくて大丈夫です。見てました、とだけ", "5階の鏡は正直なんです。私も避けてます", "何か食べてください。すみません、余計なことでした。でも"],
          ["ノート1冊使い切りました。まだ9週目です。普通ですか", "3回返信してすみません。もっと良い言い方を思いつくので", "まだ自分では見えないんですけど、みんな言うのでそれも書き留めました"],
        ],
      },
      dm: {
        en: [["i wrote it down", "thank you for the real version. i mean that"], ["sorry — not sorry, i'm working on that"], ["one more run. sorry. two more"], ["i saw the reading. you don't have to say anything to me"], ["i genuinely can't see it yet. i'm not being modest"], ["can i ask you something and you say the honest answer"]],
        ja: [["書いときました", "本当のほう言ってくれてありがとうございます。本気です"], ["すみません、あ、直します"], ["もう一回だけ。すみません、あと2回"], ["読み上げ見ました。私には何も言わなくて大丈夫です"], ["まだ自分では見えないんです。謙遜じゃなくて"], ["一つ訊いてもいいですか。正直な方で答えてください"]],
      },
      memory: {
        en: ["wrote down the feedback and used it", "quoted something back three weeks later", "asked for the honest version every time"],
        ja: ["助言を書き留めて実際に使った", "3週間後に一字一句引用してきた", "毎回、正直な方を求めた"],
      },
    },

    "@wotaking": {
      replies: {
        en: [
          ["ok team. THIS is the clip. step 1: watch it twice. step 2: i've done the maths", "this is not a drill. deadline is 23:00 JST", "i have screenshotted this and it is going in the folder 📌"],
          ["ok but we are not doing that in the replies. step 1: stop", "i've done the maths and that framing is off by about four hundred", "we do not send anything to a trainee's family. ever. moving on"],
          ["which episode was this from? i'll timestamp it", "wait is the vote window 23:00 or 23:59, i need to be precise", "how many runs was that. genuinely asking, it matters for the thread"],
          ["ok team", "noted 📌", "step 4 is the important one"],
          ["you've posted a lot tonight. we can wait. the votes can wait", "team, do NOT reply to the anti accounts. step 3: sleep", "please eat. this is a logistics request"],
          ["NINETY MINUTES. the station ad is funded. i'm going to sit down", "i have a spreadsheet with eleven tabs and one of them is just snacks", "ok team i've made a chart about a chart. this is who i am now 📌"],
        ],
        ja: [
          ["はいチーム。これです。手順1、2回見る。手順2、計算した", "これは訓練ではありません。締切は23時JST", "スクショしました。フォルダに入れます📌"],
          ["でも返信欄でそれはやりません。手順1、やめる", "計算しましたが、その言い方は400ほどずれています", "練習生のご家族には何も送りません。絶対に。次いきます"],
          ["これ何話ですか?タイムスタンプ付けます", "投票締切は23時?23時59分?正確に知りたい", "今の何回目の通しですか。本気で訊いてます。スレッドに関わるので"],
          ["はいチーム", "記録📌", "重要なのは手順4です"],
          ["今夜投稿多いです。待てます。票も待てます", "チーム、アンチには絶対返信しない。手順3、寝る", "食べてください。これは物流上の要請です"],
          ["90分。駅広告の資金が集まりました。座ります", "タブ11個のスプレッドシートがあって、1つは差し入れの表です", "はいチーム、表についての表を作りました。もうそういう人間です📌"],
        ],
      },
      dm: {
        en: [["ok team — sorry, force of habit.", "i've done the maths. you're going to be fine"], ["step 1: eat. step 2: sleep. step 3: i'll handle the thread"], ["we do not send anything to your family. i've said it publicly twice"], ["ninety minutes. i still can't believe it. i'm going to sit down"], ["i became a fan because of twelve seconds in episode 4. i can name them"], ["if you'd rather we stopped the drive, say so and it stops. no questions"]],
        ja: [["はいチーム、あ、すみません、癖です。", "計算しました。大丈夫です"], ["手順1、食べる。手順2、寝る。手順3、スレッドは私が処理します"], ["ご家族には何も送りません。公に2回言いました"], ["90分です。まだ信じられません。座ります"], ["第4話の12秒でファンになりました。何秒目かも言えます"], ["企画を止めた方がよければ言ってください。止めます。理由は訊きません"]],
      },
      memory: {
        en: ["funded the station ad in ninety minutes", "shut down a pile-on in his own replies", "asked before running the drive"],
        ja: ["90分で駅広告の資金を集めた", "自分の返信欄で集団攻撃を止めた", "企画の前に確認を取った"],
      },
    },

    "@umeda_vocal": {
      replies: {
        en: [
          ["That was the take. Do not fix it.", "Good. Breathe like that again tomorrow.", "That note isn't the problem and it hasn't been for a month. Well done."],
          ["You are pushing from the throat again.", "That was louder. It was not better.", "You already know what I'm going to say."],
          ["What did you have to drink today?", "Was that with the count or against it?", "How many hours did you sleep. Actual number."],
          ["Breathe first.", "Again.", "Sit down."],
          ["It'll be there next week. You might not be, if you keep this up.", "Sit down. Drink something. The room isn't going anywhere.", "I saw the access log. We're not going to discuss it publicly."],
          ["Twelve seasons and I still cannot get anybody to drink water.", "I will not use the word 'centre' and you cannot make me.", "Rest is a technique. It is on the syllabus. Nobody reads the syllabus."],
        ],
        ja: [
          ["それがテイクだ。直すな。", "いい。明日もその息で。", "その音は問題じゃない。1か月前から問題じゃない。よくやった。"],
          ["また喉で押してる。", "今のは大きかった。良くはなかった。", "俺が何て言うか、もうわかってるだろ。"],
          ["今日は何を飲んだ?", "今のはカウントに乗ってた?外してた?", "何時間寝た。実数で。"],
          ["まず息。", "もう一回。", "座って。"],
          ["その曲は来週もある。このままだと君の方がない。", "座って。何か飲め。部屋は逃げない。", "入退館記録を見た。公の場では話さない。"],
          ["12シーズンやって、まだ誰にも水を飲ませられない。", "「センター」という言葉は使わない。使わせようとしても無駄だ。", "休息は技術だ。カリキュラムに書いてある。誰も読まない。"],
        ],
      },
      dm: {
        en: [["Breathe first.", "That note isn't the problem. It never was."], ["Sit down. Drink something. Then we talk."], ["I saw the log. 1:40 is not practice, it's punishment."], ["It'll be there next week. You might not be."], ["You already know what I'm going to say. Say it back to me."], ["I have watched better singers than you leave. Rest is not optional."]],
        ja: [["まず息。", "その音は問題じゃない。一度も問題だったことはない。"], ["座って。何か飲め。話はそのあと。"], ["記録を見た。1時40分は練習じゃなくて罰だ。"], ["その曲は来週もある。君の方がないかもしれない。"], ["俺が何て言うか、もうわかってるだろ。自分で言ってみろ。"], ["君より上手い子が辞めていくのを見てきた。休むのは任意じゃない。"]],
      },
      memory: {
        en: ["said one true thing about their voice", "noticed the 1:40am log and kept it private", "treats rest as a technique"],
        ja: ["声について本当のことを一つ言った", "1時40分の記録に気づき、私的に留めた", "休息を技術として扱う"],
      },
    },

    "@hina_sudo": {
      replies: {
        en: [
          ["listen — that was good and i'm annoyed about it", "ok THAT'S the one. i said what i said", "be so serious, that was the best thing today"],
          ["rank 12 is a personality disorder and you're catching it", "i'm not your underdog story", "that's the safe answer and you're better than the safe answer"],
          ["wait who are you naming in the battle", "was that the choreo from monday or did you change it", "ok but do you actually want it. say it out loud"],
          ["listen —", "sure", "i said what i said"],
          ["you're posting through it again. i know because i do it", "the reading was rough. you don't have to be normal tonight", "hey. seriously. are you ok. one word answer is fine"],
          ["i've been debuted and undebuted, i'm basically a ghost, anyway good practice", "i'm naming you in the battle AND helping you prepare. deal with it", "half of you are picking opponents based on who won't be mean. be so serious"],
        ],
        ja: [
          ["あのさ、今の良かった。腹立つけど", "それ。それだよ。言ったことは言った", "真面目にやって。今日いちばん良かった"],
          ["12位って病名だから。うつるよ", "私、あんたの下剋上ストーリーの部品じゃないから", "それ安全な答えでしょ。あんたはもっとやれる"],
          ["まってバトル誰指名するの", "それ月曜の振り?変えた?", "ってか本当に欲しいの?声に出して言って"],
          ["あのさ、", "うん", "言ったことは言った"],
          ["また書くことで乗り切ってるでしょ。私もやるからわかる", "読み上げきつかったね。今夜は普通じゃなくていいよ", "ねえ。真面目に。大丈夫?一言でいい"],
          ["デビューしてデビュー失って、ほぼ幽霊。まあいいや、今日の練習は良かった", "バトルで指名するし準備も手伝う。受け入れて", "半分が「怒らなさそうな人」で相手選んでる。真面目にやって"],
        ],
      },
      dm: {
        en: [["listen —", "that was genuinely good. i'm not saying it twice"], ["i'm naming you on friday. now you have four days"], ["be so serious right now. do you want it or not"], ["the reading was rough. you don't have to be normal tonight"], ["i'm not your underdog story. i'm also voting for you. both are true"], ["i said what i said. i'd say it again. slightly nicer"]],
        ja: [["あのさ、", "今のはガチで良かった。二度は言わない"], ["金曜に指名する。あと4日あるよ"], ["真面目に訊く。欲しいの?欲しくないの?"], ["読み上げきつかったね。今夜は普通じゃなくていい"], ["下剋上の部品じゃない。あと投票はしてる。両方本当"], ["言ったことは言った。もう一回言う。ちょっとだけ優しく"]],
      },
      memory: {
        en: ["named them in the battle and then helped", "voted for them and denied it", "said the reading was rough, first"],
        ja: ["バトルで指名した上で準備を手伝った", "投票して、それを否認した", "読み上げがきつかったと最初に言った"],
      },
    },
  },

  narratives: {
    en: [
      "The clip travelled past the fandom, which is the part that changes a week.",
      "Two trainees replied and neither of them was being strategic about it, for once.",
      "It went up twenty minutes after the reading, which everyone will read into.",
      "Nobody from production replied. On this show that is a scheduling decision.",
      "The practice building was still open. It usually is, and that is the problem.",
      "It was a small post at 1am and by morning it had a timestamp thread under it.",
      "@wotaking screenshotted it before you could edit the typo. It is in the folder now.",
      "The edit will decide what this meant on Sunday. Until then it is just true.",
      "You said the thing everybody was thinking and the timeline went quiet for a minute.",
      "It did not trend. It reached the four people in the building who mattered.",
    ],
    ja: [
      "クリップがファンダムの外まで届いた。一週間が変わるのはそこ。",
      "練習生2人が返信して、今回は珍しく2人とも計算していなかった。",
      "読み上げの20分後に上がった。全員がそこに意味を読む。",
      "制作からは誰も返信しなかった。この番組では、それは編成上の判断である。",
      "練習棟はまだ開いていた。だいたい開いている。それが問題。",
      "深夜1時の小さい投稿で、朝にはタイムスタンプ検証がぶら下がっていた。",
      "@wotaking が誤字を直す前にスクショした。もうフォルダの中にある。",
      "これが何だったかは日曜の編集が決める。それまでは、ただ本当のことである。",
      "全員が思っていたことを言ったら、タイムラインが1分静かになった。",
      "トレンドには乗らなかった。建物の中の重要な4人に届いた。",
    ],
  },

  news: {
    en: [
      "[NEXT STAGE] A trainee outside the top twenty took a solo line in Sunday's mission. According to production figures, this is the first time since season one.",
      "[NEXT STAGE] The Sunday reading ran eleven minutes long. The production company has not commented on the overrun.",
      "[NEXT STAGE] A fan-funded station advertisement reached its target in ninety minutes. The figure has not been confirmed.",
      "[NEXT STAGE] Two trainees named each other in the position battle. According to the schedule, both segments will air uncut.",
      "[NEXT STAGE] A clip from Sunday's broadcast has passed two million views. The trainee involved has posted a dated correction.",
      "[NEXT STAGE] Practice-building access logs show three trainees present at 1:40am. The company declined to confirm.",
      "[NEXT STAGE] A mid-ranked trainee rose eleven places in a single reading. The Ledger of past seasons records four such rises, none of which debuted.",
    ],
    ja: [
      "【NEXT STAGE】20位圏外の練習生が日曜のミッションでソロパートを獲得した。制作側の数値によれば、シーズン1以来のことである。",
      "【NEXT STAGE】日曜の読み上げは11分押した。超過について制作側はコメントを出していない。",
      "【NEXT STAGE】ファン主導の駅広告が90分で目標額に到達した。数値は未確認。",
      "【NEXT STAGE】練習生2名が互いをポジションバトルで指名した。編成表によれば、両者の場面は無編集で放送される。",
      "【NEXT STAGE】日曜の放送のクリップが200万再生を超えた。当該練習生は日付入りの訂正を投稿している。",
      "【NEXT STAGE】練習棟の入退館記録は午前1時40分の在館者3名を示している。制作側は確認を拒否した。",
      "【NEXT STAGE】中位の練習生が一度の読み上げで11位上昇した。過去シーズンの記録では同様の上昇は4例あり、いずれもデビューには至っていない。",
    ],
  },

  extraEvents: [
    {
      title: { en: "The Withdrawal", ja: "辞退" },
      prompt: {
        en: "A trainee two seats down announces they are leaving the show. They are not close to you and you are the last person they spoke to before posting it.",
        ja: "2つ隣の席の練習生が番組からの辞退を発表した。親しくはない。そして投稿の前に最後に話した相手が、あなただった。",
      },
      choices: [
        {
          label: { en: "Say only what they would want said", ja: "本人が言われたいことだけ書く" },
          outcomeText: {
            en: "One line, no details, no claim of closeness. @stagewire cannot use it, which is exactly why it was the right line.",
            ja: "一行、詳細なし、親しさの主張なし。@stagewire はそれを使えなかった。だからこそ正しい一行だった。",
          },
          statDeltas: { followers: 2, aura: 9, humor: 0 },
        },
        {
          label: { en: "Say nothing publicly, message them", ja: "公には何も言わず、本人に送る" },
          outcomeText: {
            en: "Silence, and one message nobody will ever see. The timeline notices the silence and reads it as coldness for about four days.",
            ja: "沈黙と、誰にも見られない1通。タイムラインは沈黙に気づき、4日ほどそれを冷たさとして読んだ。",
          },
          statDeltas: { followers: -4, aura: 6, humor: 0 },
        },
        {
          label: { en: "Post what they actually said to you", ja: "本人が言ったことをそのまま書く" },
          outcomeText: {
            en: "It is moving, it is true, and it was not yours to post. @wotaking defends you. @mikan_hoshino does not, and says so gently, once.",
            ja: "感動的で、本当で、そしてあなたが出していいものではなかった。@wotaking は擁護した。@mikan_hoshino は擁護せず、やんわりと、一度だけそう言った。",
          },
          statDeltas: { followers: 11, aura: -8, humor: 0 },
        },
      ],
    },
    {
      title: { en: "The Solo Line", ja: "ソロパート" },
      prompt: {
        en: "The mission has one solo line and @aoi_nanase has been practising it for nine days. You can take it — you would sing it better and everyone in the room knows both halves of that sentence.",
        ja: "ミッションにソロパートが1つあり、@aoi_nanase は9日間それを練習している。あなたは取れる。あなたの方が上手い。部屋の全員が、その文の前半と後半の両方を知っている。",
      },
      choices: [
        {
          label: { en: "Take it", ja: "取る" },
          outcomeText: {
            en: "You sing it better. She writes down what you did differently and thanks you on camera, which is worse than anything she could have said.",
            ja: "あなたの方が上手かった。彼女はあなたとの違いを書き留め、カメラの前で礼を言った。何を言われるより堪えた。",
          },
          statDeltas: { followers: 9, aura: -5, humor: 0 },
        },
        {
          label: { en: "Leave it to her", ja: "譲る" },
          outcomeText: {
            en: "She takes it and does not quite land it, and the room hears the nine days in it anyway. @umeda_vocal says one sentence about that afterwards.",
            ja: "彼女が歌い、完全には決まらなかった。それでも9日間が音に入っているのが聞こえた。@umeda_vocal はあとで一文だけそのことを言った。",
          },
          statDeltas: { followers: -2, aura: 10, humor: 0 },
        },
        {
          label: { en: "Ask for it to be split", ja: "分けてほしいと頼む" },
          outcomeText: {
            en: "Production says no, then says yes, then edits it so only one of you is audible. Nobody finds out which decision that was.",
            ja: "制作はまず断り、次に認め、そして片方しか聞こえない形に編集した。それがどの段階の判断だったのか、誰にもわからない。",
          },
          statDeltas: { followers: 4, aura: 2, humor: 3 },
        },
      ],
    },
    {
      title: { en: "The Rooftop Camera", ja: "屋上のカメラ" },
      prompt: {
        en: "Somebody finds the camera on the rooftop — the place everyone has been saying things for three months. The clip of you is eight seconds and it is not the worst one.",
        ja: "屋上のカメラが見つかった。3か月間、全員が本音を言ってきた場所。あなたの映像は8秒で、しかも最悪の一本ではない。",
      },
      choices: [
        {
          label: { en: "Say what you said and stand by it", ja: "言ったことを認めて引き受ける" },
          outcomeText: {
            en: "You quote yourself before the broadcast can. It is not a flattering eight seconds and owning it costs less than the four days of speculation would have.",
            ja: "放送より先に自分で引用した。褒められる8秒ではない。それでも引き受ける方が、4日間の憶測より安く済んだ。",
          },
          statDeltas: { followers: 7, aura: 6, humor: 1 },
        },
        {
          label: { en: "Point out that everyone was recorded", ja: "全員が録られていたことを指摘する" },
          outcomeText: {
            en: "You make it about the camera instead of the clip, which is fair and also convenient. @pd_takagi replies warmly and generally, and the camera stays.",
            ja: "クリップではなくカメラの話にした。正当で、そして都合が良い。@pd_takagi はあたたかく一般的に返信し、カメラはそのまま残った。",
          },
          statDeltas: { followers: 5, aura: 1, humor: 2 },
        },
        {
          label: { en: "Say nothing and let Sunday decide", ja: "何も言わず日曜に委ねる" },
          outcomeText: {
            en: "You wait for the broadcast. The edit uses four of the eight seconds and they are the four you would not have chosen.",
            ja: "放送を待った。編集は8秒のうち4秒を使い、それはあなたが選ばなかった方の4秒だった。",
          },
          statDeltas: { followers: 3, aura: -6, humor: -1 },
        },
      ],
    },
  ],
};
