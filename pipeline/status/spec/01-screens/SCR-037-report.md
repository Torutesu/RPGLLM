# SCR-037: Report / Block
- route: /report?target=&targetId=(モーダル)
- auth: authenticated
- purpose: App Store Guideline 1.2 が要求する UGC/AI 生成物の通報とブロック

## Layout
```
[× ]  Report this content
( ) Harassment or bullying
( ) Sexual content
( ) Self-harm
( ) Hate speech
( ) Broke character / nonsense
( ) Something else
[ Anything else we should know? (optional) ]
[ Send report ]
--- target=character のとき ---
[ Block this character ]
```

## Components
| Component | Behavior | Data |
|---|---|---|
| ReasonList | `REPORT_REASONS` のラジオ。`T.reportReason(reason)` | - |
| NoteInput | 任意、500 字 | - |
| Submit | `POST /v1/moderation/report`。本文スナップショットと generationId は**サーバ側で解決**(クライアントの複製は信用しない) | ReportRes |
| BlockButton | `T.blockOpen` → 確認 → `POST /v1/moderation/block` | - |

## States
- loading: 送信中 disabled
- empty: 理由未選択 = 送信不可
- error: 重複通報は 409 → 「すでに受け付けています」。それ以外はインライン
- success: `reportDone` → 閉じる

## Interactions
- 各投稿・DM の「…」(`T.overflow(id)`)から到達
- ブロック確定 → 対象キャラがフィード・DM 一覧・生成キャストから消える

## AI Behaviors
- none(通報は人手のキューへ。`GET /v1/moderation/reports` で確認)
