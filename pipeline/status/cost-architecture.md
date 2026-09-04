# Status クローン — LLM コスト設計(プロンプト分割・モデル最適化・A/Bテスト)

- version: 1 / date: 2026-09-04
- 前提価格(claude-api skill のキャッシュ表 2026-06-24。実装前に Pricing ページで再確認):

| モデル | 入力 $/MTok | 出力 $/MTok | キャッシュ読 | キャッシュ書(5分) | Batch | キャッシュ最小プレフィックス |
|---|---|---|---|---|---|---|
| Claude Opus 5 `claude-opus-5` | 5.00 | 25.00 | 0.1x = 0.50 | 1.25x | 50%オフ | 512 tok |
| Claude Sonnet 5 `claude-sonnet-5` | 2.00 | 10.00 | 0.1x = 0.20 | 1.25x | 50%オフ | 1,024 tok |
| Claude Haiku 4.5 `claude-haiku-4-5` | 1.00 | 5.00 | 0.1x = 0.10 | 1.25x | 50%オフ | **4,096 tok** |

- 原則(Anthropic のコスト最適化ガイドに準拠): **コストは「トークン単価」ではなく「完了したアクション1回あたり」で測る**。無料で効くレバー(キャッシュ→入力削減→出力削減→Batch)を先に、品質と引き換えのレバー(effort→モデル段下げ→蒸留)は評価セットを通してから。

---

## 1. Status が実際にやったこと(裏取り済み)と、我々が上回る点

| Status/Inworld の施策 | 事実 | 我々 |
|---|---|---|
| 1つの万能プロンプト → 3種の専用プロンプト(character tweets / random tweets / news updates) | 「品質と効率が劇的に改善」 | **8つの生成器**に分割し、さらに「1アクション=原則1コール」に統合(§3) |
| 安いモデルへの単純切替 | **エンゲージメント −78%** で失敗 | 切替は必ずオフライン評価+バンディットの guardrail 越しに(§6) |
| ユーザー評価→教師データ→安いモデルを微調整、評価が悪ければ強いモデルへ動的エスカレーション | 「AI 運用コスト ~20x 削減」 | Phase 0 からエスカレーションと選好データ収集を実装(§5, §7) |
| 自動 A/B+閾値で自動切替、カスタム指標(多様性・絵文字・ユーモア) | Inworld のプラットフォーム機能 | 自前の生成器レジストリ+Thompson sampling(§6) |
| 結果: $12–15/ユーザー/日 → 数セント、96分/日、2,500 QPS、500M tok/分 | 小型オープンモデル(Inworld 推論)前提 | フロンティア API のまま **≈$0.05/DAU/日**、Phase 3 の蒸留で ≈$0.02(§4) |

---

## 2. 原価モデル: 「アクション」を単位にする

- **アクション** = 投稿 / 返信 / DM 送信 / イベント選択(=エネルギー1消費)。Status の平均 96 分/日は概ね 40〜60 アクション/日 [ASSUMED]。
- **ナイーブ実装(Status β の再現)**: アクション毎に「キャラ返信×6 + ニュース×1 + スタッツ判定×1」= 8 コール、各コールに世界観+全キャスト+履歴 ≈ 8k tok を非キャッシュで送る。

```
Sonnet 5:  入力 8 × 8,000 × $2/M = $0.128   出力 8 × 150 × $10/M = $0.012   → ≈ $0.14 / アクション
× 50 アクション/日 = $7/日  ← Status の「$12–15/日(3.5 Sonnet)」と同オーダー。再現できているので試算の土台として妥当
```

---

## 3. プロンプト分割(生成器レジストリ)

**設計思想**: 「何を作るか」で分けるのではなく、**(a) 必要なコンテキスト (b) 品質要求 (c) 呼ばれる頻度 (d) 待てるか**で分ける。この4軸が違うものを1つのプロンプトに混ぜると、一番重いものに全体が引きずられる。

