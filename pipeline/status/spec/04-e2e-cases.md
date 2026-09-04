# 04 — E2E Cases(実装のゴール)
- 実行系: Web は Playwright(Chromium)。iOS/Android は Maestro(P1)。LLM は E2E では **録画済みレスポンスのスタブ**(`LLM_MODE=replay`)を既定とし、`LLM_MODE=live` は夜間のみ。
- P0 は MVP 完了の必須条件。

## E2E-001: 13歳未満は登録できない
- screens: [SCR-002]
- steps:
  1. Given 新規ユーザーが Email で認証した
  2. When 生年に 12 歳相当を選び「続ける」を押す
  3. Then 遮断画面が表示され、`/me` は 401 のまま
- priority: P0

## E2E-002: 3 タップで世界に入る
- screens: [SCR-002, SCR-003, SCR-004, SCR-006, SCR-010]
- steps:
  1. Given 13+ で登録済み、ペルソナなし
  2. When Popstar Era → @taytay19 → @hivequeenbea(first follower)→ Enter the world
  3. Then 10 秒以内にフィードが表示され、雑談 5 件と @hivequeenbea の歓迎投稿 1 件がある。energy=10
- priority: P0

## E2E-003: 初投稿で返信がストリームし、スタッツカードが出る
- screens: [SCR-010, SCR-011, SCR-013]
- steps:
  1. Given E2E-002 完了
  2. When + → "new song Friday" → Post
  3. Then 1.5 秒以内に最初のキャラ返信、5 秒以内に合計 2 件以上が投稿の下に現れ、Stat card が Aura/Followers/Humor の差分と 1〜2 文のナラティブを表示。energy=9
- priority: P0

## E2E-004: スレッドで返信すると相手が応答する
- screens: [SCR-012, SCR-011]
- steps:
  1. Given E2E-003 完了
  2. When 投稿を開き @hivequeenbea の返信に Reply → "see you opening night" → Post
  3. Then @hivequeenbea の返信がスレッドに追加され、energy=8
- priority: P0

## E2E-005: 8 アクション目でイベントが出て、3 択が結果と差分を生む
- screens: [SCR-010, SCR-014, SCR-013]
- steps:
  1. Given 7 アクション済み(投稿/返信の組合せ)
  2. When 8 回目の投稿を送る
  3. Then フィード上部に Event バナーが出る。開くと 3 択があり、「Drop receipts」を押すと 1 秒以内に Stat card(結果文+差分)が出て、閉じるとフィード先頭にプレスアカウント(ワールド別: thescoop / thequill / stagewire)のニュース投稿がある。energy が 1 減る
- priority: P0

## E2E-006: DM を送るとキャラが返す
- screens: [SCR-020, SCR-021]
- steps:
  1. Given フォロワー @hivequeenbea がいる
  2. When DMs → New message → @hivequeenbea → "did you see gmz?" → Send
  3. Then typing 表示の後 1〜3 バブルの返答が来る。affinity ハートが更新される。energy が 1 減る
- priority: P0

## E2E-007: エネルギー 0 → 広告で回復して投稿できる
- screens: [SCR-011, SCR-032, SCR-010]
- steps:
  1. Given energy=0
  2. When Post を押す
  3. Then Get Energy モーダルが出る。Watch an ad(テスト広告)完了で energy=1、モーダルが閉じ、投稿が送信される
- priority: P0

## E2E-008: Plus 購入で 50 エネルギーと広告非表示
- screens: [SCR-032, SCR-030, SCR-010]
- steps:
  1. Given energy=0、未課金
  2. When Get Plus → Monthly → Continue(RevenueCat sandbox)→ 成功
  3. Then energy=50、Get Energy に Watch an ad が表示されない、`/me`.subscription.active=true
- priority: P0

## E2E-009: 禁止入力はブロックされエネルギーを消費しない
- screens: [SCR-011]
- steps:
  1. Given energy=5
  2. When ガイドライン違反の文(未成年性的描写を示すテスト文)を Post
  3. Then インラインに "doesn't fit the world's guidelines" が出て投稿は作られず energy=5 のまま。GenerationLog に G8 verdict=block が 1 件
- priority: P0

## E2E-010: LLM 全滅でもアプリは壊れず課金されない
- screens: [SCR-011, SCR-010]
- steps:
  1. Given `LLM_MODE=fail`
  2. When 投稿する
  3. Then 投稿は作られ、フォールバック返信("@hivequeenbea: 👀" 等の定型)が表示され、`fallback` トースト、energy は減らない
- priority: P0

## E2E-011: 日本語ロケールで UI と返信が日本語になる
- screens: [SCR-002, SCR-010, SCR-011]
- steps:
  1. Given ロケール JA で登録し E2E-002 を完了
  2. When 「新曲、金曜に出します」を投稿
  3. Then UI ラベルが日本語、キャラ返信が日本語(replay データで検証)
- priority: P0

## E2E-012: Web ブラウザで E2E-002〜003 が通る
- screens: [SCR-002, SCR-003, SCR-004, SCR-006, SCR-010, SCR-011, SCR-013]
- steps:
  1. Given Chromium(1280×800)
  2. When E2E-002, E2E-003 の手順
  3. Then 同じ結果。Get Energy に Watch an ad は表示されない
- priority: P0

## E2E-013: 全アクションが GenerationLog と実験割当を残す
- screens: [SCR-011]
- steps:
  1. Given E2E-003 完了
  2. When DB を確認する
  3. Then その投稿に紐づく G1 の GenerationLog が 1 件あり、4 種トークンと costUsd>0、variantId が `/experiments/assignments` の値と一致
- priority: P0

## E2E-014: 👎 で返信が上位モデルで差し替わる
- screens: [SCR-012]
- steps:
  1. Given E2E-003 完了
  2. When 返信の 👎 を押す
  3. Then 2 秒以内に新しい返信に差し替わり、新 GenerationLog.escalatedFrom=旧 id、Rating.regenerate=true
- priority: P0

## E2E-015: 日次リフィル
- screens: [SCR-032]
- steps:
  1. Given energy=0、時刻を翌日に進める(テストフック)
  2. When Get Energy を開く
  3. Then energy=10、タイマーが再設定される
- priority: P0

## E2E-016: 未成年は非パーソナライズ広告
- screens: [SCR-002, SCR-032]
- steps:
  1. Given 生年 16 歳相当で登録
  2. When Get Energy で広告をロード
  3. Then 広告リクエストに npa=1 が付く(テストアダプタで検証)
- priority: P0

## E2E-017: Load more で追加返信が遅延生成される
- screens: [SCR-012]
- steps: Given E2E-003 / When Load more / Then 2 件追加、2 回目は非表示
- priority: P1

## E2E-018: キャラが過去の投稿を覚えている
- screens: [SCR-021]
- steps: Given 「猫を飼い始めた」と投稿済み+記憶統合ジョブ実行 / When DM で「最近どう?」 / Then 返答に猫への言及(judge 判定)
- priority: P1

## E2E-019: 不在ダイジェスト
- screens: [SCR-010]
- steps: Given 24h 不在(ジョブ実行) / When 起動 / Then "While you were away" カードと新規投稿 5 件・DM 1 件
- priority: P1

## E2E-020: 雑談プールが LLM 呼び出しなしで供給される
- screens: [SCR-010]
- steps: Given AmbientPost 200 件 / When スクロール 50 件 / Then GenerationLog に G2 のオンライン呼び出しが 0 件
- priority: P1
