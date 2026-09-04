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

次ステージ: Stage 3(Build)。Expo(iOS/Android/Web)+ Hono/Prisma。