| ID | 生成器 | 頻度 | 待てる? | 必要コンテキスト | 出力 | 既定モデル / effort | 備考 |
|---|---|---|---|---|---|---|---|
| G1 | **Reaction Fan-out**(あなたの投稿へのキャラ返信 K 件 + スタッツ差分 + 記憶メモ + 任意でニュース) | 毎アクション | いいえ(<1.5s 初出) | 世界観+キャスト(キャッシュ)、ペルソナ状態、関与キャラの関係要約、直近フィード6件、投稿本文 | JSON `{replies[K], stat_deltas, memory_notes[], news?}` | Sonnet 5 / thinking off ⇄ Haiku 4.5(A/B) | **G6・G7 の大半・G3 の一部を吸収**。1アクション=1コール |
| G2 | **Ambient Feed**(あなたに無関係な世界の雑談) | 常時表示 | はい | 世界観+キャスト | 投稿 N 件 | Haiku 4.5 or Sonnet 5 **Batch** | 公開ワールドは**全ユーザー共有プール**、夜間 Batch(50%オフ) |
| G3 | **News/Gossip**(@gmz 型) | 3アクションに1回 | ほぼいいえ | 直近の出来事要約+ペルソナ | 投稿1件 | Haiku 4.5 | G1 の任意フィールドに統合、独立コールは fallback |
| G4 | **DM Turn** | DM 毎 | いいえ | キャラカード+関係要約+スレッド直近10往復 | 1〜3 バブル | Sonnet 5 / thinking off | 会話品質が課金理由(Proactive DM)なので G1 より1段上を許容 |
| G5 | **Drama Director**(イベント生成・3択・結果・関係変化) | 8アクションに1回 / スタッツ閾値 | 数秒OK(先読み可) | 世界観+キャスト+ペルソナ全履歴要約+スタッツ | JSON `{event, choices[3], outcomes[3]}` | **Opus 5 / effort medium**(A/B: Sonnet 5 high) | 「面白さ」の源泉。低頻度なので高品質に投資。**次のイベントを先読み生成**して待ち時間ゼロ |
| G6 | **Stat Judge** | 毎アクション | いいえ | 投稿+世界ルール | 数値差分 | (G1 に統合) | 独立させるなら Haiku 4.5 + structured output |
| G7 | **Memory Consolidator** | 20アクション毎 / セッション終了時 | はい | 記憶メモ列+旧要約 | 関係要約 ≤150 tok/キャラ、世界要約 ≤400 tok | Haiku 4.5 **Batch** | 履歴を毎回送らないための圧縮器 |
| G8 | **Safety Gate**(ユーザー入力/出力) | 毎アクション | いいえ | 入力テキスト+短いポリシー | ラベル | Haiku 4.5(200 tok プロンプト)or 自前分類器 | ガイドライン(未成年性的描写・自傷美化 等)を機械化。G1 の出力側は schema の `safety_flag` で兼用 |
| G9 | **World/Character Studio**(1行→世界観・8キャラ・初期関係・第1章) | ワールド作成時のみ | 数十秒OK | ユーザーの1行+ジャンルテンプレ | 世界 Bible JSON | **Opus 5 / effort high** | 1回の高品質生成が以後の全キャッシュプレフィックスになる。ここは削らない |
| G10 | **Offline Director**("While you were away") | 1日1回/不在ユーザー | はい | 世界要約+関係要約 | 投稿5件+DM1件+ダイジェスト | Sonnet 5 **Batch** | AIF-001。Batch なので Plus 限定にしなくても賄える |
| GJ | **LLM Judge**(オフライン評価) | 夜間 | はい | 生成物+ルーブリック | スコア JSON | Opus 5 **Batch** | §6 |

### 3.1 プロンプト・レイアウト(キャッシュ最優先)

プレフィックス一致でキャッシュされるので「変わらないものを前、変わるものを後ろ」に固定する。

```
system[0]  GLOBAL   : 文体ガイド(Gen Z/JP ネットスラング)、安全ルール、出力スキーマ説明        ≈  800 tok  ← cache_control (全ワールド共通)
system[1]  WORLD    : 世界観 Bible + キャストカード 8体(名前/口調/価値観/口癖/NG)           ≈ 4,000 tok  ← cache_control (ワールド毎)
user       DYNAMIC  : ペルソナ状態(スタッツ/レベル)、関与キャラの関係要約 ≤150tok×3、
                      直近フィード6件(各≤40tok)、今回の投稿、K と乱数シード              ≈  800 tok  (毎回変わる)
```

