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

## S0/S1 追加分(gap-analysis 対応, 2026-09-04)

認証は**ワンタイムコード**に変更。`POST /auth/email/start` が 6 桁コードを発行(保存はソルト付きハッシュのみ、10 分・5 回・使い捨て)、`/auth/email/verify` が検証する。固定コード `000000` は `AUTH_DEV_CODE=1`(`TEST_HOOKS=1` が含意)のときだけ通り、本番では起動ガードが弾く。

| Method | Path | Auth | Request | Response | Screen |
|---|---|---|---|---|---|
| POST | /account/delete | authenticated | {confirm:"DELETE"} | {deletedAt, purgeAt} | SCR-036 |
| POST | /account/restore | authenticated | - | {restored} / 410 期限切れ | SCR-036 |
| GET | /account/export | authenticated | - | ExportDataRes(1,000 件で truncated) | SCR-033 |
| POST | /account/consent | authenticated | {analytics} | {analytics, locked} — 未成年は強制 false | SCR-033 |
| POST | /moderation/report | authenticated | {target, targetId, reason, note} | {id, status} / 409 重複 | SCR-037 |
| POST | /moderation/block | authenticated | {personaId, characterId} | {blocked} / 409 BLOCKED | SCR-037 |
| POST | /moderation/unblock | authenticated | {personaId, characterId} | {unblocked} / 404 | SCR-034 |
| GET | /moderation/blocked | authenticated | ?personaId | BlockedListRes | SCR-034, SCR-033 |
| GET | /moderation/reports | admin | ?status=open | 通報キュー(TEST_HOOKS か ADMIN_TOKEN) | - |

### 横断的な変更
- **レート制限**: 認証 5/分(IP+メール)、書き込み 20/分、広告報酬 10/分、その他 120/分。超過は 429 + `Retry-After`、コードは `RATE_LIMITED`。`TEST_HOOKS=1` で無効。
- **CORS**: `CORS_ORIGINS` の許可リスト。`*` は `TEST_HOOKS=1` のときのみ。
- **`?token=`**: `GET .../stream` の 2 本だけで受理。更新系では無視される。
- **削除済みアカウント**: `requireAuth` が 410 `ACCOUNT_DELETED` を返す(`/account/restore` のみ例外)。
- **`GET /health`**: `db:"ok"|"down"` を追加。DB 断で 503。
- **広告報酬**: 固定トークンは `ADS_MODE=test` のときのみ。それ以外は AdMob の SSV 署名検証(失敗時は拒否)。
- **リクエスト ID**: `x-request-id` を尊重/生成し、レスポンスヘッダと全エラー本文に載せる。

## S2 追加分(リテンション/グロース, 2026-09-04)

| Method | Path | Auth | Request | Response | Screen |
|---|---|---|---|---|---|
| GET | /digest | authenticated | ?personaId | DigestRes(未読が無ければ null。不在条件を満たせばオンデマンド生成) | SCR-038 |
| POST | /digest/:id/seen | authenticated | - | {seenAt} | SCR-038 |
| GET | /memory/:characterId | authenticated | ?personaId(id でも handle でも可) | MemoryLedgerRes | SCR-039 |
| GET | /moments | authenticated | ?personaId | MomentListRes | SCR-040 |
| GET | /moments/:slug | **public** | - | MomentRes | SCR-040 |
| GET | /referral | authenticated | - | ReferralRes | SCR-041 |
| POST | /referral/redeem | authenticated | {code} | {coffee, energy} | SCR-041 |
| GET | /profile | authenticated | ?personaId | ProfileRes | SCR-026 |
| POST | /push/register | authenticated | {token, platform} | {registered} | - |
| POST | /__test/run-job | TEST_HOOKS | {job} | ジョブを同期実行(スケジューラ代替) | - |

### 実装上の注意
- **G10/G2 はゲートウェイに存在しない**。ダイジェストは **G5 + G1(+DM は G4)**、雑談プール補充は **G1 に合成プロンプト**で代替している。全て `GenerationLog` に記録される。
- **Batch ティアは未対応**。`cost-architecture.md` §5.4 が想定する 50% 割引はまだ効いていない(唯一の未達項目)。
- ダイジェストは**エネルギーを消費しない**。
- **スケジューラが無い**。`runOfflineDirector` / `runMemoryConsolidation` / `runAmbientRefill` を cron から呼ぶこと。
