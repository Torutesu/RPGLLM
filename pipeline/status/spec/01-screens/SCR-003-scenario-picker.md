# SCR-003: Scenario Picker
- route: /onboarding/scenario
- auth: authenticated
- purpose: プリセット3ワールドから1つ選ぶ(3タップで世界に入る導線の1つ目)

## Layout
```
"Pick your story"
[カード: Popstar Era ★★  cover  1行シナリオ]
[カード: Magic Academy Politics ★★★]
[カード: Idol Survival ★★]
(横スワイプ / Web はグリッド)
```

## Components
| Component | Behavior | Data |
|---|---|---|
| WorldCard | タップで選択、下部に "Play as…" CTA | World.title[locale], scenario[locale], difficulty, coverUrl |

## States
- loading: スケルトンカード3枚
- empty: (プリセットは常に3件。0件はエラー扱い)
- error: "Couldn't load worlds" + Retry
- success: カード表示

## Interactions
- カード選択 → SCR-004(worldId を渡す)

## AI Behaviors
- none(ワールドはビルド時に G9 で生成済み。AIF-014)