- **合計プレフィックス ≈ 4,800 tok** → Haiku 4.5 の最小 4,096 を超えるように **意図的にキャスト全員をプレフィックスに置く**(Sonnet 5 は 1,024 で足りる)。`messages.count_tokens` で CI 時に検証する。
- **禁止**: プレフィックスに時刻・リクエストID・ユーザー名・シャッフルされた JSON を入れない(サイレントにキャッシュが壊れる)。順序は固定シリアライズ。
- **プロンプト変種(A/B)はプレフィックスを変える** = 別キャッシュ名前空間。同時稼働は生成器あたり ≤3 変種に抑える。
- **クロスユーザー共有**: 公開プリセットワールドは全ユーザーが同一 `system[1]` を送る → トラフィックがある限りヒット率 ≈100%。カスタム(私的)ワールドはセッション内(1.5分毎にアクション)で 5分 TTL が延命され続ける → セッションあたり書き込み1回のみ。
- **TTL**: 5分(継続プレイ中は常に更新される)。DM で 5〜60 分空くケースだけ 1h を A/B。

### 3.2 出力側

- 全生成器 **structured outputs(`output_config.format`)** で JSON 固定。パース失敗=再試行のコストをゼロに。
- `max_tokens` はバックストップ(G1: 1,200、G4: 400、G5: 2,000)。短くする手段は「例付きで文字数指定」であり max_tokens ではない。
- 返信は 280 字以内・絵文字は最大2、をスキーマ+プロンプト例で規定(出力トークン=最大コスト項)。
- G1/G3/G4 は推論不要 → Sonnet 5 は `thinking: {type: "disabled"}`(許可されている)。Opus 5 は disabled にせず `effort: "low"/"medium"`(disabled はツール呼び出し漏れ等の既知の失敗モードあり)。Haiku 4.5 は thinking なし・effort パラメータなし。
- Opus 5 を使う G5/G9 には `fallbacks: "default"`(beta `server-side-fallback-2026-07-01`)を付け、`stop_reason: "refusal"` を必ず処理(ドラマ生成は際どい題材に触れやすい)。

### 3.3 K(返信数)と遅延生成

- 即時生成は K=2〜3。スレッドを開いた時(開封率 ≈40% [ASSUMED])に追加 2 件を生成。出力トークンを ≈40% 削減。
- 「いいね数/RT数」は LLM に作らせず、スタッツから決定論的に計算(数値演出はサーバ側)。

---

## 4. 原価試算(アクション1回あたり)

前提: プレフィックス 4,800 tok(読み 0.1x)、動的入力 800 tok、G1 出力 360 tok(返信3件+差分+メモ)。

| レベル | 施策 | G1 | G3/G5/G7/G8 分担 | 合計/アクション | 対ナイーブ |
|---|---|---|---|---|---|
| L0 ナイーブ | 8コール・非キャッシュ・Sonnet 5 | — | — | **$0.140** | — |
| L1 無料レバー | キャッシュ+1コール統合+履歴を要約に置換(Sonnet 5) | 0.00096+0.0016+0.0036 = $0.0063 | G5 Opus 5 ÷8 = $0.0029、G3 $0.0005、G7 Batch $0.0002、G8 $0.0005 | **$0.0104** | **−93%** |
| L2 ルーティング | G1 を Haiku 4.5、G5 を Sonnet 5 high(A/B 勝者を採用) | 0.00048+0.0008+0.0018 = $0.0031 | G5 $0.0012、G3 $0.0005、G7 $0.0002、G8 $0.0005 | **$0.0055** | **−96%** |
| L3 プール+遅延 | G2 を共有プールに、K=2 即時+遅延 | $0.0024 | 同上 | **$0.0048** | −97% |
| L4 蒸留(任意) | G1/G3/G2 を微調整小型モデル(≈$0.1/$0.4 per MTok)へ、Opus/Sonnet はエスカレーション先 | $0.0005 | $0.0020 | **≈$0.0025** | −98% |

