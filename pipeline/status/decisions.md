# Decisions log — pipeline/status

| date | stage | decision | rationale |
|---|---|---|---|
| 2026-09-04 | 1 | Stage 1(Teardown)を完了し、Stage 2 前でユーザー確認のため停止 | clone-factory の規約(ステージ境界で確認) |
| 2026-09-04 | 1 | コスト設計を `cost-architecture.md` として teardown から分離 | ユーザーの明示要求(プロンプト分割・モデル最適化・A/B)が teardown §7 の粒度を超えるため |
| 2026-09-04 | 1 | クライアントは Expo(RN + web)一本化を提案。Stage 3 スターター(Next.js)は API/LP のみ流用 | [USER-REQ] クロスプラットフォーム |
| 2026-09-04 | 1 | 原価試算のアクション数・開封率・広告 eCPM は [ASSUMED] として明記 | 一次情報なし |
