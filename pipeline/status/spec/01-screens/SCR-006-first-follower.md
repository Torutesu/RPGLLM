# SCR-006: First Follower Picker
- route: /onboarding/first-follower
- auth: authenticated
- purpose: 最初のフォロワー=物語の軸を決める。決定でペルソナ作成+フィード初期化

## Layout
```
"Choose your first follower"
[キャラカード: @rival  役割: rival  1行紹介]
[キャラカード: @bestie ...]
[キャラカード: @producer ...]
[ Enter the world ]
```

## Components
| Component | Behavior | Data |
|---|---|---|
| CharacterCard | canBeFirstFollower=true のみ。選択で強調 | WorldCharacter |
| EnterWorld | `POST /personas` → SCR-007 相当のテーマ付きローディング(この画面内オーバーレイ "Planting the first ripple…")→ SCR-010 | Persona, RelationshipState(isFollower=true) |

## States
- loading: オーバーレイ(最大 10s、超過は success へ進み残りは非同期)
- empty: n/a
- error: 作成失敗 → Retry(冪等キー付き)
- success: SCR-010

## Interactions
- Enter the world → ペルソナ作成 → 初期フィード(ambient 5 件+最初のフォロワーの歓迎投稿 1 件、G1 で生成)→ SCR-010

## AI Behaviors
- 歓迎投稿を G1(AIF-009)で 1 件生成。失敗時はプリセット定型文を使用(fallback)。
