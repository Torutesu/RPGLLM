# Push notifications — credentials, policy, and how to test

Push is fully wired and **off**. `PUSH_ENABLED=0` (the default) makes every send a logged no-op, so
nothing here can wake a phone until a human has done the work below.

Owner: Agent P. Code: `apps/api/src/services/push.ts`, `apps/api/src/routes/push.ts`,
`apps/mobile/src/push.ts`, `apps/mobile/src/notifications-module.ts`. Tests:
`apps/api/test/push.test.ts`.

---

## 1. What a human must configure

### Expo project

1. `eas init` (or the Expo dashboard) → note the **project id** (a UUID).
   Set it as `EXPO_PUBLIC_EXPO_PROJECT_ID` for the client build. `getExpoPushTokenAsync()` needs it
   in any build that is not a plain Expo Go session.
2. `app.json` already lists `expo-notifications` in `plugins`. Add an icon/colour there if the
   Android small-icon default is not wanted.

### iOS — APNs

1. Apple Developer → Certificates, Identifiers & Profiles → **Keys** → create a key with
   *Apple Push Notifications service (APNs)* enabled. Download the `.p8` **once** — it cannot be
   re-downloaded.
2. Note the **Key ID**, your **Team ID**, and the bundle id (`com.rpgllm.status`).
3. `eas credentials` → iOS → Push Notifications → upload the `.p8`, Key ID and Team ID.
   (EAS can also create the key for you, which is the fewest steps.)
4. The `aps-environment` entitlement is added by the config plugin at prebuild — nothing to do by
   hand.

### Android — FCM

1. Firebase console → create/choose the project → add an **Android app** with package
   `com.rpgllm.status` → download `google-services.json`.
2. Firebase → Project settings → Cloud Messaging → **enable the Firebase Cloud Messaging API (V1)**.
3. Service accounts → generate a private key JSON.
4. `eas credentials` → Android → **FCM V1** → upload that service-account JSON.
5. Put `google-services.json` at `apps/mobile/google-services.json` and reference it from
   `app.json` (`expo.android.googleServicesFile`) before building.

### Server

| variable | default | meaning |
|---|---|---|
| `PUSH_ENABLED` | `0` | **the master switch.** Nothing is sent until this is `1` |
| `PUSH_DAILY_CAP` | `4` | maximum pushes per user per local day |
| `PUSH_QUIET_START_HOUR` | `23` | start of quiet hours (local) |
| `PUSH_QUIET_END_HOUR` | `8` | end of quiet hours (local) |
| `PUSH_MIN_GAP_MINUTES` | `15` | minimum gap between notification-derived pushes |
| `PUSH_AWAY_MINUTES` | `30` | how long a user must have been idle before a notification becomes a push |
| `PUSH_DEFAULT_TZ` | `UTC` | timezone assumed for every locale except `ja` |

No API key is needed to talk to the Expo push service for Expo-signed tokens; the APNs/FCM
credentials live on the Expo project, not on our server.

---

## 2. What the app does

**Registration is deliberately late.** The permission dialog is *locked* until the user's first
successful post (`state/store.tsx` → `submitPost` → `pushAfterFirstPost()`). Asking on launch is the
single biggest cause of a permanent deny, and iOS shows the system dialog only once. Any earlier
call — the feed's mount, for instance — is a silent token refresh if permission was granted in a
previous session, and otherwise does nothing at all (`reason: "too_early"`).

After permission is granted: an Android channel (`default`) is created, the Expo token is sent to
`POST /v1/push/register`, and a tap handler is attached. `PushToken.token` is unique across
accounts, so registering the same device under a second account **moves** the token — a shared
phone never keeps receiving the previous user's notifications.

**Tap routing** (`routeForTarget`) mirrors the notification list: `post:<id>` → `/post/<id>`,
`dm:<threadId>` → the thread, `digest:`/`event:` → the feed, `achievement:` → SCR-044,
`profile` → the profile. A tap that cold-started the app is followed once on boot.

**Web is a hard no-op.** `notifications-module.web.ts` keeps `expo-notifications` out of the web
bundle entirely, so the Playwright suite can never meet a browser permission prompt.

---

## 3. What the server sends, and when

| trigger | source | note |
|---|---|---|
| a digest is generated | `jobs/offline-director.ts` → `notifyUser` | the "while you were away" push; the one that matters |
| a proactive DM | `services/notify.ts` (kind `dm`) | suppressed when a digest for the same persona was created in the last 5 minutes, so one director run cannot buzz twice |
| an event fires while the user is away | `services/notify.ts` (kind `event`) | |
| a follower milestone | `services/notify.ts` (kind `milestone`) | |

