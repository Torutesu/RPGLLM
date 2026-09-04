# SCR-020: DM Inbox
- route: /dms
- auth: authenticated
- purpose: キャラとのスレッド一覧(未読・最終メッセージ)

## Layout
```
Messages
(av) @hivequeenbea  "girl. did you see gmz" · 2m  ●
(av) @producer      "call me."               · 1h
(av) @rival         "lol"                    · 1d
[ + New message ]  → キャラ選択シート
```

## Components
| Component | Behavior | Data |
|---|---|---|
| ThreadRow | SCR-021 へ | DMThread, last DMMessage |
| NewMessage | フォロワー中のキャラ一覧 → 新規 thread | WorldCharacter |

## States
- loading: スケルトン
- empty: "No messages yet — say hi to a follower" + New message
- error: Retry
- success: リスト

## Interactions
- Row → SCR-021
- New → キャラ選択 → SCR-021(thread 作成は最初の送信時)

## AI Behaviors
- none(Proactive DM=キャラ側から先に送る、は P1: AIF-001)