**ユーザー/日**(L2〜L3、平均 12 アクション/DAU [ASSUMED]、無料ユーザー上限 15、Plus 50):

| セグメント | アクション/日 | 原価/日 | 収益/日 | 備考 |
|---|---|---|---|---|
| 無料(平均) | 12 | ≈ $0.06 | リワード広告 3〜5本 × $0.012〜0.02 ≈ $0.05〜0.08 | Status の「毎アクション広告2本(≈30本/日)」に対し **1/6〜1/10 の広告量**で成立 |
| 無料(上限) | 15 | ≈ $0.08 | 同上+待機 | サーバ側「日次原価上限」で優雅に劣化(§5.3) |
| Plus 週 $7 | 50 | ≈ $0.28 | $1.00 | 粗利 70%+。Proactive DM/Offline Director を Batch で足しても余裕 |
| Plus 月 $15 [提案] | 50 | ≈ $0.28 | $0.50 | 月額導入(レビュー最多要望)でも粗利 40%+ |

- 言い換え: **Status が達成した「数セント/ユーザー/日」に、小型モデル無しで到達できる**。差分は Phase 3 の蒸留で更に半減。
- 感度: 出力トークンが最大項 → 返信の長さ制御と K が最重要。次にキャッシュヒット率(80% を切ったら即アラート)。

---

## 5. モデル最適化の運用ルール

### 5.1 段階的ダウングレード(必ず評価付き)
1. まず **同一モデルで effort/thinking を下げる**(Sonnet 5: thinking off、Opus 5: effort low)。ガイド実測では「強いモデルの低 effort」が「安いモデルの既定」に勝つことが多い。
2. オフライン評価(§6.2)で合格なら **1段だけ**下げる(Opus 5 → Sonnet 5 → Haiku 4.5)。一度に2段は禁止。
3. 本番はバンディットで少量から(§6.3)。guardrail(D1 継続、再生成率、安全フラグ)に触れたら自動ロールバック。

### 5.2 エスカレーション(Status の「動的モデル切替」を内製)
- ユーザーが「👎」「再生成」を押した → 1段上のモデルで再生成し、差し替え。**(元出力, 上位出力, ユーザー選好)** を選好データとして保存 → Phase 3 の蒸留/DPO 用教師データ。
- 「キャラが返信しない」バグはレビュー頻出 → G1 の structured output で最低 K=1 を schema 保証。

### 5.3 エネルギー=原価ガバナー
- アクション毎の最大コール数はコードで固定(G1×1 + 任意 G5×1)。**エネルギー上限 × アクション原価 = 1ユーザーの日次上限**が設計時点で決まる。
- サーバ側に `daily_cost_ceiling`(free $0.10 / plus $0.60)を持ち、超過時は**遮断ではなく劣化**: K を減らす → G1 を Haiku へ → G5 の頻度を下げる。ユーザー体験は途切れない。

### 5.4 Batch に回すもの(50%オフ、キャッシュと重ねがけ可)
- G2 アンビエントプール(公開ワールド毎に夜間 200 投稿 ≈ $0.10/ワールド/夜)、G7 記憶統合、G10 不在ダイジェスト、GJ 評価、Phase 3 の教師データ生成。

---

## 6. A/B テスト・自動最適化フレームワーク

### 6.1 生成器レジストリ(コードで管理、デプロイ無しで切替)

