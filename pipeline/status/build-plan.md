# Build Plan — Stage 3(Goal mode)

- version: 1 / date: 2026-09-04
- 目標: `spec/04-e2e-cases.md` の **P0 16 件が Web(Playwright)で全通過**し、iOS/Android も同一コードでビルド可能な状態。
- 実行体制: 統括(この会話)が基盤とコントラクトを組み、4 つの Opus エージェントが**ディレクトリ所有権を分けて並列**実装。統括が統合し E2E を緑にする。

## 0. 環境の事実(この sandbox)

| 項目 | 状態 | 影響 |
|---|---|---|
| Node 22.22 / pnpm 10.33 | あり | 標準 |
| PostgreSQL 16 | ローカル起動済み(127.0.0.1:5432, user=postgres, trust)。DB: `rpgllm`, `rpgllm_test` | Prisma 6 で migrate |
| Chromium(Playwright 1.62.1) | `/opt/pw-browsers` に同梱 | `playwright install` 禁止 |
| Anthropic API キー | **なし** | `LLM_MODE=replay` が既定。`live` は SDK 実装のみ(本番で検証) |
| npm registry | 到達可(プロキシ経由) | 依存追加は可。ただし §6 のルール |

## 1. モノレポ構成(所有者)

```
RPGLLM/
├─ CLAUDE.md                     全員が従う規約(統括)
├─ package.json / pnpm-workspace.yaml / .npmrc(node-linker=hoisted) / tsconfig.base.json
├─ .env.example
├─ scripts/db.sh                 Postgres 起動/停止/リセット(統括)
├─ packages/shared/              ★コントラクト(統括が凍結。追加は許可、変更は build-notes 経由)
│   └─ src/{api.ts, generators.ts, constants.ts, tokens.ts, i18n/{en,ja}.ts, testids.ts}
├─ packages/llm/                 Agent B
│   └─ src/{gateway.ts, modes/{live,replay,fail}.ts, generators/{g1,g4,g5,g7,g8}.ts, prompts/, worlds/, fixtures/, cost.ts, experiments.ts}
├─ apps/api/                     Agent A(prisma/schema.prisma は統括が投入、A が migration 管理)
│   └─ src/{index.ts, routes/*, services/*, jobs/*, test-hooks.ts}
├─ apps/mobile/                  Agent C(Expo 57 + Expo Router、web 出力)
│   └─ app/(routes), src/{api/, adapters/{ads,billing,sse}, components/, hooks/}
├─ e2e/                          Agent D(Playwright)
└─ pipeline/status/build-notes.md  逸脱・気づきの記録(全員追記可、append-only)
```

## 2. コントラクト(packages/shared)— 並列作業の要

- `api.ts`: 全エンドポイントの **zod** リクエスト/レスポンス型(`spec/03-api.md` と 1:1)。A は型でハンドラを実装し、C は同じ型でクライアントを実装する。
- `generators.ts`: G1/G4/G5/G7/G8 の入力 ctx と出力 JSON スキーマ(`spec/05-ai-features.md` と 1:1)。B は出力を、A は消費を、この型で行う。
- `constants.ts`: エネルギー定数(FREE_DAILY=10, PLUS_DAILY=50, AD_REWARD=1, AD_DAILY_MAX=5, COFFEE_ENERGY=8, EVENT_EVERY=8, K_INITIAL=3, K_MORE=2)、価格、SKU。
- `tokens.ts`: デザイントークン(ダーク基調、accent 青、positive 緑、negative 橙)。色・フォントのハードコード禁止。
- `i18n/`: UI 文言 EN/JA。`t(key)`。
- `testids.ts`: **data-testid の正本**。C はこれを付け、D はこれで探す。

## 3. 主要な実装決定

