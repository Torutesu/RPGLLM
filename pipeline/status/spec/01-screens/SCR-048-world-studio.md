# SCR-048: World Studio — 作成
- route: /studio
- auth: authenticated
- purpose: 1 行から世界をまるごと作らせる。ゲームの世界がチームの手書き 3 本で打ち止めにならないための入口

## Layout
```
[← World Studio]
  一行の設定から、世界がまるごと立ち上がる。
┌──────────────────────────────────┐
│ どんな世界？                       │
│ デビュー枠はひとつ、練習生は7人。      │
│ 流出したグループチャット。            │
│                          62/200   │
└──────────────────────────────────┘
ジャンル
 [セレブ][学園][アイドル][オフィス]
 [スポーツ][ファンタジー][ミステリー][日常]
言語  [EN][JA]
誰が遊べる？
 (•) 自分だけ    完成後すぐ遊べます。一覧には出ません。
 ( ) リンクを知っている人
 ( ) みんな      人の審査を通ると発見タブに並びます。
┌──────────────────────────────────┐
│        この世界をつくる  ◈120      │  残り 3
└──────────────────────────────────┘
```

## Components
| Component | Behavior | Data |
|---|---|---|
| PremiseField | 8–200 文字。文字数を常時表示。プレースホルダはジャンルに応じて回る | - |
| GenrePicker | `WORLD_GENRES` の 8 種。選択でプレースホルダとカバーの色相が変わる | - |
| VisibilityPicker | 3 択。それぞれ結果を 1 行で説明する(公開＝人間の審査) | - |
| CostRow | 120 ジェムと残高、今日の残り作成回数 | GET /wallet, MyWorldsRes.remainingToday |

## States
- default: 入力待ち。CTA は 8 文字未満で無効
- blocked: 422。カテゴリに応じた 1 行(`studioPremiseBlocked`)。ジェムは減らない
- poor: 402。ジェムの入手先(連続ログイン / パック)へ導線
- limited: 429。`studioLimitReached`
- submitting: CTA がスピナー。二重送信を止める

## Interactions
- 作成 → SCR-049 へ push(戻るで作成画面には戻さない)

## AI Behaviors
- 送信前に `screenPremise()` が走る(サーバ側)。ブロックはトークンを 1 つも使わずに返る
- 本生成は G9 の 5 段階パイプライン。詳細は 05-ai-features.md
