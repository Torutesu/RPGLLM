# 05 — AI Features
- version: 1 / source: ../teardown.md §7 と ../cost-architecture.md §3
- 共通: 全 AIF は `packages/llm/gateway` を経由(GenerationLog 必須)。モデル ID は環境変数 `LLM_MODEL_<GEN>_<TIER>` で差し替え可能。provider-agnostic(Phase 3 で非 Anthropic 小型モデルへ移行可 [decisions 2026-09-04])。
- model_tier 凡例: high = claude-opus-5 / mid = claude-sonnet-5 / light = claude-haiku-4-5
- プロンプト配置: system[0]=GLOBAL_STYLE[locale](cache) → system[1]=World.bible[locale](cache) → user=動的(≤800 tok)。

## AIF-009: Reaction Fan-out(G1)
- trigger: ユーザー操作(投稿/返信の送信)、SCR-006 の歓迎投稿、SCR-012 の Load more(K=2)、👎 の再生成
- input_context: GLOBAL_STYLE、World.bible、Persona(stats, voiceNotes)、関与キャラ ≤3 の RelationshipState.summary、直近フィード 6 件、投稿本文、G8 の soften フラグ、乱数シード
- model_tier: **mid(champion: Sonnet 5, thinking disabled)⇄ light(challenger: Haiku 4.5)** を固定 50/50 で A/B(MVP)。再生成は 1 段上(light→mid→high)
- output: JSON `{replies:[{characterHandle,text≤280}] (K=3, 最低1), stat_deltas:{followers,aura,humor}, narrative≤2文, relationship_deltas:{handle:-1|0|1}, memory_notes:[{handle,note≤30語}], news?:{text}, safety_flag}`。structured outputs。SSE で reply を 1 件ずつ push
- fallback: JSON 不正→1 回だけ再試行→失敗ならプリセット定型返信(キャラ毎 5 種)+差分 0、`fallback:true`、エネルギー返却
- e2e_ref: [E2E-003, E2E-004, E2E-010, E2E-011, E2E-013, E2E-014, E2E-017]

## AIF-010: DM Turn(G4)
- trigger: ユーザー操作(DM 送信)
- input_context: GLOBAL_STYLE、World.bible、キャラカード、RelationshipState(affinity, summary)、スレッド直近 10 往復、Persona 要約
- model_tier: mid(Sonnet 5, thinking disabled)。challenger light は Phase 1
- output: JSON `{bubbles:[text≤160]×1..3, affinity_delta:-2..2, memory_note?}`
- fallback: "seen ✓✓" のみ表示、エネルギー返却、5 分後にジョブで再試行して届いたら通知
- e2e_ref: [E2E-006, E2E-018]

## AIF-011: Drama Director(G5)
- trigger: イベント(`actionCount % 8 == 7` 完了時に先読み、または aura<10 / followers 急変)
- input_context: GLOBAL_STYLE、World.bible、Persona.worldSummary、全 RelationshipState.summary、直近 StatSnapshot 5 件、既出イベント title 一覧(重複回避)
- model_tier: **high(Opus 5, effort medium, `fallbacks:"default"`)**。challenger: mid(Sonnet 5, effort high)
- output: JSON `{title, prompt≤240, choices:[{label≤60, outcomeText≤240, statDeltas, relationshipDeltas, newsText?}]×3}`
- fallback: プリセットイベント 5 種から未出題を抽選(差分は固定表)
- e2e_ref: [E2E-005]

## AIF-012: Memory Consolidator(G7)
- trigger: スケジュール/イベント(未統合 MemoryEntry ≥10、またはセッション終了から 5 分)
- input_context: 旧 summary、未統合 note 列、affinity
- model_tier: light(Haiku 4.5)、Batch API
- output: RelationshipState.summary ≤150 tok、Persona.worldSummary ≤400 tok。note を consolidated=true に
- fallback: 失敗時は旧 summary 維持、note は未統合のまま(次回再試行)。ユーザー影響なし
- e2e_ref: [E2E-018]

## AIF-013: Safety Gate(G8)
- trigger: ユーザー操作(投稿/返信/DM の送信前)
- input_context: 入力テキスト、ロケール、isMinor、コミュニティガイドライン要約(≤200 tok)
- model_tier: light(Haiku 4.5, max_tokens 20)。将来は自前分類器
- output: `{verdict: allow|soften|block, category}`。block→422、soften→G1/G4 にフラグ
- fallback: 判定不能(タイムアウト 800ms)→ allow だが `safetyVerdict=null` を記録し、出力側の `safety_flag` に頼る。isMinor は判定不能時 soften
- e2e_ref: [E2E-009]

## AIF-014: World Studio — プリセット生成(G9、ビルド時)
- trigger: スケジュール(リポジトリの `worlds/*.seed.md` 変更時に CI で実行)
- input_context: 1 行シナリオ+ジャンルテンプレ+ロケール
- model_tier: high(Opus 5, effort high)
- output: World.bible[locale](世界観 ≤1,200 tok+キャスト 8 体 ≤350 tok/体+プリセットペルソナ 7 種)。`bibleTokens ≥ 4,096` を assert(Haiku キャッシュ最小)。生成物はレビューして commit(`worlds/*.bible.en.md`, `.ja.md`)
- fallback: CI 失敗=デプロイ停止(ランタイム影響なし)
- e2e_ref: [E2E-002, E2E-011]

## AIF-015: Ambient Pool(G2、Batch)
- trigger: スケジュール(夜間 `ambient.refill`)
- input_context: World.bible、locale、既存プールの直近 50 件(重複回避)
- model_tier: light(Haiku 4.5)Batch。品質 A/B で mid
- output: AmbientPost ×(200 − 現在数)/ワールド/ロケール
- fallback: プールが枯れたら既存を再利用(ユーザー毎に既読除外で無作為)
- e2e_ref: [E2E-002, E2E-020]

