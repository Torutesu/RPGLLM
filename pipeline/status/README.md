# pipeline/status — Status(WishRoll)クローン・ファクトリー

| ファイル | 内容 |
|---|---|
| `teardown.md` | Stage 1: ポジショニング / 機能マップ / 画面インベントリ(SCR-xxx) / フロー / データモデル / 課金 / AI ネイティブ化(AIF-xxx) / Copy-Drop-Change / MVP 案 / Open Questions |
| `cost-architecture.md` | LLM コスト設計: 生成器分割(G1–G10)、キャッシュ・レイアウト、原価試算、モデル最適化ルール、A/B・バンディット基盤、フェーズ計画、クロスプラットフォーム構成 |
| `decisions.md` | 判断ログ(IP=オリジナル世界、EN+JA、小型モデル許容、13+、評価予算 $300/月) |
| `spec/00-prd.md` | Stage 2: MVP スコープ(画面 14、AIF 8)、除外、成功条件 |
| `spec/01-screens/` | 画面仕様 14 ファイル(SCR-002〜032) |
| `spec/02-schema.md` | Prisma スキーマ+ER 図 |
| `spec/03-api.md` | REST/SSE エンドポイント+内部ジョブ |
| `spec/04-e2e-cases.md` | E2E ケース 20 件(P0 16 件) |
| `spec/05-ai-features.md` | AI 機能仕様(AIF-006, 009〜015) |

| `build-plan.md` / `build-notes.md` | Stage 3: 実装計画、各エージェントの記録、統合時の判断 |

## UI・プロダクトの作り直し(2026-09-04)
「見た目も機能も 30 点」という評価を受けて全面的に作り直した。デザイントークンを刷新(紫を帯びた黒地、
ブランドグラデーション、**ハンドルから決定的に導かれるキャラ固有カラー**、書体スケール、モーション)し、
アバターを SVG 生成に、アイコンを 35 種の SVG セットに置き換え、タイムスタンプ・手続き的メディア・
アニメーションを入れた。熱狂を生む面として **通知タブ・連続ログイン・実績・レベルアップ演出・
トレンド・Explore・キャラ個別ページ・コールドオープン** を新設。画面は 14 → 23。
`pnpm --filter api test` 154/154、`pnpm e2e` 43 passed / 4 skipped / 0 failed。

## ギャップ監査と対応(2026-09-04)
`gap-analysis.md` を参照。S0 セキュリティ 7 件と S1 ストア審査 6 件は全件解消、S2 差別化は 6/7 実装、S3 運用は 8/9 解消。
`pnpm --filter api test` 103/103、`pnpm e2e` 27 passed / 4 skipped / 0 failed。
コスト実測は $0.0057〜0.0082/アクション、キャッシュヒット率 88〜90%。

## Stage 3 の状態(2026-09-04)
- `pnpm e2e` → **43 passed / 4 skipped / 0 failed**(Chromium、`LLM_MODE=replay`)
- 単体: API 154、LLM 80、typecheck 全パッケージ緑
- コスト計測: `node scripts/cost-report.mjs --days 7 [--html out.html]`
- 実行: `scripts/db.sh start` → `pnpm e2e`(API :4000 と Web :8082 を自動起動)
- 未検証: `LLM_MODE=live`(この環境に API キーなし)、iOS/Android 実機(コードは同一、`expo run:ios|android`)
