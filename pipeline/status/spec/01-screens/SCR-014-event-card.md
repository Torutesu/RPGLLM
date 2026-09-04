# SCR-014: Event Card(ドラマ 3 択)
- route: /event/[id](モーダル)
- auth: authenticated
- purpose: 8 アクション毎(またはスタッツ閾値)に発生するドラマに 3 択で応じる(エネルギー 1 消費)

## Layout
```
🎭 Event
"Anonymous 'sources' are flooding the timeline with
 fabricated screenshots. How do you respond?"
[ Burn it down: drop a savage diss track at midnight ]
[ Drop receipts: post the studio voice memos ]
[ Stay silent: let the work speak ]
                                  ⚡1
```

## Components
| Component | Behavior | Data |
|---|---|---|
| Prompt | イベント本文 | Event.prompt |
| ChoiceButtons | 3 つ。押下で `POST /events/:id/choose` | Event.choices |

## States
- loading: 選択後 ≤1s(結果は事前生成済み)
- empty: n/a
- error: 402 → SCR-032 / 5xx → Retry
- success: SCR-013(結果ナラティブ+差分)→ 閉じると SCR-010 に news 投稿が追加されている

## Interactions
- 選択 → 結果 → SCR-013 → SCR-010
- 閉じる(未選択)→ EventBanner として SCR-010 に残る

## AI Behaviors
- イベントは G5(AIF-011)が **前のアクション完了時に先読み生成**し保存。3 択の結果文・差分も同時生成(選択時の LLM 呼び出しゼロ)。
- G5 失敗時は定型イベント(プリセット 5 種)から抽選(fallback)。