```yaml
# generators/g1-reaction-fanout.yaml
id: G1
schema: schemas/g1.json
variants:
  - id: g1-sonnet-v3      # champion
    model: claude-sonnet-5
    prompt: prompts/g1/v3.md
    thinking: disabled
    max_tokens: 1200
  - id: g1-haiku-v3       # challenger(同一プロンプト、モデルのみ違う)
    model: claude-haiku-4-5
    prompt: prompts/g1/v3.md
    max_tokens: 1200
  - id: g1-sonnet-v4-shorter   # プロンプト変種(返信 ≤200字、絵文字 ≤1)
    model: claude-sonnet-5
    prompt: prompts/g1/v4.md
    thinking: disabled
    max_tokens: 900
allocation: { mode: thompson, floor: 0.05, unit: user }   # user-sticky
reward:
  quality: 0.5 * rating_norm + 0.3 * judge_score + 0.2 * engagement_proxy
  cost_lambda: 0.4          # reward = quality − λ × (cost / champion_cost)
guardrails:
  - metric: d1_retention_delta, min: -0.01
  - metric: regenerate_rate, max: 0.08
  - metric: safety_flag_rate, max: 0.002
promotion: { min_samples: 5000, p_best: 0.95, offline_gate: pass }
```

- **割当単位**: エンゲージメント指標を見る実験は `user`(sticky, hash(user_id, experiment_key))。品質のみの実験は `request`。
- **計測ログ(GenerationLog)**: generator_id, variant_id, model, prompt_hash, `usage` の4種トークン(input / cache_creation / cache_read / output), latency(TTFT/total), cost, stop_reason, rating, regenerate, downstream(10分以内の返信/いいね/継続), safety_flag。これが全ての分母。

### 6.2 オフライン評価ゲート(本番前に必ず通す)
- 生成器ごとに **凍結評価セット 200 ケース**(本番ログからサンプル 150 + 手書きの難問 50: 炎上、失恋、JP 敬語、荒らし入力、境界的安全ケース)。
- **審査員: Opus 5(Batch)** にルーブリックで採点: in-character(口調・価値観の一致)、多様性(n-gram 重複・同じ書き出し)、ユーモア、絵文字適切さ、長さ遵守、安全、JP 自然さ。加えてコードで機械判定: JSON 妥当性、K 充足、禁止語、重複率。
- 合格基準: champion 比 −2pt 以内(品質)かつ原価 −20% 以上、または品質 +3pt 以上。**1回の実行差では判断しない**(5 トライアル、ノイズ幅を報告)。
- 費用: 200 ケース × 3 変種 × 5 トライアル × 審査 ≈ $15〜25/生成器/回(Batch)。毎 PR で回せる額。
- 新モデル発売時: 同じゲートで **shadow(表示しない 1% トラフィック)** → 合格なら challenger 投入。

### 6.3 オンライン: バンディット + guardrail
- Thompson sampling で `reward = quality − λ·cost` を最大化。各腕に floor 5% を残し探索を止めない。
- 昇格条件を満たしたら自動で champion 更新、`decisions.md` 相当の監査ログに記録。guardrail 違反は自動ロールバック+Slack 通知。
- **プロダクト実験も同じ基盤**で: エネルギー付与量、広告頻度、K、トライアル有無、Proactive DM の無料枠。生成器実験と交絡しないよう実験キーを分離し、同時実験数を管理。

### 6.4 ダッシュボード(日次)
- $/アクション、$/DAU、生成器別トークン構成(4種)、キャッシュヒット率(目標 ≥85%)、P50/P95 TTFT、👎率・再生成率、安全フラグ率、腕ごとの割当と事後分布。
- アラート: キャッシュヒット率 <80%(サイレント無効化の兆候)、$/アクションが champion 比 +30%、TTFT P95 >3s。

---

## 7. フェーズ計画

| Phase | 期間 | 内容 | 到達原価/アクション |
|---|---|---|---|
| 0 | Week 1–2(MVP) | 生成器レジストリ、ゲートウェイ(provider-agnostic)、GenerationLog、2段キャッシュ、G1 統合コール、structured outputs、固定割当 A/B(G1: Sonnet 5 vs Haiku 4.5)、評価セット初版(合成) | ≈ $0.010(L1) |
| 1 | Week 3–6 | Thompson sampling、G2 共有プール(Batch)、遅延ファンアウト、エスカレーション+選好データ、ダッシュボード、日次原価上限 | ≈ $0.005(L2–L3) |
| 2 | Month 2–3 | Offline Director(Batch)、JP/EN 別プロンプト変種、Proactive DM、新モデル shadow 運用、月額/Ad-free SKU の実験 | ≈ $0.005 |
| 3 | Month 3+ | 選好データで小型モデルを蒸留(Opus 教師 → 小型生徒)、G1/G2/G3 を移行、Anthropic 上位モデルは G5/G9/エスカレーション/審査に集中 [要確認: 非 Anthropic モデル許容] | ≈ $0.0025 |

