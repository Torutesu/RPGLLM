# SCR-045: Celebration
- route: 全画面オーバーレイ(ルート無し)
- auth: authenticated
- purpose: レベルアップ・フォロワーの節目・実績解除を「出来事」にする。数値が黙って増えるだけでは記憶に残らない

## Layout
```
        ✨ グラデーションの光
        LEVEL UP
             5
        Main character
        [ 閉じる ]
```

## Components
| Component | Behavior | Data |
|---|---|---|
| Celebration | 数値がカウントアップし、粒子が弾ける | pending achievements / level / milestone |

## States
- loading: n/a
- empty: 保留が無ければ表示しない
- error: n/a
- success: 表示 → 1タップまたは数秒で自動的に閉じる

## Interactions
- スタッツカード表示中は抑止され、背景のタップは透過する。**プレイヤーの操作も E2E のクリックも決して塞がない**

## AI Behaviors
- none
