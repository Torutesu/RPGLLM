# SCR-044: Achievements
- route: /achievements
- auth: authenticated
- purpose: コレクション欲。未解除でも進捗が見えることで「あと少し」を作る

## Layout
```
[← Achievements]                              [🔥1]
🏆 1 / 18  ▓░░░░░░░░░
LEGENDARY   [👑 Household name 0%] [🛡 Survivor 0%]
GOLD        [❤️ Ride or die 51%]   [🔥 Untouchable 28%]
SILVER      …
```

## Components
| Component | Behavior | Data |
|---|---|---|
| ProgressHeader | 解除数 / 総数 | AchievementsRes |
| AchievementCard | 未解除は暗転+鍵+進捗バー、解除済みは全色+日付 | AchievementsRes.achievements |

## States
- loading: スケルトングリッド
- empty: n/a(カタログは常に 18 件)
- error: Retry
- success: ティア別グリッド

## Interactions
- プロフィール(SCR-026)から到達
- 未読の解除は SCR-045 の演出で先に提示され、閉じると既読化される

## AI Behaviors
- none。判定は SQL の集計のみで、LLM を呼ばない
