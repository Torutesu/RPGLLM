# SCR-026: Profile
- route: /profile(タブ)
- auth: authenticated
- purpose: 進行の可視化。スタッツ・レベル/XP・自分の投稿・キャストとの関係を一箇所で見せる

## Layout
```
(av) Tay @taytay19
  Followers 1.2K   Aura 34%   Humor 21%
  Level 3   ▓▓▓▓▓░░░░░ 140 / 300 XP
YOUR CAST
  (av) Bea Solano @hivequeenbea   ❤❤❤♡♡   12 memories   >
  (av) Chris Wen @critchriswen    ❤♡♡♡♡    3 memories   >
YOUR POSTS
  new song Friday …
```

## Components
| Component | Behavior | Data |
|---|---|---|
| StatHeader | followers/aura/humor | ProfileRes.persona |
| LevelBar | `xpForNextLevel(level)` で進捗を計算(クライアントとサーバで同じ定数) | ProfileRes.levelProgress |
| CastRow | `T.profileRelationship(handle)`。タップで SCR-039 | ProfileRes.relationships |
| PostList | 自分の投稿のみ | ProfileRes.posts |

## States
- loading: スケルトン
- empty: 投稿 0 件は `noPostsYet`
- error: Retry
- success: 上記

## Interactions
- キャスト行 → SCR-039(記憶台帳)
- 設定ボタン → SCR-033

## AI Behaviors
- none(表示のみ)
