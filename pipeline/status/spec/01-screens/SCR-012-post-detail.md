# SCR-012: Post Detail / Thread
- route: /post/[id]
- auth: authenticated
- purpose: 返信ツリーを読む・返信する・追加返信を遅延生成する

## Layout
```
[←]
@taytay19 ✓  new song Friday…      ❤480K 🔁65K 💬12.4K
 ├ @hivequeenbea ✓ iconic timing 👑        [👍 👎]
 ├ @the6ixdrey ✓ the song better not…      [👍 👎]
 [ Load more reactions ]   ← 遅延生成(エネルギー消費なし、1回のみ)
[ Reply ⚡1 ]
```

## Components
| Component | Behavior | Data |
|---|---|---|
| ThreadList | ネスト 2 段まで表示 | GET /posts/:id |
| RateButtons | `POST /generations/:id/rate`。👎 は再生成(1 段上のモデル)で差し替え | Rating |
| LoadMore | `POST /posts/:id/more-replies` → 追加 2 件 | - |
| ReplyButton | SCR-011(parentId) | - |

## States
- loading: スケルトン
- empty: 返信 0 件 "No reactions yet"(G1 は K≥1 を保証するので通常発生しない)
- error: Retry
- success: ツリー

## Interactions
- 👎 → 再生成 → 該当返信をフェードで差し替え、Rating.regenerate=true
- Load more → 追加返信を末尾に

## AI Behaviors
- Load more: G1 を K=2 で再実行(AIF-009 遅延ファンアウト)。
- 👎: 同一 G1 入力で 1 段上のモデル(AIF-009 escalation)。
