# SCR-049: World Studio — 生成中 → 完成
- route: /studio/[id]
- auth: 作成者のみ(他人は 404)
- purpose: 1 分の待ち時間を「読み込み」ではなく「立ち上がり」に変える。完成の瞬間がこの機能のご褒美

## Layout
```
生成中                          完成
┌────────────────┐        ┌────────────────┐
│  ▓▓▓▓▓▓▓░░░░░  │        │   (cover art)   │
│ 世界設定を書いています │        │  Debut or Die   │
│ ✓ 世界設定        │        │  デビュー枠はひとつ  │
│ ⟳ 8人のキャスト     │        │  ─ キャスト ─     │
│ · カバーを描いています │        │ (av)(av)(av)(av) │
│ · フィードを温めています │        │ (av)(av)(av)(av) │
└────────────────┘        │ [この世界で遊ぶ]   │
 1分ほどかかります。離れても  │ [みんなに公開する] │
 大丈夫、完成したら通知します。│ [自分だけにしておく] │
```

## Components
| Component | Behavior | Data |
|---|---|---|
| StepList | 4 段階(bible/cast/art/feed)。`progress` に従って進む | WorldStatusRes.progress |
| CastReveal | 8 人が順に現れる。アバターはハンドルから手続き的に生成 | WorldStatusRes.cast |
| PublishRow | 公開 / 非公開。公開は審査に入ることを明示する | POST /worlds/:id/publish |

## States
- generating: ステップ表示。ポーリング(離脱可、完了は通知で戻す)
- ready: 完成。カバー・タイトル・シナリオ・キャスト
- unlisted: リンク共有可。コピー導線を出す。発見タブには出ない
- review: 審査中バッジ。遊べる。発見タブにはまだ出ない
- rejected: 理由を表示。自分だけの世界としてはそのまま遊べる
- failed: `studioFailed` + 返金済みの明示 + やり直し

## Interactions
- 遊ぶ → SCR-004(ペルソナ作成)へ。以降は既存のワールドと完全に同じ流れ

## AI Behaviors
- 公開申請時に G8 が生成済みバイブルとキャストを検査する。block は公開しない(遊ぶのは可)
