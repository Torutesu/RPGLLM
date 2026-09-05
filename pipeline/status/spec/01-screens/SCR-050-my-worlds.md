# SCR-050: 自分の世界
- route: /studio/mine
- auth: authenticated
- purpose: 作った世界の在処。状態がここでしか分からないので、審査中も却下も正直に出す

## Layout
```
[← 自分の世界]                    残り 2
┌──────────────────────────────┐
│ (cover) Debut or Die      公開中 │
│ 練習生 7 人、デビュー枠 1        │
│ 128 プレイ                      │
└──────────────────────────────┘
┌──────────────────────────────┐
│ (cover) The Quiet Floor    審査中 │
└──────────────────────────────┘
┌──────────────────────────────┐
│ (cover) Nightshift        自分だけ │
└──────────────────────────────┘
        [ + 新しい世界をつくる ]
```

## Components
| Component | Behavior | Data |
|---|---|---|
| MyWorldCard | 状態バッジ(下書き/生成中/完成/審査中/却下/公開中)、プレイ数 | MyWorldsRes.worlds |
| RejectedNote | 却下理由をそのまま表示。作者には隠さない | world.reason |
| CreateCTA | 残り回数が 0 のときは無効化して理由を出す | MyWorldsRes.remainingToday |

## States
- loading / empty(`studioNoWorlds` + 作成 CTA) / error / success

## Interactions
- カード → SCR-049(生成中・完成)または直接プレイ
- 発見タブの「プレイヤーがつくった世界」は `/worlds/public` を出す別セクション(SCR-046)
