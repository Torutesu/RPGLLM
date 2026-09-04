# Decisions log — pipeline/status

| date | stage | decision | rationale |
|---|---|---|---|
| 2026-09-04 | 1 | Stage 1(Teardown)を完了し、Stage 2 前でユーザー確認のため停止 | clone-factory の規約(ステージ境界で確認) |
| 2026-09-04 | 1 | コスト設計を `cost-architecture.md` として teardown から分離 | ユーザーの明示要求(プロンプト分割・モデル最適化・A/B)が teardown §7 の粒度を超えるため |
| 2026-09-04 | 1 | クライアントは Expo(RN + web)一本化を提案。Stage 3 スターター(Next.js)は API/LP のみ流用 | [USER-REQ] クロスプラットフォーム |
| 2026-09-04 | 1 | 原価試算のアクション数・開封率・広告 eCPM は [ASSUMED] として明記 | 一次情報なし |
| 2026-09-04 | 2 | IP: 実在ファンダム名を出さず**オリジナル世界**(inspired-by タグのみ)で行く | ユーザー決定。肖像・二次創作リスクを回避 |
| 2026-09-04 | 2 | 市場: **グローバル(EN)前提で日本(JA)も初日から**。UI/プロンプトは locale 別 | ユーザー決定 |
| 2026-09-04 | 2 | 蒸留先に**非 Anthropic 小型モデルを許容**(Phase 3)。MVP はゲートウェイを provider-agnostic に | ユーザー決定 |
| 2026-09-04 | 2 | 年齢: **13+**、登録時に年齢ゲート、18歳未満は非パーソナライズ広告+ティーン表現フィルタ | Status は App Store 13+/Play Everyone、法的ゲートは未確認。COPPA/EU DSA 準拠のため我々は明示ゲート |
| 2026-09-04 | 2 | オフライン評価予算は既定 **$300/月** [ASSUMED] | ユーザー未回答のため既定値 |
| 2026-09-04 | 3 | Stage 3(Build)完了: E2E P0 16/16 緑(Web/Chromium, LLM_MODE=replay)。統合ログは build-notes.md | クロスプラットフォームは Expo 単一コード、live LLM は本番キーで別途検証 |
