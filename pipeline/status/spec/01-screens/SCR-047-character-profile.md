# SCR-047: Character Profile
- route: /character/[handle]
- auth: authenticated
- purpose: キャラを「画面上の名前」から「人物」にする。関係値・記憶・投稿を一箇所で見せる

## Layout
```
[←]
    (大きなアバター、identity グラデーション)
    Chris Wen  @critchriswen ✓   role: critic
    Follows you
    ❤❤❤♡♡  affinity 54        [ What they remember > ]
    [ Message ]  [ Block ]
RECENT POSTS
  …
```

## Components
| Component | Behavior | Data |
|---|---|---|
| Header | アバター・名前・役割・bio・フォロー状態 | CharacterProfileRes |
| AffinityBar | 好感度と記憶件数。タップで SCR-039 | relationship |
| Actions | DM 開始 / ブロック(SCR-037 と同じ API) | - |
| PostList | そのキャラの最近の投稿 | posts |

## States
- loading: スケルトン
- empty: 投稿が無ければその旨
- error: 404 は「そのキャラはいません」
- success: 上記

## Interactions
- フィードのアバター・名前、プロフィールのキャスト一覧、Explore の Rising から到達

## AI Behaviors
- none(表示のみ)
