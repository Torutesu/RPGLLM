# SCR-002: Auth + Age Gate
- route: /auth
- auth: public
- purpose: Apple/Google/Email でサインアップし、生年で 13+ を担保する

## Layout
```
[ロゴ status]  "Be anyone in your world"
[ Continue with Apple ]  (iOS 必須)
[ Continue with Google ]
[ Continue with Email ]
---- 初回のみ ----
[ 生まれた年 ▾ ]  [続ける]
[Terms / Privacy / Guidelines リンク]  [言語 EN|JA]
```

## Components
| Component | Behavior | Data |
|---|---|---|
| ProviderButtons | OAuth 開始。Web は Google/Email のみ | authProvider |
| BirthYearPicker | 13歳未満 → 遮断画面(登録不可)。18歳未満 → isMinor=true | User.birthYear, isMinor |
| LocaleToggle | 端末ロケール既定。以後の UI/プロンプトに反映 | User.locale |

## States
- loading: ボタン disabled+スピナー
- empty: n/a
- error: プロバイダ失敗トースト("Sign-in failed. Try again.")
- success: 既存ペルソナあり→SCR-010、なし→SCR-003
- blocked(<13): "You need to be 13 or older to use this app." 戻るのみ

## Interactions
- Provider 押下 → OAuth → `POST /auth/:provider` → 初回は年齢ピッカー表示 → `POST /auth/age-gate` → 分岐(SCR-003 / SCR-010)

## AI Behaviors
- none