## AIF-006: Self-optimizing Generators(実験基盤、MVP は固定割当)
- trigger: イベント(全 gateway 呼び出し時の割当)+スケジュール(夜間 GJ 採点)
- input_context: generators/*.yaml(variants, allocation)、GenerationLog、Rating
- model_tier: GJ = high(Opus 5, Batch)。割当ロジックは LLM なし
- output: user-sticky の variantId、日次レポート($/action, hit rate, 👎率, judge score)。MVP は固定 50/50、Thompson sampling は Phase 1
- fallback: 割当取得失敗→champion 固定
- e2e_ref: [E2E-013, E2E-014]

## P1 以降(スコープ外だが ID 予約)
- AIF-001 Offline World Director(G10)→ E2E-019
- AIF-002 Relationship Memory Ledger UI(SCR-021 の hearts タップで簡易版のみ MVP)
- AIF-003 ユーザー作成ワールド(G9 をランタイム化)
- AIF-004 Persona Voice Import
- AIF-005 Shareable Moment Generator
- AIF-007 Auto-localized Worlds(MVP はプリセットを EN/JA 両方 G9 で生成)
- AIF-008 Multimodal Reactions


## 実装状況の更新(2026-09-04)

| AIF | 状態 | 備考 |
|---|---|---|
| AIF-009 (G1) | 実装済み | 返信ファンアウト。雑談プール補充・ダイジェストにも流用 |
| AIF-010 (G4) | 実装済み | DM。ダイジェストの DM 1 通にも使用 |
| AIF-011 (G5) | 実装済み | ドラマ。ダイジェストのディレクター・ビートにも使用 |
| AIF-012 (G7) | **実装済み(MVP では未接続だった)** | 記憶統合。SCR-039 の読み出しとジョブフックから起動 |
| AIF-013 (G8) | 実装済み | 安全ゲート |
| AIF-014 (G9) | ~~実装済み~~ **誤記。未実装だった** | 2026-09-05 に実装。下の追記を参照 |
| AIF-015 (G2) | **G1 で代替** | 専用生成器は無く、合成プロンプトの G1 で補充 |
| AIF-001 (G10) | **G5+G1+G4 で実装** | オフラインディレクター。専用生成器は無い |
| AIF-002 | 実装済み | 記憶台帳 UI(SCR-039) |
| AIF-005 | 実装済み | 共有カード(SCR-040)。追加の LLM 呼び出しなし |
| AIF-006 | 部分実装 | 固定割当の A/B とコスト計測は稼働。Thompson sampling は未 |
| AIF-003 / AIF-004 / AIF-007 / AIF-008 | 未実装 | ユーザー作成ワールド、口調インポート、自動翻案、マルチモーダル |

**未達の設計要件**: Batch API 経路がゲートウェイに無いため、`cost-architecture.md` §5.4 の 50% 割引(雑談プール・記憶統合・不在ダイジェスト・評価)がまだ効いていない。

## World Studio(2026-09-05)

AIF-003(ユーザー作成ワールド)と AIF-014(G9)をまとめて実装した。上の表の AIF-014 は誤記で、
この日まで `packages/llm/src/generators/` に g9 は存在せず、ワールドは手書きの TypeScript 3 本だけだった。

### G9 は 1 回の呼び出しではない

`WorldSeed` は 2 ロケール分のバイブル(各 4,096 トークン以上)、キャスト 8 人のフルカード、
プリセットペルソナ 7、イベント 5(各 3 択)、ロケールごとの雑談 22 本、ハンドルごとの
フォールバック返信 5 本、歓迎投稿を含む。1 回の呼び出しで安定して出せる量ではないし、
出せたとしても全部を最上位モデルで書くのは無駄なので、`cost-architecture.md` §3 の方針どおり分割する。

| 段階 | ティア | 出力 | 備考 |
|---|---|---|---|
| G9a concept | high | タイトル/シナリオ/難易度/トーン/世界観/派閥/スラング/キャスト 8 人の名簿 | 判断が要る唯一の段階。ここだけ Opus の価値がある |
| G9b bible | high | バイブルの prose と outro を 2 ロケール | JA は翻訳ではなく日本語で書き下ろす |
| G9c cards | mid | キャスト 1 人 × 1 ロケールのカード(8 人ぶんファンアウト) | バッチ可 |
| G9d cast&events | mid | プリセットペルソナ 7、イベント 5 | |
| G9e texture | light | 雑談 22/ロケール、フォールバック返信、歓迎投稿 | バッチ可 |

各段階は `variantId`(`G9-concept@v1` など)を分けて `GenerationLog` に別々に載る。
最終的な組み立ては既存の `worlds/build.ts` を通すので、生成ワールドと手書きワールドは
バイト列として同じ形になる(= キャッシュ接頭辞が同じ規則で効く)。

### 安全性は 2 段構え

1. **生成前**: `screenPremise()` がユーザーの 1 行を検査する。ジェム消費もトークン消費もこの前には起きない。
   落とすカテゴリは `WORLD_PREMISE_BLOCKED`(未成年の性的表現/性的描写/実在人物・実在ブランド/憎悪/自傷/
   残虐描写/違法行為の教示/**プロンプトインジェクション**)。プレミスはシステムプロンプトの一部になるため、
   命令文の注入は安全性の問題として扱う。
2. **公開前**: 生成されたバイブルとキャストを G8 にかける。`public` は必ず**人間の審査**を通す。
   自動公開はしない。`private` は生成直後から遊べるが、どの一覧にも出ない。

### 未実装のまま残るもの
AIF-004(口調インポート)、AIF-007(自動翻案)、AIF-008(マルチモーダル)。
