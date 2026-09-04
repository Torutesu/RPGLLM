# SCR-046: Explore
- route: /explore(タブ)
- auth: authenticated
- purpose: フィードを見終えた後の行き先。世界に自分以外が生きていることを示し、次のワールドへ誘導する

## Layout
```
[← Explore]
┌ YOUR RANK  top 47%   FOLLOWERS 127 ┐
TRENDING NOW
 1 record leave      2 posts  ▓▓▓▓░░
 2 second half       2 posts  ▓▓▓░░░
RISING WITH YOU
 (av)Chris +4  (av)Dex +3  (av)Bea +3
OTHER WORLDS
 [Magic Academy]  [Idol Survival]
```

## Components
| Component | Behavior | Data |
|---|---|---|
| RankCard | ワールド内の順位。`youAreTrending` の条件を満たすと強調 | TrendingRes.yourRank |
| TopicCard | ヒート順。タップでフィードを絞り込む | TrendingRes.topics |
| RisingRail | 直近で好感度が上がったキャラ | TrendingRes.risingCharacters |

## States
- loading: スケルトン
- empty: 投稿が少ないワールドでは話題が出ない(順位とキャラは常に出る)
- error: Retry
- success: 上記

## Interactions
- 話題タップ → SCR-010 を絞り込み / キャラタップ → SCR-047

## AI Behaviors
- none。話題はワールド自身の投稿本文から決定的に抽出する(LLM 呼び出しなし)
