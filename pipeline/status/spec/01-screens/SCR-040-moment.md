# SCR-040: Shareable Moment
- route: /moment/[slug](公開。未ログインでも閲覧可)
- auth: public(生成はログイン中のイベントで発生)
- purpose: AIF-005。バズ/炎上の瞬間を縦型カードにして共有導線を自動化する。Status の成長は手動スクショ頼みなので、ここを自動化して K ファクターを上げる

## Layout
```
┌──────────── 9:16 ────────────┐
│  @taytay19                    │
│  "Followers −26K in one night"│
│  By morning the producer had  │
│  deleted his socials.         │
│  👥 −26K   💖 −8   🤣 +3       │
│  (av)(av)(av) reacted         │
│              [ Share ]        │
└───────────────────────────────┘
```

## Components
| Component | Behavior | Data |
|---|---|---|
| MomentCard | トークンのみで描画(外部画像なし)。フィードのリストヘッダとして出す(オーバーレイにすると投稿ボタンを覆う) | MomentRes.payload |
| Share | `T.momentShare`。web は `navigator.share` → クリップボード、native は `Share.share` | shareSlug |

## States
- loading: スケルトン(公開ページ)
- empty: 該当 slug 無しは 404 表示
- error: Retry
- success: カード表示

## Interactions
- スタッツが閾値を超えた直後にフィード先頭へ出る
- 共有リンクは未ログインでも開ける(獲得導線)

## AI Behaviors
- none(既存の生成結果からカードを組み立てるだけ。追加の LLM 呼び出しは発生しない)
