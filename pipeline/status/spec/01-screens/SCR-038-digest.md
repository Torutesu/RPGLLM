# SCR-038: While You Were Away(ダイジェスト)
- route: /feed 上部に固定表示(カード)
- auth: authenticated
- purpose: AIF-001。不在中もワールドが進んでいたことを示し、復帰の理由を作る。**Status に無い差別化の中核**

## Layout
```
┌────────────────────────────────┐
│ While you were away            │
│ The label moved the release    │
│ and your rival subtweeted it.  │
│ 5 new posts · 1 DM             │
│                    [ Catch up ]│
└────────────────────────────────┘
```

## Components
| Component | Behavior | Data |
|---|---|---|
| DigestCard | フィード最上部。`T.digestCard/digestHeadline/digestBody` | DigestRes |
| Dismiss | `T.digestDismiss` → `POST /v1/digest/:id/seen` → 消える | MarkDigestSeenRes |

## States
- loading: 表示しない(取得中はカード自体を出さない)
- empty: 未読ダイジェストが無ければ非表示
- error: 非表示(フィードは通常どおり)
- success: カード表示

## Interactions
- Catch up / Dismiss → 既読化 → 生成された投稿はフィード本体に並んでいる

## AI Behaviors
- **AIF-001**: 最終アクションから `DIGEST.MIN_AWAY_HOURS` 以上空いたペルソナに対し、G5 でディレクター・ビート、G1 でキャラ投稿 5 件、G4 で最高好感度キャラからの DM 1 件を生成。**エネルギーを消費しない**(ユーザーは行動していない)
- スケジューラが無いビルドのため、①関数呼び出し ②`POST /v1/__test/run-job` ③ダイジェスト取得時のオンデマンド生成、の 3 経路で起動する
- fallback: 生成失敗時はカードを出さない(フィードは通常表示)
