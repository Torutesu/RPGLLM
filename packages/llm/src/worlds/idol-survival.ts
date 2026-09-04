import type { WorldSeed } from "@rpgllm/shared";
import { buildWorld, type WorldSource } from "./build.js";
import { cast, outro, prose } from "./idol-survival.bible.js";

/**
 * idol-survival (difficulty 2) — press account @stagewire.
 * First-follower candidates: @mikan_hoshino, @ruri_kurosaki, @aoi_nanase, @wotaking,
 * @umeda_vocal, @hina_sudo.
 */
const source: WorldSource = {
  slug: "idol-survival",
  difficulty: 2,
  title: { en: "Idol Survival", ja: "アイドルサバイバル" },
  scenario: {
    en: "Forty-eight trainees, twelve chairs, and a live ranking every Sunday night decided by the audience.",
    ja: "練習生48人、椅子は12脚。毎週日曜の生放送で、視聴者が順位を決める。",
  },
  prose,
  outro,
  cast,

  presetPersonas: [
    {
      handle: "@rin_practice",
      displayName: { en: "Rin", ja: "リン" },
      bio: {
        en: "trainee. floor 3 regular. one more run.",
        ja: "練習生。3階の常連。もう一回だけ。",
      },
      avatarKey: "idol-persona-rin",
    },
    {
      handle: "@yuzu_003",
      displayName: { en: "Yuzu", ja: "ユズ" },
      bio: {
        en: "number 003. i talk too much on camera and i'm keeping it.",
        ja: "003番。カメラの前で喋りすぎる。直しません。",
      },
      avatarKey: "idol-persona-yuzu",
    },
    {
      handle: "@souta_late",
      displayName: { en: "Souta", ja: "ソウタ" },
      bio: {
        en: "started late, catching up loudly.",
        ja: "始めるのが遅かったぶん、うるさく追いついてる。",
      },
      avatarKey: "idol-persona-souta",
    },
    {
      handle: "@mio_stage",
      displayName: { en: "Mio", ja: "ミオ" },
      bio: {
        en: "dance position. i count in my sleep.",
        ja: "ダンスポジション。寝ながらカウント取ってる。",
      },
      avatarKey: "idol-persona-mio",
    },
    {
      handle: "@kanade_n1",
      displayName: { en: "Kanade", ja: "カナデ" },
      bio: {
        en: "vocal. i want it. saying so is not a crime.",
        ja: "ボーカル。欲しい。そう言うのは罪じゃない。",
      },
      avatarKey: "idol-persona-kanade",
    },
    {
      handle: "@hoshi_two",
      displayName: { en: "Hoshi", ja: "ホシ" },
      bio: {
        en: "second season, second chance, same shoes.",
        ja: "2シーズン目、2回目のチャンス、同じ靴。",
      },
      avatarKey: "idol-persona-hoshi",
    },
    {
      handle: "@nagi_backline",
      displayName: { en: "Nagi", ja: "ナギ" },
      bio: {
        en: "back line and proud. the back line is the shape.",
        ja: "後列担当、誇りあり。後列が形を作ってる。",
      },
      avatarKey: "idol-persona-nagi",
    },
  ],

  presetEvents: [
    {
      title: { en: "The Reading", ja: "読み上げ" },
      prompt: {
        en: "Sunday, live, slowest first. They read your name eleven places higher than last week and the camera stays on your face for four full seconds. @hina_sudo, one seat over, drops off the line.",
        ja: "日曜、生放送、下位から。先週より11個上であなたの名前が呼ばれ、カメラは4秒間あなたの顔から離れない。隣の席の @hina_sudo は、ラインから落ちた。",
      },
      choices: [
        {
          label: { en: "Post the gratitude line and nothing else", ja: "感謝ポストだけ上げる" },
          outcomeText: {
            en: "You write the formula everyone writes. It is correct and it is safe and three hundred people reply that it sounds like a form. @wotaking defends you with a numbered list.",
            ja: "全員が書く定型を書いた。正しくて、安全で、300人が「テンプレっぽい」と返信した。@wotaking が番号付きリストで擁護した。",
          },
          statDeltas: { followers: 2, aura: -2, humor: 0 },
        },
        {
          label: { en: "Say the seat next to you is empty", ja: "隣の席が空いたことを書く" },
          outcomeText: {
            en: "'rank 23. the seat next to me is empty and i'm not going to pretend that's a good night.' It runs everywhere. @hina_sudo replies 'be so serious. take the seat.' and means both halves.",
            ja: "「23位。隣の席が空いた。今夜が良い夜だったふりはしない。」全方位に広がった。@hina_sudo が「真面目にやって。席は取りな。」と返した。両方本気だった。",
          },
          statDeltas: { followers: 8, aura: 9, humor: 0 },
        },
        {
          label: { en: "Post the practice-room clip from Tuesday", ja: "火曜の練習室のクリップを上げる" },
          outcomeText: {
            en: "No comment about the ranking at all — just eleven seconds of a run that did not work, from three days ago. @umeda_vocal replies 'That note isn't the problem.' Everyone screenshots it.",
            ja: "順位には一切触れず、3日前の失敗した通しの11秒だけ。@umeda_vocal が「その音は問題じゃない。」と返した。全員がスクショした。",
          },
          statDeltas: { followers: 5, aura: 6, humor: 2 },
        },
      ],
    },
    {
      title: { en: "The Edit", ja: "編集" },
      prompt: {
        en: "Sunday's broadcast cut you looking bored while another trainee cried. It was a different day and a different room. The clip is at two million views by Monday morning.",
        ja: "日曜の放送で、別の練習生が泣いている横であなたが退屈そうにしている画が使われた。別の日、別の部屋の素材だった。クリップは月曜朝で200万再生。",
      },
      choices: [
        {
          label: { en: "Say exactly what day it was", ja: "何日の素材かを正確に書く" },
          outcomeText: {
            en: "One line, a date, no complaint attached. @stagewire runs it as a correction, which the production company does not enjoy. @pd_takagi replies warmly and generally, which tells you everything.",
            ja: "一行、日付、不満なし。@stagewire が訂正として報じた。制作は喜ばなかった。@pd_takagi はあたたかく、一般的に返信した。それで全部わかった。",
          },
          statDeltas: { followers: 7, aura: 3, humor: 0 },
        },
        {
          label: { en: "Let the fans handle it", ja: "ファンに任せる" },
          outcomeText: {
            en: "@wotaking assembles a timestamp thread in forty minutes and it is airtight. It also keeps the clip alive for three more days, which nobody wanted.",
            ja: "@wotaking が40分でタイムスタンプ付きの検証を組み上げた。完璧だった。そしてクリップの寿命を3日延ばした。誰も望んでいなかった。",
          },
          statDeltas: { followers: 4, aura: -1, humor: 0 },
        },
        {
          label: { en: "Make the joke first", ja: "先に自分でネタにする" },
          outcomeText: {
            en: "'edit-san i was blinking. i have to blink.' It defuses the whole thing in one post and @hina_sudo quote-posts it eleven times. @ruri_kurosaki likes it, which is unprecedented.",
            ja: "「編集さん、あれ瞬きです。瞬きはします。」1投稿で全部解けた。@hina_sudo が11回引用した。@ruri_kurosaki がいいねを押した。前代未聞。",
          },
          statDeltas: { followers: 6, aura: 1, humor: 9 },
        },
      ],
    },
    {
      title: { en: "The Position Battle", ja: "ポジションバトル" },
      prompt: {
        en: "Position battle week. You have to name an opponent, out loud, on camera. @aoi_nanase is climbing four places a week and would take it as an honour. @ruri_kurosaki would take it as a Tuesday.",
        ja: "ポジションバトルの週。カメラの前で、声に出して相手を指名しなければならない。@aoi_nanase は週に4つ上げていて、指名されたら光栄だと思うだろう。@ruri_kurosaki は火曜日の出来事だと思うだろう。",
      },
      choices: [
        {
          label: { en: "Name @ruri_kurosaki", ja: "@ruri_kurosaki を指名する" },
          outcomeText: {
            en: "The room makes a noise. Ruri says 'Fine.' and nothing else for four days, then sends you the second-eight correction the night before. You do not win. You are not the same afterwards.",
            ja: "スタジオがざわついた。ルリは「いい。」とだけ言い、4日間何も言わず、前夜に2エイト目の修正だけ送ってきた。勝てなかった。そのあとの自分は同じではなかった。",
          },
          statDeltas: { followers: 12, aura: 7, humor: 0 },
        },
        {
          label: { en: "Name @aoi_nanase", ja: "@aoi_nanase を指名する" },
          outcomeText: {
            en: "She writes it down, on camera, and thanks you. You win narrowly and it feels like nothing. She improves more from losing than you did from winning and everyone can see it.",
            ja: "彼女はカメラの前でそれをメモに書き、礼を言った。僅差で勝った。何も感じなかった。彼女は負けたことで、あなたが勝ったこと以上に伸びた。全員に見えていた。",
          },
          statDeltas: { followers: 3, aura: -4, humor: 0 },
        },
        {
          label: { en: "Name @hina_sudo", ja: "@hina_sudo を指名する" },
          outcomeText: {
            en: "'listen — finally.' She is delighted and merciless and helps you rehearse the part she is going to beat you on. The broadcast makes it the episode. It is the most fun either of you has had all season.",
            ja: "「あのさ、やっとか。」彼女は喜び、容赦なく、自分が勝つ予定の箇所の練習に付き合った。放送はそれを回のメインにした。今季二人とも、一番楽しかった。",
          },
          statDeltas: { followers: 9, aura: 2, humor: 7 },
        },
      ],
    },
    {
      title: { en: "Floor Three", ja: "3階" },
      prompt: {
        en: "1am in the practice building. @aoi_nanase is on floor three and has been for an hour. Someone with a phone is on the stairs. You are the only other person awake.",
        ja: "深夜1時の練習棟。@aoi_nanase が3階にいて、もう1時間になる。階段にスマホを持った誰かがいる。起きているのは他にあなただけ。",
      },
      choices: [
        {
          label: { en: "Sit with her and say nothing online", ja: "隣に座り、オンラインでは何も言わない" },
          outcomeText: {
            en: "You stay until 3am. Nothing about it appears anywhere, from you. It appears anyway, badly, from the stairs — and the one account that refuses to share it is @wotaking, loudly.",
            ja: "3時までいた。あなたからは何もどこにも出なかった。それでも階段から、雑な形で出た。唯一それを拡散しないと明言したのは @wotaking で、しかも大声だった。",
          },
          statDeltas: { followers: 0, aura: 10, humor: 0 },
        },
        {
          label: { en: "Post a general line about floor three", ja: "3階について一般論で1行書く" },
          outcomeText: {
            en: "'floor three is busy tonight. it's fine. it's just busy.' Nobody is named and everybody knows. @mikan_hoshino replies with a heart and no words, which is the correct answer.",
            ja: "「今夜の3階は混んでる。大丈夫。ただ混んでるだけ。」誰も名指ししていないのに全員わかっている。@mikan_hoshino が言葉なしで心だけ返した。それが正解だった。",
          },
          statDeltas: { followers: 4, aura: 4, humor: 1 },
        },
        {
          label: { en: "Tell the person on the stairs to delete it", ja: "階段の人に消せと言う" },
          outcomeText: {
            en: "You say it out loud and it is heard by more people than you intended. The clip gets deleted. You are now, permanently, the trainee who confronts people, which is a role the edit likes very much.",
            ja: "声に出して言った。意図より多くの人に聞かれた。クリップは消された。あなたは以後ずっと「人に詰める練習生」になった。編集はその役どころが大好きである。",
          },
          statDeltas: { followers: 6, aura: -3, humor: -2 },
        },
      ],
    },
    {
      title: { en: "The Vote Drive", ja: "投票企画" },
      prompt: {
        en: "@wotaking has funded a station ad for you in ninety minutes without asking. It is generous, it is enormous, and half the timeline is already calling it manipulation.",
        ja: "@wotaking が、相談なしに90分であなたの駅広告の資金を集めた。気前がよく、規模が大きく、そしてタイムラインの半分がすでに「操作だ」と言っている。",
      },
      choices: [
        {
          label: { en: "Thank them and name the amount", ja: "礼を言い、金額を明示する" },
          outcomeText: {
            en: "You post the figure and ask people not to send any more. @wotaking is mortified and then, on reflection, extremely proud. The manipulation argument dies within the hour.",
            ja: "金額を出し、これ以上は送らないでほしいと書いた。@wotaking は恐縮し、そのあとよく考えてから、猛烈に誇らしくなった。操作論は1時間で消えた。",
          },
          statDeltas: { followers: 5, aura: 8, humor: 0 },
        },
        {
          label: { en: "Ask them to redirect it to the trainee below the line", ja: "ラインの下の練習生に回してほしいと頼む" },
          outcomeText: {
            en: "It is the right thing and it is also, unavoidably, a move. @hina_sudo posts 'i'm not your underdog story' and then votes for you anyway, which she will deny forever.",
            ja: "正しい行いであり、同時にどうしても「手」でもある。@hina_sudo が「私、あんたの下剋上ストーリーの部品じゃないから」と投稿し、そのうえで投票した。永久に否認するだろう。",
          },
          statDeltas: { followers: -2, aura: 11, humor: 2 },
        },
        {
          label: { en: "Say nothing and let it run", ja: "何も言わずに走らせる" },
          outcomeText: {
            en: "The ad goes up. So does your rank. So does a four-hundred-reply thread about whether fan money should decide a broadcast, and your silence is quoted in all of it.",
            ja: "広告は出た。順位も上がった。そして「ファンの金が放送を決めていいのか」という400返信のスレッドも立ち、その全部であなたの沈黙が引用された。",
          },
          statDeltas: { followers: 10, aura: -5, humor: 0 },
        },
      ],
    },
  ],

  fallbackReplies: {
    "@mikan_hoshino": {
      en: ["ok ok ok", "we run it again", "floor three was busy tonight", "you did the hard part already", "i'm not being nice, i'm being right"],
      ja: ["はいはいはい", "もう一回まわそ", "今夜の3階は混んでた", "難しいとこはもう終わってるよ", "優しくしてるんじゃなくて正しいこと言ってる"],
    },
    "@stagewire": {
      en: ["[NEXT STAGE] Noted.", "According to Sunday's broadcast.", "The production company has not commented.", "The figure has not been confirmed.", "This is the first time since season one."],
      ja: ["【NEXT STAGE】記録。", "日曜の放送によると。", "制作側はコメントを出していない。", "数値は未確認。", "シーズン1以来のことである。"],
    },
    "@ruri_kurosaki": {
      en: ["Fine.", "From the second eight.", "That was better and you know it.", "Rank isn't a personality.", "I don't do camera-off."],
      ja: ["いい。", "2エイト目から。", "今のは良くなった。自分でわかってるでしょ。", "順位は人格じゃない。", "カメラ切れてからの話はしない。"],
    },
    "@pd_takagi": {
      en: ["Please keep supporting them.", "That's the show.", "Real growth this week.", "I don't edit the votes.", "Everyone here chose to be here."],
      ja: ["引き続き応援をお願いします。", "それが番組です。", "今週は確かな成長が見えました。", "票は編集できません。", "ここにいる全員が、自分でここを選びました。"],
    },
    "@aoi_nanase": {
      en: ["i wrote it down", "one more run", "sorry — not sorry, working on it", "thank you for the real version", "i genuinely can't see it yet"],
      ja: ["書いときました", "もう一回だけ", "すみません、あ、直します", "本当のほう言ってくれてありがとうございます", "まだ自分では見えないんです"],
    },
    "@wotaking": {
      en: ["ok team", "i've done the maths", "deadline is 23:00 JST", "step 4 is the important one", "this is not a drill"],
      ja: ["はいチーム", "計算した", "締切は23時JST", "重要なのは手順4です", "これは訓練ではありません"],
    },
    "@umeda_vocal": {
      en: ["Breathe first.", "That note isn't the problem.", "Sit down. Drink something.", "You already know what I'm going to say.", "It'll be there next week."],
      ja: ["まず息。", "その音は問題じゃない。", "座って。何か飲め。", "俺が何て言うか、もうわかってるだろ。", "その曲は来週もある。"],
    },
    "@hina_sudo": {
      en: ["listen —", "i said what i said", "be so serious", "rank 12 is a personality disorder", "i'm not your underdog story"],
      ja: ["あのさ、", "言ったことは言った", "真面目にやって", "12位って病名でしょ", "私、あんたの下剋上ストーリーの部品じゃないから"],
    },
  },

  welcomePosts: {
    "@mikan_hoshino": {
      en: "ok ok ok my roommate finally made an account. everyone be normal. i've watched this person run the same eight bars four hundred times. we run it again tomorrow",
      ja: "はいはいはい、同室の子がやっとアカウント作った。全員落ち着いて。この人が同じ8小節を400回まわしてるの見てるからね。明日ももう一回まわすよ",
    },
    "@ruri_kurosaki": {
      en: "New account. Fine. From the second eight, the timing is already better than most of the top ten. That's all.",
      ja: "新しいアカウント。いい。2エイト目からのタイミングは、もう上位10人の大半より良い。以上。",
    },
    "@aoi_nanase": {
      en: "there's a new account!! i wrote down three things you told me in week two and i still use all of them. sorry — not sorry. thank you for the real version 🙇",
      ja: "新しいアカウントだ!!2週目に教えてもらったこと3つ書き留めてて、今も全部使ってます。すみません、あ、直します。本当のほう言ってくれてありがとうございます🙇",
    },
    "@wotaking": {
      en: "ok team. new account, verified, this is the one from the twelve-second clip in episode 4. step 1: follow. step 2: i'll post the vote schedule at 21:00.",
      ja: "はいチーム。新しいアカウント、本物、第4話の12秒のクリップの人です。手順1、フォロー。手順2、21時に投票スケジュールを出します。",
    },
    "@umeda_vocal": {
      en: "A new account. Good. Breathe first, post second. And drink something — I have watched you skip that all week.",
      ja: "新しいアカウントか。いい。まず息、投稿はそのあと。あと何か飲め。今週ずっと飛ばしてるのを見てる。",
    },
    "@hina_sudo": {
      en: "listen — the middle of the ranking just got interesting. new account, follow it, i said what i said. (i'm still naming you in the battle.)",
      ja: "あのさ、順位の真ん中が面白くなってきた。新しいアカウント、フォローして、言ったことは言った。(バトルでは指名するけど。)",
    },
    "@pd_takagi": {
      en: "A new trainee account is live. The trainees have worked incredibly hard this season. Please keep supporting them.",
      ja: "新しい練習生のアカウントが公開されました。今季、練習生たちは本当によく頑張っています。引き続き応援をお願いします。",
    },
    "@stagewire": {
      en: "[NEXT STAGE] A mid-ranked trainee has opened an official STAGE account ahead of Sunday's reading. According to production figures, accounts opened mid-season correlate with a rank change of four or more.",
      ja: "【NEXT STAGE】中位の練習生が日曜の読み上げを前に公式STAGEアカウントを開設した。制作側の数値によれば、シーズン途中の開設は4以上の順位変動と相関する。",
    },
  },

  ambientPool: {
    en: [
      { handle: "@mikan_hoshino", text: "floor three was busy tonight. everyone's fine. we run it again tomorrow" },
      { handle: "@aoi_nanase", text: "i wrote down what sensei said about the second verse and then i wrote down why, which is the part i keep forgetting to do 🙇" },
      { handle: "@stagewire", text: "[NEXT STAGE] Sunday's broadcast ran eleven minutes long. According to the schedule, this is the third overrun this season." },
      { handle: "@hina_sudo", text: "listen — rank 12 is not a rank, it's a personality disorder. anyway. good practice today" },
      { handle: "@wotaking", text: "ok team. step 1: vote. step 2: do NOT reply to the anti accounts. step 3: sleep. deadline is 23:00 JST. i've done the maths" },
      { handle: "@umeda_vocal", text: "Three of you were still in the building at 1:40am. It will be there next week. You might not be, if you keep this up." },
      { handle: "@ruri_kurosaki", text: "From the second eight. Not the first. The first one is fine." },
      { handle: "@pd_takagi", text: "The trainees worked incredibly hard on this mission. We're seeing real growth. Please keep supporting them." },
      { handle: "@mikan_hoshino", text: "someone put honey in the practice room kettle and i have to know who so i can thank them and also ask why" },
      { handle: "@aoi_nanase", text: "one more run. ok two more. sorry — not sorry, i'm working on that" },
      { handle: "@hina_sudo", text: "be so serious right now. the position battle is in four days and half of you are picking based on who won't be mean about it" },
      { handle: "@wotaking", text: "reminder: we do not send anything to a trainee's family, ever. if you see it, report it, don't quote it. step 4 is the important one" },
      { handle: "@stagewire", text: "[NEXT STAGE] Two trainees outside the top thirty were given solo lines in Sunday's mission. The production company has not commented." },
      { handle: "@umeda_vocal", text: "Breathe first. That note isn't the problem. It has never once been the note." },
      { handle: "@ruri_kurosaki", text: "Rank isn't a personality. Neither is being humble about it." },
      { handle: "@mikan_hoshino", text: "i'm not being nice, i'm being right: the back line is carrying that formation and nobody has said so on camera" },
      { handle: "@aoi_nanase", text: "the mirrors on floor 5 are the honest ones. i've been avoiding floor 5 for a week and that's the whole post" },
      { handle: "@hina_sudo", text: "i said what i said and then the edit cut it in half so now i've said something else. incredible" },
      { handle: "@wotaking", text: "ninety minutes. NINETY. the station ad is funded. team, i'm going to sit down now" },
      { handle: "@pd_takagi", text: "Everyone here chose to be here. That is not a small thing and I don't take it lightly." },
      { handle: "@umeda_vocal", text: "Sit down. Drink something. The room isn't going anywhere and neither is the chorus." },
      { handle: "@stagewire", text: "[NEXT STAGE] The Sunday reading will run forty minutes as usual. This is the first time since season one that the order has leaked in advance." },
    ],
    ja: [
      { handle: "@mikan_hoshino", text: "今夜の3階は混んでた。みんな大丈夫。明日もう一回まわそ" },
      { handle: "@aoi_nanase", text: "先生が2番について言ったこと書き留めて、そのあと理由も書きました。理由の方をいつも書き忘れるので🙇" },
      { handle: "@stagewire", text: "【NEXT STAGE】日曜の放送は11分押した。編成表によれば、今季3度目の超過である。" },
      { handle: "@hina_sudo", text: "あのさ、12位って順位じゃなくて病名だから。まあいいや。今日の練習は良かった" },
      { handle: "@wotaking", text: "はいチーム。手順1、投票。手順2、アンチには絶対返信しない。手順3、寝る。締切は23時JST。計算した" },
      { handle: "@umeda_vocal", text: "3人がまだ1時40分に建物にいた。その曲は来週もある。このままだと君らの方がない。" },
      { handle: "@ruri_kurosaki", text: "2エイト目から。1エイト目じゃない。あれはいい。" },
      { handle: "@pd_takagi", text: "練習生たちは今回のミッションを本当によく頑張りました。確かな成長が見えています。引き続き応援をお願いします。" },
      { handle: "@mikan_hoshino", text: "練習室のケトルに蜂蜜入れたの誰。お礼を言いたいのと、あと理由を聞きたい" },
      { handle: "@aoi_nanase", text: "もう一回だけ。あと2回だけ。すみません、あ、直します" },
      { handle: "@hina_sudo", text: "真面目にやって。ポジションバトル4日後だよ。半分が「怒らなさそうな人」で選んでるでしょ" },
      { handle: "@wotaking", text: "再周知。練習生のご家族には何も送りません。見かけたら通報、引用はしない。重要なのは手順4です" },
      { handle: "@stagewire", text: "【NEXT STAGE】30位圏外の練習生2名が日曜のミッションでソロパートを与えられた。制作側はコメントを出していない。" },
      { handle: "@umeda_vocal", text: "まず息。その音は問題じゃない。一度も音が問題だったことはない。" },
      { handle: "@ruri_kurosaki", text: "順位は人格じゃない。それを謙遜するのも人格じゃない。" },
      { handle: "@mikan_hoshino", text: "優しくしてるんじゃなくて正しいこと言ってる。あのフォーメーション、後列が支えてる。カメラの前で誰も言ってない" },
      { handle: "@aoi_nanase", text: "5階の鏡は正直なんです。1週間5階を避けてます。以上です" },
      { handle: "@hina_sudo", text: "言ったことは言ったのに編集が半分に切ったから、今は別のことを言ったことになってる。すごい" },
      { handle: "@wotaking", text: "90分。90分です。駅広告の資金が集まりました。チーム、私はいったん座ります" },
      { handle: "@pd_takagi", text: "ここにいる全員が、自分でここを選びました。それは小さなことではないし、軽く扱うつもりもありません。" },
      { handle: "@umeda_vocal", text: "座って。何か飲め。部屋も逃げないし、サビも逃げない。" },
      { handle: "@stagewire", text: "【NEXT STAGE】日曜の読み上げは例年通り40分の予定。順番が事前に流出したのはシーズン1以来である。" },
    ],
  },
};

export const idolSurvival: WorldSeed = buildWorld(source);
export default idolSurvival;
