# SCR-011: Composer
- route: /compose?parentId=
- auth: authenticated
- purpose: 投稿/返信を書く(エネルギー1消費)

## Layout
```
[× Cancel]                     [Post ⚡1]
(返信時: "Replying to @hivequeenbea" + 引用)
[textarea ≤280]
[0/280]
```

## Components
| Component | Behavior | Data |
|---|---|---|
| TextArea | 280 字、空は disabled | - |
| PostButton | energy≥1 なら `POST /posts`、0 なら SCR-032 をモーダル表示 | Wallet.energy |

## States
- loading: 送信中ボタン disabled(≤1s、応答後すぐ SCR-010 に戻りストリーム開始)
- empty: 送信不可
- error: 402 → SCR-032 / 422(安全ブロック)→ インライン "This doesn't fit the world's guidelines." エネルギー消費なし / 5xx → Retry
- success: SCR-010 へ戻り、投稿が先頭に、返信がストリームで到着

## Interactions
- Post → `POST /posts` → `GET /posts/:id/stream`(SSE)を SCR-010 が購読

## AI Behaviors
- 送信前に G8(AIF-013)で入力を判定。block は 422、soften は通すが G1 プロンプトにフラグを渡す。
