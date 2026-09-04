# 03 — API(REST + SSE)
- version: 1 / base: `/v1` / auth: Bearer(セッション JWT)。全レスポンスは `{data, error}`。
- エネルギー不足は **402 `ENERGY_REQUIRED`**、安全ブロックは **422 `SAFETY_BLOCKED`**、LLM 全滅時は **200 + `fallback: true`**(ユーザーには課金しない)。

| Method | Path | Auth | Request | Response | Screen |
|---|---|---|---|---|---|
| POST | /auth/:provider | public | {idToken} or {email, code} | {jwt, isNew} | SCR-002 |
| POST | /auth/age-gate | authenticated | {birthYear, locale} | {isMinor} / 403 UNDER_13 | SCR-002 |
| GET | /me | authenticated | - | {user, wallet, subscription, persona?} | SCR-002, SCR-010, SCR-032 |
| GET | /worlds | authenticated | - | [{id, slug, title, scenario, difficulty, coverUrl}] | SCR-003 |
| GET | /worlds/:id | authenticated | - | {world, characters[], presetPersonas[]} | SCR-004, SCR-006 |
| GET | /personas/check | authenticated | ?worldId&handle | {available} | SCR-005 |
| POST | /personas | authenticated | {worldId, handle, displayName, bio, avatarUrl, voiceNotes, firstFollowerId, idempotencyKey} | {persona, feedReady} | SCR-006 |
| GET | /feed | authenticated | ?personaId&cursor | {posts[], nextCursor, pendingEvent?, lastSnapshot?} | SCR-010 |
| POST | /posts | authenticated | {personaId, text, parentId?} | {post, streamUrl} / 402 / 422 | SCR-011 |
| GET | /posts/:id/stream | authenticated | SSE | events: `reply{post}`, `news{post}`, `stat{snapshot}`, `event{event}`, `fallback`, `done` | SCR-010 |
| GET | /posts/:id | authenticated | - | {post, replies[]} | SCR-012 |
| POST | /posts/:id/more-replies | authenticated | - | {replies[]}(1 投稿 1 回まで) | SCR-012 |
| GET | /events/pending | authenticated | ?personaId | {event?} | SCR-010 |
| POST | /events/:id/choose | authenticated | {choiceId} | {snapshot, newsPost?} / 402 | SCR-014 |
| GET | /stats/:snapshotId | authenticated | - | {snapshot, persona{followers,aura,humor}} | SCR-013 |
| GET | /dms | authenticated | ?personaId | {threads[]} | SCR-020 |
| POST | /dms | authenticated | {personaId, characterId} | {thread} | SCR-020 |
| GET | /dms/:threadId | authenticated | ?cursor | {thread, messages[], relationship} | SCR-021 |
| POST | /dms/:threadId/messages | authenticated | {text} | {message, streamUrl} / 402 / 422 | SCR-021 |
| GET | /dms/:threadId/stream | authenticated | SSE | `message{dm}`, `affinity{delta}`, `fallback`, `done` | SCR-021 |
| GET | /wallet | authenticated | - | {energy, coffee, gems, dailyRefillAt, adRewardsToday, adsEnabled} | SCR-032 |
| POST | /wallet/ad-reward | authenticated | {adToken(SSV)} | {energy} / 429 AD_LIMIT | SCR-032 |
| POST | /wallet/coffee | authenticated | {count:1} | {energy, coffee} | SCR-032 |
| GET | /billing/offerings | authenticated | - | {plans[], experiments{trial, adfree}} | SCR-030 |
| POST | /billing/webhook | RevenueCat 署名 | RC event | 200 | SCR-030 |
| POST | /billing/restore | authenticated | {rcAppUserId} | {subscription} | SCR-030 |
| POST | /generations/:id/rate | authenticated | {value:-1|1, regenerate:bool} | {replacement?: post|message} | SCR-012, SCR-021 |
| GET | /experiments/assignments | authenticated | - | {[key]: variantId} | 全画面 |
| GET | /health | public | - | {ok, llm:{champion, fallbackDepth}} | - |

## サーバ内部ジョブ(非公開)
| Job | Trigger | 内容 |
|---|---|---|
| `event.prefetch` | 各アクション完了後、`actionCount % 8 == 7` or aura/followers 閾値 | G5(AIF-011)で次イベントを生成し `Event` に保存 |
| `memory.consolidate` | 未統合 `MemoryEntry` ≥10 or セッション終了+5分 | G7(AIF-012, Batch)で summary 更新 |
| `ambient.refill` | 夜間 | G2(AIF-015, Batch)で AmbientPost を locale 別に 200 件維持 |
| `wallet.dailyRefill` | 日次 | free: energy=max(energy,10)、plus: 50 |
| `eval.nightly` | 夜間 | GJ(AIF-006, Batch)で champion/challenger を採点 |
