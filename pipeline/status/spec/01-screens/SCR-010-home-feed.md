# SCR-010: Home Feed
- route: /feed
- auth: authenticated
- purpose: 主戦場。キャラ投稿・あなたへの反応・ニュース・雑談が並ぶ X 風タイムライン

## Layout
```
[status ロゴ]            [⚡ energy 7]  [☕ 2]
┌ @gmz ✓ SHOCKER: Sources allege @you … ┐  ← news
│ 💬4.2K  🔁18.5K  ❤54.6K               │
├ @taytay19(you) new song Friday…        ┤  ← user post
│   └ @hivequeenbea ✓ iconic timing 👑   │  ← replies inline (2件、"Show more" で SCR-012)
├ @duneboytim ✓ the room is always…      ┤  ← ambient
└ …                                     ┘
[ + ] compose FAB                       (下タブ: Feed | DMs(未読●) | You)
```

## Components
| Component | Behavior | Data |
|---|---|---|
| EnergyBadge | タップで SCR-032 | Wallet.energy, coffee |
| FeedList | 無限スクロール(cursor)。新着はストリームで先頭挿入 | GET /feed |
| PostCell | いいね/RT はローカル演出(エネルギー消費なし)。返信ボタン→SCR-011(parentId) | Post, metrics |
| EventBanner | 未解決イベントがあれば固定表示 → SCR-014 | GET /events/pending |
| StatToast | 直近 StatSnapshot を 3 秒表示、タップで SCR-013 | StatSnapshot |
| ComposeFAB | SCR-011 | - |

## States
- loading: スケルトン 5 件
- empty: 初期化中("Your world is waking up…")、10 秒超で Retry
- error: オフラインバナー+キャッシュ表示
- success: リスト

## Interactions
- Pull-to-refresh → `GET /feed`
- PostCell タップ → SCR-012
- 返信 → SCR-011 (parentId)
- EventBanner → SCR-014
- EnergyBadge → SCR-032
- DMs タブ → SCR-020

## AI Behaviors
- 投稿後のストリーム(SSE)で G1 の返信を 1 件ずつ差し込む。ニュース(news フィールド)があれば @gmz 投稿を先頭に挿入。
- 雑談は AmbientPost プールから locale 別に無作為抽出(LLM 呼び出しなし)。
