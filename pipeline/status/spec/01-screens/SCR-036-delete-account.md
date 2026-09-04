# SCR-036: Delete Account
- route: /delete-account
- auth: authenticated
- purpose: App Store Guideline 5.1.1(v) が要求するアプリ内アカウント削除

## Layout
```
[× ]
Delete account
This deletes your worlds, personas and messages.
You have 30 days to change your mind, then it is permanent.
[ Type DELETE to confirm ______ ]
[ Delete my account ]   (danger, DELETE 入力まで disabled)
```

## Components
| Component | Behavior | Data |
|---|---|---|
| ConfirmInput | 文字列 `DELETE` に一致するまで送信不可 | - |
| DeleteButton | `POST /v1/account/delete {confirm:"DELETE"}` | DeleteAccountRes |

## States
- loading: 送信中は disabled
- empty: 未入力 = 送信不可
- error: 失敗はインライン表示、画面維持
- success: `deleteDone` 表示 → トークン破棄 → SCR-002

## Interactions
- 削除 → `User.deletedAt` を設定 → 以後 `requireAuth` が 410 を返す(復元エンドポイントのみ例外)
- 30 日以内は `POST /v1/account/restore` で復帰可能。以後 purge ジョブが物理削除

## AI Behaviors
- none
