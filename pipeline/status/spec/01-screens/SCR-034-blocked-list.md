# SCR-034: Blocked Characters
- route: /settings/blocked
- auth: authenticated
- purpose: ブロック済みキャラの一覧と解除(審査要件のブロック機能の可視化)

## Layout
```
[← Blocked characters]
(av) Bea Solano @hivequeenbea      [ Unblock ]
(av) Chris Wen  @critchriswen      [ Unblock ]
--- 空のとき ---
You haven't blocked anyone
```

## Components
| Component | Behavior | Data |
|---|---|---|
| BlockedRow | `T.unblock(handle)` で `POST /v1/moderation/unblock` → 行を除去 | BlockedListRes |

## States
- loading: スケルトン 3 行
- empty: `noBlocked` 文言
- error: Retry
- success: 一覧

## Interactions
- Unblock → 解除 → 以後そのキャラはフィード・DM・生成キャストに復帰

## AI Behaviors
- none(ブロック中はキャラが G1 のキャストから外れるため返信自体が生成されない)