`reply`, `like`, `follow` and `unlock` notifications deliberately **never** push: they arrive in
bursts immediately after the user's own action, which is exactly the pattern that gets an app muted.

Everything is filtered through `shouldSend()`:

1. **Quiet hours** — nothing between 23:00 and 08:00 local. There is no timezone column on `User`
   (the schema was not this agent's to change), so *local* is inferred from the user's locale:
   **`ja` → `Asia/Tokyo`, everything else → `PUSH_DEFAULT_TZ` (UTC)**. This is the one assumption in
   the whole feature; when a real timezone lands (from the device, at registration),
   `timezoneForLocale` in `services/push.ts` is the only function that has to change. A suppressed
   push is dropped, not queued — the notification row still exists and the user sees it in-app.
2. **Daily cap** — `PUSH_DAILY_CAP` per user per local day.
3. **Quiet gap** — notification-derived pushes are at least `PUSH_MIN_GAP_MINUTES` apart. The
   digest push bypasses the gap (it is the point of the run) but still counts against the cap.
4. **Away only** — a notification-derived push waits until the user's last own post or DM is older
   than `PUSH_AWAY_MINUTES`.

The counters are in-process maps, the same single-process assumption the rest of the app documents.
Behind more than one API instance the effective cap is N× — move them to Redis when the API is
scaled out.

**Delivery**: messages go to `https://exp.host/--/api/v2/push/send` in chunks of **100** (Expo's
documented maximum). Tickets are read, the ticket ids are checked against
`https://exp.host/--/api/v2/push/getReceipts`, and any token reported as **`DeviceNotRegistered`**
— by the ticket or by the receipt — is **deleted**. Receipts are filled in asynchronously by Expo,
so the immediate read catches only some of them; a scheduled second pass over recent ticket ids
would catch the rest and is the obvious next step when a scheduler exists.

---

## 4. How to test

### Without any credentials (what is possible here)

```bash
# unit: chunking, pruning, quiet hours, the daily cap — with a stubbed Expo endpoint
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/<your db> pnpm --filter api exec vitest run test/push.test.ts
```

To watch the no-op path in a running API, leave `PUSH_ENABLED=0` and trigger a digest:

```bash
curl -X POST localhost:4000/v1/__test/run-job -H 'content-type: application/json' \
     -d '{"job":"digest","personaId":"<id>","force":true}'
# the API log shows: [push] skipped (PUSH_ENABLED != 1): "While you were away" -> user
```

### With credentials

1. Build a dev client: `eas build --profile development --platform ios` (or `android`).
2. Sign in, **post once** — that is what unlocks the permission dialog — and accept it.
3. Check the token landed: `select platform, "createdAt" from "PushToken" where "userId" = '<id>';`
4. Send a test notification straight to the device:
   ```bash
   curl -X POST https://exp.host/--/api/v2/push/send \
     -H 'content-type: application/json' \
     -d '[{"to":"ExponentPushToken[…]","title":"status","body":"bea replied","data":{"target":"post:abc"}}]'
   ```
   Tapping it must open `/post/abc`.
5. Turn the server on (`PUSH_ENABLED=1`), background the app, and run the digest job for that
   persona. A "While you were away" notification should arrive; tapping it opens the feed.
6. Quiet hours: set `PUSH_QUIET_START_HOUR`/`PUSH_QUIET_END_HOUR` to bracket the current hour and
   confirm the same job sends nothing (`reason: "quiet_hours"` in the result).
7. Uninstall the app and fire the job again: the send returns a `DeviceNotRegistered` ticket and the
   row disappears from `PushToken`.

## 5. Before submission

- [ ] iOS: the permission prompt is preceded by in-app context (today: it only appears after the
      first post, which is the context). Apple rejects apps that prompt on launch with no rationale.
- [ ] Android 13+: `POST_NOTIFICATIONS` is requested by `expo-notifications` at the same moment.
- [ ] The notification icon and accent colour are set for Android (`expo-notifications` plugin
      props) — the default is a white square.
- [ ] `PUSH_ENABLED=1` in production only after a real device has received a test push.
- [ ] Decide whether to keep quiet hours at UTC for non-`ja` users, or to start recording a real
      timezone at registration. Until then a `en` user in Tokyo gets quiet hours on UTC time.
