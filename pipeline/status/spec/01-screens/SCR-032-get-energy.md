# SCR-032: Get Energy
- route: /energy(モーダル)
- auth: authenticated
- purpose: エネルギー 0 の時の回復導線。広告/Coffee/Plus/待機

## Layout
```
⚡ 0 / 10     next free refill in 06:12:31
[ ▶ Watch an ad  +1 ⚡ ]   (3/5 today)      ← Web は非表示
[ ☕ Use a coffee  +8 ⚡ ]   (you have 2)
[ ⭐ Get Plus — 50/day, no ads ]  → SCR-030
[ Invite a friend  +1 ☕ ]   (P1)
```

## Components
| Component | Behavior | Data |
|---|---|---|
| RefillTimer | 日次リフィル(UTC 0 時 or ローカル)までのカウントダウン | Wallet.dailyRefillAt |
| WatchAd | リワード広告(Google Mobile Ads)。isMinor は非パーソナライズ。完了トークンを `POST /wallet/ad-reward`。日次上限 5 | Wallet.adRewardsToday |
| UseCoffee | `POST /wallet/coffee` | Wallet.coffee |
| GetPlus | SCR-030 | - |

## States
- loading: 広告ロード中は disabled
- empty: 広告在庫なし → ボタン非表示、Coffee/Plus のみ
- error: 広告失敗 → "Ad not available right now"
- success: energy 更新 → 閉じて元の操作へ戻る

## Interactions
- Watch ad → 視聴完了 → +1 → 自動で閉じる
- Use coffee → +8 → 閉じる
- Get Plus → SCR-030

## AI Behaviors
- none(広告上限・付与量は AIF-006 の実験対象)
