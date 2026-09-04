# SCR-039: Memory Ledger(記憶台帳)
- route: /memory/[handle]
- auth: authenticated
- purpose: AIF-002。キャラが「何を覚えているか」を引用付きで可視化する。Character.AI が有料化し Status が不可視にしている領域を無料で開ける

## Layout
```
[← (av) Bea Solano @hivequeenbea  ❤❤❤♡♡ ]
WHAT THEY REMEMBER
  "You told them the album was done before the label knew."
     ↳ receipts: "the album is done"        (3日前)
  "You defended them when the press piled on."
     ↳ receipts: "leave her alone"          (5日前)
```

## Components
| Component | Behavior | Data |
|---|---|---|
| Header | 好感度ハート | MemoryLedgerRes.affinity |
| Summary | G7 が統合した要約 | MemoryLedgerRes.summary |
| MemoryRow | `T.memoryEntry(id)`。`sourceRef` を解決した引用を併記(元が消えていれば引用なし) | MemoryLedgerRes.memories |

## States
- loading: スケルトン
- empty: `noMemories`
- error: Retry
- success: 一覧

## Interactions
- DM 画面の好感度ハート(`T.memoryOpen`)、またはプロフィールのキャスト行から到達

## AI Behaviors
- **AIF-012(G7)**: 未統合メモが `PACING.MEMORY_CONSOLIDATE_AT` 件を超えると要約を生成し `RelationshipState.summary` / `Persona.worldSummary` に書き戻す。**MVP では一度も呼ばれていなかった不具合をここで解消**
- 起動経路はダイジェストと同じ 3 経路。fallback: 失敗時は旧要約を維持し、メモは未統合のまま次回再試行