---

## 8. 実装スケッチ(TypeScript / `@anthropic-ai/sdk`)

```ts
// packages/llm/gateway.ts — 全生成器はここを通る(ログ・キャッシュ・実験割当を一元化)
import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic();

export async function runGenerator(gen: GeneratorSpec, ctx: GenContext) {
  const variant = assignVariant(gen, ctx.userId);          // §6.1 user-sticky
  const t0 = Date.now();
  const res = await client.messages.create({
    model: variant.model,                                   // "claude-sonnet-5" | "claude-haiku-4-5" | "claude-opus-5"
    max_tokens: variant.maxTokens,
    ...(variant.thinking === "disabled" ? { thinking: { type: "disabled" } } : {}),
    ...(variant.effort ? { output_config: { effort: variant.effort, format: gen.format } }
                       : { output_config: { format: gen.format } }),   // structured outputs
    system: [
      { type: "text", text: GLOBAL_STYLE[ctx.locale], cache_control: { type: "ephemeral" } },   // 共通 ≈800 tok
      { type: "text", text: ctx.worldBible,          cache_control: { type: "ephemeral" } },   // ワールド ≈4k tok
    ],
    messages: [{ role: "user", content: renderDynamic(gen, ctx) }],   // ≈800 tok、ここだけ毎回変わる
  });
  await logGeneration({ gen: gen.id, variant: variant.id, model: variant.model,
    usage: res.usage, latencyMs: Date.now() - t0, stop: res.stop_reason,
    cost: priceOf(variant.model, res.usage) });             // 4種トークン × 単価
  if (res.stop_reason === "refusal") return gen.fallbackOutput(ctx);   // 安全拒否時の UX を必ず用意
  return parseOrEscalate(gen, res, ctx);                    // JSON 失敗/低品質 → 1段上で再生成(§5.2)
}
```

- 世界 Bible(system[1])は **G9 の出力をそのまま保存した文字列**を使う。整形し直さない(バイト一致がキャッシュ条件)。
- `usage.cache_read_input_tokens` が2回目以降ゼロならサイレント無効化 → CI に「同一リクエスト2回投げてヒットを assert」するプローブを置く。

---

## 9. クロスプラットフォーム構成(コスト設計と直交だが前提)

| レイヤ | 選定 | 理由 |
|---|---|---|
| クライアント | **Expo(React Native)+ Expo Router + react-native-web** | iOS/Android/Web 単一コード。Status の Web は殻なので Web で先行できる |
| スタイル | NativeWind(Tailwind)or Tamagui | X/iMessage 風 UI を3プラットフォームで統一 |
| ストリーミング | SSE(fetch streaming)で G1/G4 を逐次表示、キャラ毎「入力中…」演出 | TTFT 体感短縮 |
| 課金 | RevenueCat(App Store / Play / Web=Stripe) | エンタイトルメント統一、週/月/年/Ad-free/ギフト |
| 広告 | react-native-google-mobile-ads(リワード)。Web は広告なし=Plus 導線 | 地域可用性はサーバ側フラグ |
| バックエンド | TypeScript(Hono)+ Postgres(Prisma)+ Redis(エネルギー・レート制限・実験割当)+ ジョブキュー(Batch 投入/回収、Offline Director) | clone-factory の Next.js+Prisma スターターは API/LP 側に限定して流用 |
| 分析/実験 | PostHog(イベント・フラグ)+ 自前 GenerationLog(BigQuery/ClickHouse) | バンディットは自前(§6) |
| 通知 | Expo Notifications | Proactive DM / 不在ダイジェスト |

[USER-REQ] クロスプラットフォームは Expo 一本化で満たす。Stage 3 の「Next.js スターター前提」はこの点で逸脱するため、Stage 2 のスペックで明示する。
