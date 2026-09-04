# SCR-033: Settings
- route: /settings
- auth: authenticated
- purpose: アカウント・課金・プライバシー・安全・言語・法務の一元的な置き場所。ストア審査の必須導線(削除・復元・規約)を全てここから辿れる

## Layout
```
[← Settings]
ACCOUNT
  Email            you@example.com
  Download my data                      >
  Sign out
  Delete account                        >   (danger)
SUBSCRIPTION
  Plan             Plus (monthly) / Free
  Manage subscription                   >   (ストアのサブスク画面へ)
  Restore purchases
PRIVACY
  Personalized ads and analytics      [ON|OFF]   (未成年は disabled + 説明)
SAFETY
  Blocked characters (3)                >
LANGUAGE
  [ English | 日本語 ]
LEGAL
  Terms of Service / Privacy Policy / Community Guidelines / Contact support
```

## Components
| Component | Behavior | Data |
|---|---|---|
| EmailRow | `me.user.email`(無い場合は id にフォールバック) | MeRes |
| ExportRow | `GET /v1/account/export` → JSON をダウンロード(web は Blob、native は Share) | ExportDataRes |
| SignOut | トークン破棄 → SCR-002 | - |
| DeleteRow | SCR-036 へ | - |
| PlanRow / ManageSub | iOS/Android はストアのサブスク URL、web は SCR-030 | Subscription |
| Restore | `POST /v1/billing/restore` | Subscription |
| ConsentToggle | `POST /v1/account/consent`。`isMinor` なら操作不可・常に off | ConsentRes |
| BlockedRow | SCR-034 へ、件数を表示 | BlockedListRes |
| LocaleToggle | EN/JA。以後の UI とプロンプトに反映 | User.locale |
| LegalLinks | `LEGAL` 定数の URL を `expo-linking` で開く | - |

## States
- loading: 各行はスケルトン、トグルは disabled
- empty: n/a
- error: 行単位のインラインエラー(復元失敗・エクスポート失敗)。画面は維持
- success: 上記

## Interactions
- Delete account → SCR-036
- Blocked characters → SCR-034
- Sign out → トークン破棄 → SCR-002
- 各法務リンク → 外部ブラウザ

## AI Behaviors
- none