| 領域 | 決定 | 理由 |
|---|---|---|
| 認証 | Email + 6 桁コード(dev/test は `000000` 固定)。JWT HS256。Apple/Google は adapter interface のみ(P1) | E2E 可能・ストア審査は後 |
| 年齢ゲート | `POST /auth/age-gate` で birthYear。<13 → 403 UNDER_13。<18 → isMinor | E2E-001/016 |
| DB | Prisma 6 + Postgres。E2E は `rpgllm_test` を `POST /__test/reset` でトランケート | 本番同等 |
| LLM モード | `LLM_MODE=replay|live|fail`。replay は **(generator, worldSlug, locale, bucket)** キーのフィクスチャから決定的に選ぶ(入力テキストのハッシュでバケット)。fail は throw | キー無しで E2E |
| ストリーミング | Hono `streamSSE`。Web は `EventSource`、native は `expo/fetch` のストリーミング | TTFT 体感 |
| 広告 | `AdsAdapter` interface。web/test は `MockAds`(トークン `TEST_AD_TOKEN`、`window.__lastAdRequest={npa}` を公開)。native は AdMob(P1、interface だけ) | E2E-007/016 |
| 課金 | `BillingAdapter` interface。test は `POST /billing/dev-purchase`(`BILLING_MODE=test` 時のみ有効)。RevenueCat は P1 | E2E-008 |
| テストフック | `TEST_HOOKS=1` のときのみ `/__test/*`: reset, time-travel {days}, llm-mode {mode}, set-energy {n} | E2E-010/015 |
| イベント発火 | アクション完了後 `actionCount % 8 == 7` で G5 を先読み。8 回目のアクション後に `Event` 未解決があれば `pendingEvent` として返す。先読み失敗時はその場で生成、それも失敗ならプリセット | E2E-005 |
| 演出数値 | likes = followers × U(0.05,0.30)、reposts = likes × 0.15、replies = likes × 0.03。LLM は生成しない | コスト |
| スタッツ | followers += delta × level、aura/humor は 0..100 にクランプ。narrative は G1/G5 出力 | |
| 記憶 | G1 の memory_notes → MemoryEntry。10 件で G7(replay では即時要約) | E2E-018 は P1 |
| 安全 | G8 を投稿/DM 前に必ず通す。replay では禁止語リスト(テスト用 20 文)で判定 | E2E-009 |
| フォールバック | G1 失敗 → キャラ毎の定型 5 種、差分 0、`fallback:true`、エネルギー返却 | E2E-010 |
| i18n | User.locale で UI とプロンプト(GLOBAL_STYLE[locale], bible[locale])を切替 | E2E-011 |
| Web | `expo export -p web` → `e2e` が静的配信(port 8082)。API は 4000 | E2E-012 |
| GenerationLog | gateway が全呼び出しを記録(replay も usage を擬似計上: 入力/キャッシュ/出力トークンを推定、cost を価格表で計算) | E2E-013 |
| 実験割当 | `experiments.ts`: `assign(userId, key) = variants[hash % n]`(固定 50/50)。`/experiments/assignments` が返す | E2E-013/014 |
| 👎 再生成 | `POST /generations/:id/rate {regenerate:true}` → 1 段上の tier で同 ctx を再実行、Post.text 差し替え、`escalatedFrom` | E2E-014 |

## 4. エージェント割当と完了条件

| Agent | 所有 | 完了条件(自己検証) |
|---|---|---|
| A: API | `apps/api/**` | `pnpm --filter api test` 緑(vitest、rpgllm_test)。全エンドポイントが shared の zod に適合。`pnpm --filter api dev` で `/health` 200 |
| B: LLM | `packages/llm/**` | `pnpm --filter llm test` 緑。3 ワールド EN/JA bible(≥4,096 tok 相当、`bibleTokens` は文字数/3.5 で概算し ≥4,096)。replay フィクスチャで G1/G4/G5/G8 が全バケットで有効 JSON。live モードは Anthropic SDK で実装(キー無しなので `LLM_MODE=live` の起動確認のみ) |
| C: Client | `apps/mobile/**` | `pnpm --filter mobile typecheck` 緑、`expo export -p web` 成功、全 14 画面が testids.ts の id を持つ。API は shared の型のみ経由 |
| D: E2E | `e2e/**` | P0 16 件のテストが書かれ、`pnpm e2e` が api+web を起動してテストを実行できる(統合前は多くが赤で正常) |

順序: 統括が §1 の骨組み+§2 のコントラクト+Prisma スキーマ+`scripts/db.sh` を作り、`pnpm install`、各パッケージの空実装が起動することを確認してから 4 エージェントを同時起動。

## 5. E2E の実行方法(D が実装、統括が回す)

```
scripts/db.sh start                      # Postgres
pnpm --filter api prisma migrate deploy  # DATABASE_URL=…/rpgllm_test
LLM_MODE=replay TEST_HOOKS=1 BILLING_MODE=test ADS_MODE=test pnpm --filter api start   # :4000
pnpm --filter mobile export:web && pnpm --filter mobile serve:web                       # :8082
pnpm e2e                                  # Playwright(webServer で上記を自動起動)
```

## 6. 全員のルール(CLAUDE.md にも記載)
- 自分の所有ディレクトリ外を編集しない。必要なら `pipeline/status/build-notes.md` に「依頼」を追記(append-only)。
- `packages/shared` は追加のみ可。既存の型を変える必要が出たら build-notes に理由を書き、**後方互換な追加**で済ませる。
- 依存追加は `pnpm --filter <pkg> add <dep>`。ルートで `pnpm install` を走らせない(他エージェントと衝突)。
- E2E を弱める・スキップする・削除することで通過させない。
- 色・フォント・文言は tokens/i18n 経由。ハードコード禁止。
- LLM 呼び出しは `packages/llm` の gateway 以外から行わない。
- コミットは統括が行う。エージェントは作業ツリーに書くだけ。
