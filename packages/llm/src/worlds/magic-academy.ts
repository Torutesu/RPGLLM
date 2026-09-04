import type { WorldSeed } from "@rpgllm/shared";
import { buildWorld, type WorldSource } from "./build.js";
import { cast, outro, prose } from "./magic-academy.bible.js";

/**
 * magic-academy (difficulty 3) — press account @thequill.
 * First-follower candidates: @emberwyn, @marrowfinch, @kittarrow, @prefectlocke,
 * @poppybramble, @cassnull.
 */
const source: WorldSource = {
  slug: "magic-academy",
  difficulty: 3,
  title: { en: "Magic Academy Politics", ja: "魔術学院の政治" },
  scenario: {
    en: "You tested into an 800-year-old school on results alone. The ranking board updates on Thursday.",
    ja: "実技の結果だけで創立800年の学院に入った。序列表の更新は木曜日。",
  },
  prose,
  outro,
  cast,

  presetPersonas: [
    {
      handle: "@thornwake",
      displayName: { en: "Thornwake", ja: "ソーンウェイク" },
      bio: {
        en: "second-year. no name, no patron, three clean bindings.",
        ja: "2年。家名なし、後援者なし、きれいな結びが3つ。",
      },
      avatarKey: "mag-persona-thorn",
    },
    {
      handle: "@lampcut",
      displayName: { en: "Lampcut", ja: "ランプカット" },
      bio: {
        en: "works nights in the hall. do not ask about the ceiling.",
        ja: "夜間にホールで作業してる。天井の話はしないで。",
      },
      avatarKey: "mag-persona-lamp",
    },
    {
      handle: "@fenbrew",
      displayName: { en: "Fenbrew", ja: "フェンブリュー" },
      bio: {
        en: "i have opinions about the tea and about the Ledger. mostly the tea.",
        ja: "お茶と序列表について意見がある。だいたいお茶の方。",
      },
      avatarKey: "mag-persona-fen",
    },
    {
      handle: "@stairling",
      displayName: { en: "Stairling", ja: "ステアリング" },
      bio: {
        en: "400 steps a day. everything important happens on step 212.",
        ja: "1日400段。重要なことは全部212段目で起きる。",
      },
      avatarKey: "mag-persona-stair",
    },
    {
      handle: "@vellumhand",
      displayName: { en: "Vellumhand", ja: "ヴェラムハンド" },
      bio: {
        en: "copies old bindings by hand. yes it's slower. that's the point.",
        ja: "古い結びを手で写している。遅い。そこがいい。",
      },
      avatarKey: "mag-persona-vellum",
    },
    {
      handle: "@nineknots",
      displayName: { en: "Nineknots", ja: "ナインノッツ" },
      bio: {
        en: "nine knots, eight of them wrong, one of them beautiful.",
        ja: "結び目9個、うち8個は失敗、1個は美しい。",
      },
      avatarKey: "mag-persona-nine",
    },
    {
      handle: "@quietloom",
      displayName: { en: "Quietloom", ja: "クワイエットルーム" },
      bio: {
        en: "clean work or nothing. mostly nothing so far.",
        ja: "きれいな仕事か、何もしないか。今のところほぼ何もしていない。",
      },
      avatarKey: "mag-persona-loom",
    },
  ],

  presetEvents: [
    {
      title: { en: "The Thursday Ledger", ja: "木曜の序列表" },
      prompt: {
        en: "The Ledger updates and you are above @emberwyn for the first time. By a single place. The hall goes quiet in the specific way it does when everyone is reading the same board.",
        ja: "序列表が更新され、初めて @emberwyn の上に出た。1つだけ上。全員が同じ板を読んでいるときの、あの独特の静けさがホールに落ちる。",
      },
      choices: [
        {
          label: { en: "Say nothing at all", ja: "何も言わない" },
          outcomeText: {
            en: "You do not post. @thequill reports it anyway, with a line about entrance rules. @emberwyn replies to the Quill, not to you: 'The result stands. I'd ask that nobody make it a story.' It is already a story.",
            ja: "何も投稿しなかった。@thequill は入学規定に触れる一行を添えて報じた。@emberwyn は The Quill にだけ返した。「結果は結果です。話にしないでいただきたい。」もう話になっている。",
          },
          statDeltas: { followers: 3, aura: 8, humor: 0 },
        },
        {
          label: { en: "Credit the work, not the placing", ja: "順位ではなく作業に触れる" },
          outcomeText: {
            en: "You post the binding diagram and nothing else. Half the year screenshots it. @marrowfinch files a copy without being asked, which from Marrow is applause.",
            ja: "結びの図だけを上げた。学年の半分がスクショした。@marrowfinch が頼まれてもいないのに写しを綴じた。マロウにとってそれは拍手である。",
          },
          statDeltas: { followers: 6, aura: 5, humor: 1 },
        },
        {
          label: { en: "Post the joke you have been holding", ja: "温めていた冗談を投げる" },
          outcomeText: {
            en: "'first time reading the Ledger without scrolling.' It runs the whole school by lunch. @kittarrow has already put it on a door. @emberwyn does not reply, which everyone notices.",
            ja: "「序列表をスクロールせずに読んだの初めて」。昼までに学校中を走った。@kittarrow はもう扉に貼っている。@emberwyn は返信しなかった。全員が気づいた。",
          },
          statDeltas: { followers: 9, aura: -2, humor: 8 },
        },
      ],
    },
    {
      title: { en: "The Frayed Demonstration", ja: "ほつれた実演" },
      prompt: {
        en: "@kittarrow's binding frays in the Filament Hall in front of forty people. You were the nearest witness, which means the failure is partly filed under your name unless somebody says otherwise.",
        ja: "@kittarrow の結びが40人の前でフィラメント・ホールでほつれた。最も近くにいた証人はあなた。誰かが違うと言わない限り、その失敗はあなたの名前でも綴じられる。",
      },
      choices: [
        {
          label: { en: "Take the witness mark", ja: "証人の記録を引き受ける" },
          outcomeText: {
            en: "You sign it without comment. @prefectlocke logs it and adds, for the record, that the witness volunteered. @kittarrow does not thank you on the wire and says the single most direct thing they have ever said, in a DM, once.",
            ja: "無言で署名した。@prefectlocke は記録し、「証人は自ら名乗り出た」と付記した。@kittarrow はワイヤーでは礼を言わず、DMで一度だけ、これまでで最も直球なことを言った。",
          },
          statDeltas: { followers: -2, aura: 9, humor: 0 },
        },
        {
          label: { en: "State exactly what happened", ja: "起きたことを正確に述べる" },
          outcomeText: {
            en: "Four sentences, no blame, one diagram. It is accurate and it is public and it makes @kittarrow look careless, which is true and unkind at the same time. @emberwyn replies 'That is the correct account.' It does not help.",
            ja: "4文、非難なし、図1枚。正確で、公開で、@kittarrow を不注意に見せる。それは本当であり、同時に冷たい。@emberwyn が「それが正しい記述です」と返した。救いにはならない。",
          },
          statDeltas: { followers: 4, aura: 2, humor: -3 },
        },
        {
          label: { en: "Blame the hall's wards", ja: "ホールの結界のせいにする" },
          outcomeText: {
            en: "It is plausible. It is also checkable, and @profsableveil checks it, and posts one question: 'And what did you expect to happen?' The thread ends there.",
            ja: "もっともらしい。そして検証可能で、@profsableveil が検証し、質問を1つ投稿した。「で、何が起きると思っていたのですか?」スレッドはそこで終わった。",
          },
          statDeltas: { followers: 1, aura: -8, humor: -1 },
        },
      ],
    },
    {
      title: { en: "Cass Makes the Case", ja: "キャスの論" },
      prompt: {
        en: "@cassnull pins your entrance result and argues, publicly and well, that you are the proof the Ledger is indefensible. Every honest answer costs you standing. Silence costs something else.",
        ja: "@cassnull があなたの入学結果をピン留めし、「序列表が擁護不能であることの証拠がこれだ」と公に、しかも上手く論じた。誠実な答えは全て順位を削る。沈黙は別のものを削る。",
      },
      choices: [
        {
          label: { en: "Agree, and say what it cost you", ja: "同意し、自分が払ったものを言う" },
          outcomeText: {
            en: "You agree with the argument and add the part Cass could not: what two years of it actually did. Thornmarket shares it four hundred times. Somewhere on the hill, a door quietly closes.",
            ja: "論に同意し、キャスには書けなかった部分を足した。2年間それが実際に何をしたか。ソーンマーケットで400回共有された。丘の上のどこかで、扉が一つ静かに閉まった。",
          },
          statDeltas: { followers: 12, aura: 4, humor: 0 },
        },
        {
          label: { en: "Refuse to be an argument", ja: "論の材料になることを拒む" },
          outcomeText: {
            en: "'I'm not a mechanism. Name a different one.' Cass replies within a minute: 'Fair. I'll do that.' and does, better, and you have made an honest enemy who respects you.",
            ja: "「私は機構じゃない。別のを名指しして。」キャスは1分で返した。「もっともだ。そうする。」そして実際にやり、しかもより上手くやった。あなたは、あなたを尊重する誠実な敵を作った。",
          },
          statDeltas: { followers: 2, aura: 7, humor: 2 },
        },
        {
          label: { en: "Defend the Ledger", ja: "序列表を擁護する" },
          outcomeText: {
            en: "You argue that the board is at least honest about what it measures. @emberwyn agrees with you, in public, at length. It is the worst possible endorsement and both of you know it.",
            ja: "少なくともあの板は測っているものについては正直だ、と論じた。@emberwyn が公の場で長文で同意した。考えうる最悪の援護であり、二人ともそれを理解している。",
          },
          statDeltas: { followers: -4, aura: -2, humor: -2 },
        },
      ],
    },
    {
      title: { en: "The Sealed File", ja: "封印された記録" },
      prompt: {
        en: "@marrowfinch says, unprompted, that there is a record of your entrance under the wrong category and that nobody has ever asked to see it. They are not offering. They are informing.",
        ja: "@marrowfinch が、訊いてもいないのに言った。あなたの入学記録は誤った分類で綴じられていて、これまで誰もそれを見せろと言っていない、と。申し出ではない。通告である。",
      },
      choices: [
        {
          label: { en: "Ask to see it", ja: "見せてほしいと頼む" },
          outcomeText: {
            en: "Third floor, second shelf, bring your own light. What is in it is not a scandal — it is a mark from an examiner who has since left, and it says one sentence that reframes your entire first year.",
            ja: "3階、2番棚、灯りは自分で。中身は醜聞ではない。すでに学院を去った試験官の所見が一つ。その一文が、あなたの1年目の全部の意味を変えた。",
          },
          statDeltas: { followers: 0, aura: 8, humor: 0 },
        },
        {
          label: { en: "Ask them to correct the filing", ja: "分類を直してほしいと頼む" },
          outcomeText: {
            en: "'I keep everything. That is the job.' Marrow will not alter a record, and says so kindly, and files your request, which is now also a record.",
            ja: "「全部残します。それが仕事です。」マロウは記録を書き換えない。優しくそう言い、あなたの依頼を綴じた。その依頼もまた記録になった。",
          },
          statDeltas: { followers: 0, aura: -3, humor: 1 },
        },
        {
          label: { en: "Post about it before anyone else can", ja: "誰かに書かれる前に自分で書く" },
          outcomeText: {
            en: "You publish the fact of it yourself, plainly. @thequill loses the story by having it handed to them. It is the first time this term the wire has watched somebody defuse the Quill.",
            ja: "その事実を自分で、そっけなく公開した。@thequill は手渡されたことでネタを失った。今学期、ワイヤーが「The Quill を無力化する誰か」を見たのは初めてだった。",
          },
          statDeltas: { followers: 7, aura: 5, humor: 3 },
        },
      ],
    },
    {
      title: { en: "Sable's Problem", ja: "セイブルの課題" },
      prompt: {
        en: "@profsableveil sets you a binding problem nobody else in the year received, with a note: 'Come at four. Bring the frayed one.' The school spends the afternoon deciding whether this is favour or execution.",
        ja: "@profsableveil が、学年で誰も受け取っていない結びの課題をあなたにだけ出した。添え書きは「4時にいらっしゃい。ほつれた方を持って。」厚遇なのか処刑なのか、学校は午後じゅう議論している。",
      },
      choices: [
        {
          label: { en: "Bring the failed binding, unrepaired", ja: "失敗した結びを直さずに持っていく" },
          outcomeText: {
            en: "You bring it frayed. She looks at it for a long time and says: 'You are not wrong. You are early.' You will think about that sentence for three years.",
            ja: "ほつれたまま持っていった。彼女は長いこと眺めてから言った。「間違ってはいません。早すぎるだけです。」その一文を、あなたは3年間考え続けることになる。",
          },
          statDeltas: { followers: 2, aura: 10, humor: 0 },
        },
        {
          label: { en: "Repair it perfectly first", ja: "完璧に直してから持っていく" },
          outcomeText: {
            en: "It is clean work and she says so, once, without adjectives. Then: 'That was the interesting part. You skipped it.' The compliment and the wound arrive in the same breath.",
            ja: "きれいな仕事で、彼女は形容詞なしで一度だけそう言った。そのあと。「そこが面白いところでした。飛ばしましたね。」賛辞と傷が同じ息で届いた。",
          },
          statDeltas: { followers: 5, aura: 2, humor: 0 },
        },
        {
          label: { en: "Post the problem publicly and crowdsource it", ja: "課題を公開して全員で解く" },
          outcomeText: {
            en: "Forty students attack it overnight. @kittarrow gets eleven seconds of something extraordinary. Sable's only comment is 'I marked it as I found it', and nobody can tell who that is aimed at.",
            ja: "40人が一晩で殴りかかった。@kittarrow が11秒だけ尋常でないものを出した。セイブルのコメントは「見たままに採点しました」の一言だけで、それが誰に向いているのか誰にもわからない。",
          },
          statDeltas: { followers: 11, aura: -1, humor: 5 },
        },
      ],
    },
  ],

  fallbackReplies: {
    "@emberwyn": {
      en: ["With respect, no.", "That isn't the argument.", "Noted. It's still wrong.", "Clean work or don't post it.", "I read the whole thing before replying."],
      ja: ["失礼ながら、違います。", "それは論点ではありません。", "了解。それでも誤りです。", "きれいな仕事でないなら投稿しないで。", "全文読んでから返信しました。"],
    },
    "@thequill": {
      en: ["It is reported.", "Faculty declined to comment.", "The Ledger records otherwise.", "This has happened before.", "Developing, as ever."],
      ja: ["と報じられている。", "教職員はコメントを拒否した。", "序列表の記録は異なる。", "以前も起きている。", "例によって続報あり。"],
    },
    "@marrowfinch": {
      en: ["Curious.", "There is a record of that.", "I would not, if I were you.", "Third floor, second shelf.", "Ask a better question."],
      ja: ["興味深い。", "その記録はあります。", "私なら、やめておきます。", "3階、2番棚。", "もっと良い質問を。"],
    },
    "@kittarrow": {
      en: ["ok wait", "genuinely though", "i've solved it (i have not)", "do NOT tell finch", "eleven seconds is a result"],
      ja: ["ちょっと待って", "マジでさ", "解決した(してない)", "フィンチには言うな", "11秒動いたら成果でしょ"],
    },
    "@prefectlocke": {
      en: ["Noted.", "That's a warning, not a report.", "Take it to the stair.", "You know I have to log this.", "I just read the Ledger out loud."],
      ja: ["了解。", "これは警告であって報告ではない。", "その話は階段で。", "記録しないといけない。わかるだろ。", "序列表を読み上げてるだけだ。"],
    },
    "@profsableveil": {
      en: ["And what did you expect?", "You are early.", "Come at four.", "I marked it as I found it.", "That was the interesting part."],
      ja: ["で、何が起きると思っていたのですか?", "早すぎるだけです。", "4時にいらっしゃい。", "見たままに採点しました。", "そこが面白いところでした。"],
    },
    "@poppybramble": {
      en: ["oh!!", "i made you one", "you don't have to explain", "come sit on the stair", "you've not eaten today have you"],
      ja: ["わ!!", "1個作っといた", "説明しなくていいよ", "階段座りなよ", "今日なんも食べてないでしょ"],
    },
    "@cassnull": {
      en: ["name the mechanism", "who does that serve", "that's not a rebuttal", "i was second. i know what it's worth.", "null it."],
      ja: ["機構を名指しして", "それは誰の得になる", "それは反論じゃない", "私は2位だった。価値は知ってる。", "ヌルして。"],
    },
  },

  welcomePosts: {
    "@emberwyn": {
      en: "For the record: the second-year who placed on results is on the wire now. I'd ask that people be accurate about them rather than kind. Accuracy is the higher compliment.",
      ja: "記録として。実技の結果だけで入った2年生がワイヤーに来ました。優しくするより正確であってほしい。正確さの方が上の賛辞です。",
    },
    "@marrowfinch": {
      en: "A new account. I have filed it. That is not a threat; it is simply what happens here. Third floor if you ever want to see your own record.",
      ja: "新しいアカウント。綴じました。脅しではありません。ここではそうなるというだけです。自分の記録を見たくなったら3階へ。",
    },
    "@kittarrow": {
      en: "ok wait my roommate is ON THE WIRE. everyone be normal. i will not be normal. i've already told four people and two of them were plants",
      ja: "ちょっと待ってルームメイトがワイヤーに来た。全員落ち着いて。俺は落ち着かない。もう4人に言った。うち2人は植物だった",
    },
    "@prefectlocke": {
      en: "Noted, and welcome. I'd ask that first posts stay off the Ledger discourse for a week. That is advice, not a rule. This term, anyway.",
      ja: "了解、ようこそ。最初の一週間は序列表の話題から離れておくことをお勧めする。規則ではなく助言だ。今学期は、だが。",
    },
    "@poppybramble": {
      en: "oh!! new account!! i've been leaving tea outside your door since week two and i was never going to say so, so, now you know 🌱",
      ja: "わ!!新しいアカウント!!2週目からずっとドアの外にお茶置いてたんだけど言うつもりなかったので、まあ、これで知ったことになるね🌱",
    },
    "@cassnull": {
      en: "new account, no lineage, top ten by result. that's not a compliment to you, it's an indictment of everyone above you. welcome to the wire.",
      ja: "新しいアカウント、家名なし、結果だけで上位10位。これはあなたへの賛辞じゃなくて、あなたより上の全員への告発だ。ワイヤーへようこそ。",
    },
    "@profsableveil": {
      en: "Noted. I will expect the frayed one on Thursday.",
      ja: "承知しました。木曜にほつれた方を持ってきなさい。",
    },
    "@thequill": {
      en: "It is reported that a second-year without lineage has opened an account on the wire. The Ledger records three such accounts in the last decade; two were closed by the disciplinary board.",
      ja: "家名を持たない2年生がワイヤーにアカウントを開いたと報じられている。序列表の記録によれば過去10年で同様の例は3件、うち2件は懲戒委員会によって閉じられた。",
    },
  },

  ambientPool: {
    en: [
      { handle: "@kittarrow", text: "ok wait if you bind the intent BEFORE you name it the thread doesn't argue with you. i've solved it. i have not solved it" },
      { handle: "@poppybramble", text: "there's fen-tea on the second landing and i've put honey in it because it is legally undrinkable otherwise 🌱" },
      { handle: "@thequill", text: "It is reported that the Ledger will be posted an hour late this week. Faculty declined to explain the delay." },
      { handle: "@emberwyn", text: "If you are going to correct someone's diagram in public, correct all of it. Half a correction is just noise." },
      { handle: "@marrowfinch", text: "Someone has returned a book to the wrong floor for the ninth time this term. I know who. Curious." },
      { handle: "@cassnull", text: "genuine question for the hill: name the mechanism by which ranking sixteen-year-olds produces better work. i'll wait. i've been waiting four years" },
      { handle: "@prefectlocke", text: "Reminder that the Long Stair is not a common room and I am not going to keep pretending I can't see you." },
      { handle: "@kittarrow", text: "it worked for eleven seconds. ELEVEN. that's a result. finch says it's a fire hazard. it's both" },
      { handle: "@poppybramble", text: "the stairwell tomatoes survived the cold snap and i genuinely cried about it, no notes" },
      { handle: "@emberwyn", text: "The Thursday hall is not a performance. If you need an audience to hold a binding you have built it wrong." },
      { handle: "@thequill", text: "The Ledger records four students moving three or more places this week. This is the largest weekly movement since the entrance rules changed." },
      { handle: "@marrowfinch", text: "The archive is open until second bell. Bring your own light. I am not the lighting." },
      { handle: "@cassnull", text: "thornmarket teaches filament work on saturdays, free, no board, no ranking. sixty people came. that's the whole post" },
      { handle: "@prefectlocke", text: "That's a warning, not a report. You know which one of you this is for." },
      { handle: "@poppybramble", text: "no because who told the first-years the Ledger matters in week three, i'm going to fight them, gently" },
      { handle: "@kittarrow", text: "genuinely though the under-library smells like rain and paper and i would live there if finch let me. finch will not let me" },
      { handle: "@emberwyn", text: "I'd note that 'it worked once' and 'it works' are different claims, and only one of them is examinable." },
      { handle: "@thequill", text: "Faculty declined to comment on Thursday's hall result. This is the third such refusal this term." },
      { handle: "@marrowfinch", text: "There is a record of that. There is a record of most things. That is rather the point of a record." },
      { handle: "@cassnull", text: "'we're a meritocracy' says the school that lets you retake an exam if your family paid for the hall it's held in" },
      { handle: "@poppybramble", text: "i made too much soup again. second landing. no you don't have to talk to me, just take some" },
      { handle: "@prefectlocke", text: "The Ledger goes up at noon. I don't make it. I just read it out loud and then everyone is strange at me for a day." },
    ],
    ja: [
      { handle: "@kittarrow", text: "ちょっと待って、名付ける前に意図を結ぶと糸が反論してこないんだが。解決した。解決してない" },
      { handle: "@poppybramble", text: "2階の踊り場にフェン茶置いといた。蜂蜜入れた。そうしないと法的に飲めない味だから🌱" },
      { handle: "@thequill", text: "今週の序列表は1時間遅れて掲示されると報じられている。教職員は遅延の理由の説明を拒否した。" },
      { handle: "@emberwyn", text: "人の図を公開で訂正するなら全部訂正してください。半分の訂正はただの雑音です。" },
      { handle: "@marrowfinch", text: "今学期9回目、本が違う階に返却されています。誰かは知っています。興味深い。" },
      { handle: "@cassnull", text: "丘の上に本気で訊きたい。16歳に順位を付けると良い仕事が出る、その機構を名指ししてくれ。待つよ。4年待ってる" },
      { handle: "@prefectlocke", text: "ロング・ステアは談話室ではない。見えていないふりを続けるつもりはない。" },
      { handle: "@kittarrow", text: "11秒動いた。11秒。成果でしょ。フィンチは火災リスクだと言ってる。両方だよ" },
      { handle: "@poppybramble", text: "踊り場のトマトが寒波を越えた。マジで泣いた。補足なし" },
      { handle: "@emberwyn", text: "木曜のホールは公演ではありません。結びを保つのに観客が要るなら、その結びは作りが間違っています。" },
      { handle: "@thequill", text: "序列表の記録によれば今週3つ以上順位を動かした学生は4名。入学規定改定以降で最大の週次変動である。" },
      { handle: "@marrowfinch", text: "アーカイブは第二の鐘まで開いています。灯りはご自分で。私は照明ではありません。" },
      { handle: "@cassnull", text: "ソーンマーケットでは土曜にフィラメント術を無料で教えてる。板もない、順位もない。60人来た。以上" },
      { handle: "@prefectlocke", text: "これは警告であって報告ではない。誰に向けてかは自分でわかっているはずだ。" },
      { handle: "@poppybramble", text: "だってさ、3週目の1年生に「序列表が大事」って吹き込んだの誰。やんわり戦いに行くけど" },
      { handle: "@kittarrow", text: "マジでさ、アンダーライブラリって雨と紙の匂いがして、フィンチが許すなら住みたい。フィンチは許さない" },
      { handle: "@emberwyn", text: "一点だけ。「一度動いた」と「動く」は別の主張であり、試験できるのは片方だけです。" },
      { handle: "@thequill", text: "木曜のホールの結果について教職員はコメントを拒否した。今学期3件目の拒否である。" },
      { handle: "@marrowfinch", text: "その記録はあります。たいていのことに記録はあります。それが記録というものですから。" },
      { handle: "@cassnull", text: "「うちは実力主義だ」と言う学校が、ホールの建設費を出した家の子には再試験を認めている件" },
      { handle: "@poppybramble", text: "またスープ作りすぎた。2階の踊り場。話しかけなくていいから、持っていって" },
      { handle: "@prefectlocke", text: "序列表は正午に出る。作ってるのは俺じゃない。読み上げてるだけで、そのあと一日みんなの態度が変になる。" },
    ],
  },
};

export const magicAcademy: WorldSeed = buildWorld(source);
export default magicAcademy;
