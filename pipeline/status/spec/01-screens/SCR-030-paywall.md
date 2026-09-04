# SCR-030: Paywall(Plus / Ad-free)
- route: /paywall?src=(モーダル)
- auth: authenticated
- purpose: ソフトペイウォール。エネルギー枯渇時と機能ゲートから到達

## Layout
```
status plus
✓ 50 actions every day     ✓ Characters text you first
✓ No ads                   ✓ Set relationship vibes
( ) Weekly  $6.99/wk
(•) Monthly $14.99/mo  — most popular      ← A/B: トライアル 7 日
( ) Yearly  $79.99/yr  — save 50%
[ Continue ]   Restore purchases · Terms
[ Ad-free only $3.99/mo ]                 ← A/B
```

## Components
| Component | Behavior | Data |
|---|---|---|
| PlanRadio | RevenueCat offerings をそのまま表示 | GET /billing/offerings |
| Continue | RevenueCat purchase → webhook → `Subscription.active` | Purchase, Subscription |
| Restore | RC restore | - |

## States
- loading: offerings 取得中スケルトン
- empty: offerings なし → "Not available in your region" + 閉じる
- error: 購入失敗/キャンセル → トースト、画面維持
- success: 成功 → "Welcome to Plus" → 呼び出し元へ戻る(エネルギー 50 付与済み)

## Interactions
- Continue → ストア購入シート → 成功で閉じる
- × → 呼び出し元へ

## AI Behaviors
- none(価格・トライアル・Ad-free 表示は実験フレームワーク(AIF-006)の割当で切替)
