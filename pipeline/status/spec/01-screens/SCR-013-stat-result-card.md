# SCR-013: Stat Result Card
- route: /feed?card=[snapshotId](モーダル)
- auth: authenticated
- purpose: アクション直後の即時フィードバック(ドーパミン)。ナラティブ+数値差分

## Layout
```
┌────────────────────────────┐
│ 💖 Aura +5%   ▓▓▓▓░░ 23%   │
│ "By morning the producer's │
│  deleted his socials…"     │
│ 👥 Followers ↑  🤣 Humor ↑  │
│ (av) the6ixdrey ↑ (av) hivequeenbea ↑ (av) kingkay ↓ │
│              [ Continue ]  │
└────────────────────────────┘
```

## Components
| Component | Behavior | Data |
|---|---|---|
| StatBars | アニメーションで前値→新値 | Persona.aura/humor/followers, StatSnapshot deltas |
| Narrative | 1〜2 文 | StatSnapshot.narrative |
| RelationshipRow | ↑↓ とアバター | StatSnapshot.relDeltas |

## States
- loading: n/a(データ同梱で開く)
- empty: n/a
- error: n/a
- success: 表示。Continue で閉じる

## Interactions
- Continue / 背景タップ → 閉じる

## AI Behaviors
- none(数値と文は G1/G5 の出力を表示するだけ)
