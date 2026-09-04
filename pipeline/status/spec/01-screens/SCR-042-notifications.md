# SCR-042: Notifications
- route: /notifications(タブ)
- auth: authenticated
- purpose: SNS 系プロダクト最大のドーパミン装置。誰が反応したかを一箇所に集め、アプリに戻る理由を作る。**MVP には存在しなかった**

## Layout
```
[← Notifications]                    [🔥1] [Mark all read]
┌ 連続ログイン(1日目) 階段 1..7  [受け取り済み] ┐
SEP 4
│(av) Chris Wen sent you a message          now
│(av) Dex Amherst liked your post           now
│(av) Bea Solano replied to you             now
```
未読行は左にアクセントの帯が付く。

## Components
| Component | Behavior | Data |
|---|---|---|
| StreakCard | 当日の受け取り状況と 7 日間の階段 | StreakRes |
| NotifRow | アクターのアバター+種別バッジ+相対時刻。タップで `target` へ遷移 | NotificationsRes |
| MarkAll | `POST /v1/notifications/read {ids:null}` | MarkNotificationsReadRes |

## States
- loading: スケルトン
- empty: ベルのアイコンと `notifEmpty`
- error: Retry
- success: 日付ごとにグルーピング

## Interactions
- `post:<id>` → SCR-012 / `dm:<threadId>` → SCR-021 / `event:<id>` → SCR-014 / `achievement:<key>` → SCR-044
- タブの未読バッジは返信が届いた瞬間に点灯する

## AI Behaviors
- none。通知は生成の**結果**として、原因となった処理と同じトランザクションで書かれる
