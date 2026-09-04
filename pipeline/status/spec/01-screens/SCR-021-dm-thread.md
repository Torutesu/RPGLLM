# SCR-021: DM Thread
- route: /dms/[threadId]
- auth: authenticated
- purpose: キャラと 1:1 会話(iMessage 風)。送信ごとにエネルギー 1

## Layout
```
[← @hivequeenbea ✓  affinity ❤❤❤♡♡]
   (bubble left)  "girl. did you see gmz"
                    (bubble right) "i'm handling it"
   (typing …)
[ Message ____________ ] [Send ⚡1]
```

## Components
| Component | Behavior | Data |
|---|---|---|
| Bubbles | 逆順ページング | DMMessage |
| AffinityHearts | 関係値表示(タップで relationship summary を表示=Memory Ledger の簡易版) | RelationshipState.affinity, summary |
| Composer | 送信 → `POST /dms/:threadId/messages` → SSE で 1〜3 バブルを逐次表示 | - |

## States
- loading: typing インジケータ(TTFT まで)
- empty: 最初の一言テンプレ("say hi")
- error: 402 → SCR-032 / 422 安全 / 5xx → "Message not sent" + Retry(エネルギー返却)
- success: バブル追加

## Interactions
- Send → ストリーム → 返答 → 関係値が変われば hearts をアニメーション

## AI Behaviors
- G4(AIF-010)が返答。G8 で入力判定。失敗時は "seen ✓✓" のみ表示しエネルギー返却(fallback)。
