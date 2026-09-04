# Billing — RevenueCat, the stores, and what a human has to do

Everything in this document is work a person must do in a browser or in Xcode/Play Console. The code
is finished and tested; **the app cannot take a single payment until the steps below are done.**

Owner: Agent P. Code: `apps/api/src/services/{billing,entitlements}.ts`,
`apps/api/src/routes/billing.ts`, `apps/mobile/src/adapters/{billing,revenuecat}.ts`,
`apps/mobile/app/paywall.tsx`. Tests: `apps/api/test/billing.test.ts`, `e2e/tests/billing.spec.ts`.

---

## 1. The product catalogue

`packages/shared/src/constants.ts` → `PLANS` is the source of truth. **Name the store products
exactly after its keys.** The server will still map `com.rpgllm.status.plus.monthly` style ids by
keyword, and `RC_PRODUCT_MAP` can map anything to anything, but an exact match is the only variant
that cannot be got wrong.

| `PLANS` key | product id to create | type | price (USD reference) | what it grants |
|---|---|---|---|---|
| `plus_weekly` | `plus_weekly` | auto-renewing subscription, 1 week | 6.99 | 50 energy/day, no ads, proactive DMs, relationship vibes |
| `plus_monthly` | `plus_monthly` | auto-renewing subscription, 1 month | 14.99 | same as above (this is the highlighted plan) |
| `plus_yearly` | `plus_yearly` | auto-renewing subscription, 1 year | 79.99 | same as above |
| `adfree_monthly` | `adfree_monthly` | auto-renewing subscription, 1 month | 3.99 | removes ads only — energy stays at the free 10/day |

Local prices are set per storefront in App Store Connect / Play Console. The paywall shows the
**store's own localized price string** whenever the store answers; the USD numbers above are only
the fallback for the web build and for a device that cannot reach the store.

### App Store Connect

1. Apps → *status clone* → **Subscriptions**. Create one subscription group, e.g. `status_plus`.
2. Add `plus_weekly`, `plus_monthly`, `plus_yearly` to that group (an upgrade/downgrade inside one
   group is what makes `PRODUCT_CHANGE` behave). Put `adfree_monthly` in a **separate** group, so a
   user can hold ad-free without it colliding with Plus.
3. Give every product a display name, a description and a review screenshot, and set the price tier.
4. Trials: add an **Introductory Offer → Free trial → 1 week** to `plus_monthly` and `plus_yearly`
   if the `paywall_trial` experiment is being run for real. The client reads the trial from the
   store product first and only falls back to the server experiment.
5. **In-App Purchase Key**: Users and Access → Integrations → In-App Purchase → generate a key and
   upload it to RevenueCat (needed for StoreKit 2 and for refund notifications).
6. **App Store Server Notifications V2**: point the production *and* sandbox URLs at RevenueCat
   (RevenueCat shows the exact URL on the App Store integration page). Without this, `REFUND` and
   `EXPIRATION` never reach us.

### Google Play Console

1. Monetize → **Subscriptions**: create the same four product ids, each with one base plan
   (`weekly` / `monthly` / `yearly` / `monthly`) and an auto-renewing billing period.
2. Offers: a *free trial* offer of 7 days on the monthly and yearly base plans, if the trial is on.
3. Monetization setup → **Licensing**: copy the RSA key into RevenueCat.
4. Create a **service account** with the *Financial data / Order management* role, grant it access to
   the app, download the JSON, upload it to RevenueCat.
5. Play Console → Monetization setup → **Real-time developer notifications**: paste the Pub/Sub topic
   RevenueCat gives you.

### RevenueCat dashboard

1. Create the project, then **two apps** (App Store, Play Store) and paste the credentials above.
2. Products: import all four ids from both stores.
3. **Entitlements**: create one entitlement per capability and attach the products:
   - `plus` → `plus_weekly`, `plus_monthly`, `plus_yearly`
   - `adfree` → `adfree_monthly` *and* the three Plus products (Plus includes ad-free)
4. **Offering** (`default`, marked *current*): one package per plan, package identifier free-form —
   the client matches on the **product identifier**, not the package identifier.
5. API keys → copy:
   - the **public** iOS key → `EXPO_PUBLIC_RC_IOS_KEY`
   - the **public** Android key → `EXPO_PUBLIC_RC_ANDROID_KEY`
   - the **secret** key (`sk_...`) → `REVENUECAT_SECRET_KEY` (server only — never in the app bundle)

---

## 2. The webhook

**URL**: `POST https://<your-api-host>/v1/billing/webhook`
**Set it at**: RevenueCat → Project → Integrations → Webhooks.

In the *Authorization header value* field, paste a long random string and set the same value as
`REVENUECAT_WEBHOOK_SECRET` on the API. The server accepts either scheme:

| header | what the server does |
|---|---|
| `X-RevenueCat-Signature: [sha256=]<hex or base64>` | HMAC-SHA256 of the **raw body** with the secret, constant-time compared |
| `Authorization: <secret>` or `Bearer <secret>` | constant-time compare against the secret |
| neither | **401** — unless no secret is configured at all *and* `BILLING_MODE=test` and it is not production (local/CI only) |

`assertProductionConfig()` already refuses to boot production with `BILLING_MODE=test`, so the
bypass cannot leak into a live deployment. Set `REVENUECAT_WEBHOOK_SECRET` anyway.

### Event → state mapping

Every event is recorded as a `Purchase` row keyed by `rcEventId` (RevenueCat's event id), **inside
the same transaction** as the subscription and wallet writes. A redelivery therefore hits the unique
index and rolls the whole thing back: replays are free, which matters because RevenueCat retries.

| event | `Subscription` | wallet |
|---|---|---|
| `INITIAL_PURCHASE` | plan = product, `active=true`, `renewsAt` = expiration | energy topped up to the plan's daily max |
| `RENEWAL` | same, `renewsAt` moved out | topped up again |
| `PRODUCT_CHANGE` | plan = `new_product_id` | topped up to the new plan's max |
| `UNCANCELLATION` | `active=true` | topped up |
| `CANCELLATION` | unchanged — **auto-renew off, access until `renewsAt`** | — |
| `SUBSCRIPTION_PAUSED` | unchanged, access until `renewsAt` | — |
| `BILLING_ISSUE` | `renewsAt` = grace-period end (or the period end) — **entitlements survive the retry window** | — |
| `EXPIRATION` | `renewsAt` = expiration; `active=false` only if that is already in the past | — |
| `REFUND` | `active=false`, `renewsAt=null` — **the only immediate revocation** | energy clawed back to the free ceiling; the `Purchase` row's amount is negative |
| `TRANSFER` | the entitlement is copied to the receiving account and deactivated on the donor | — |
| `SUBSCRIBER_ALIAS` | `rcSubscriberId` re-pointed, plan untouched | — |
| `NON_RENEWING_PURCHASE` | recorded only (consumables grant no entitlement) | — |
| anything else | recorded only | — |

An event whose `app_user_id` matches no local account is answered **200 with `applied:false`**: a
non-2xx would make RevenueCat retry forever an event that can never apply.

### Entitlements

`services/entitlements.ts` is the only place that decides what a subscription is worth;
`wallet.ts`'s `dailyMaxFor` / `adFreeFor` are wrappers over it. The rule, using the three columns
the schema has:

```
active = false                → nothing (an immediate revocation)
active = true, renewsAt null  → entitled
active = true, renewsAt > now → entitled  (also: cancelled-not-yet-expired, grace, billing retry)
active = true, renewsAt <= now→ nothing   (the period ran out; no webhook required)
```

The last line is the safety net: if an `EXPIRATION` webhook is ever lost, access still lapses on
time. It is also why a *billing retry* is expressed by moving `renewsAt` to the grace end rather
than by flipping a flag we do not have a column for.

Capabilities: `dailyEnergyMax`, `adFree`, `proactiveDMs`, `relationshipVibes`. The Plus tiers grant
all four; `adfree_monthly` grants only `adFree` (energy stays at the free 10/day).

---

## 3. Restore (`POST /v1/billing/restore`)

Guideline 3.1.1 requires it. The server calls
`GET https://api.revenuecat.com/v1/subscribers/{app_user_id}` with `REVENUECAT_SECRET_KEY`, picks
the live entitlement with the latest expiry (honouring `grace_period_expires_date`) and writes the
local row.

**The `rcAppUserId` in the request body is not trusted.** Reconciliation runs only against ids the
server already knows for the authenticated caller — their user id (which is what the client
identifies RevenueCat with) and any `rcSubscriberId` already on their row. The response echoes
`matchedRequestedUser:false` when the client's id was not one of them.

Without `REVENUECAT_SECRET_KEY` the endpoint returns the local row with `source:"local"` and a
`note` — it never pretends to have checked.

---

## 4. Environment variables

| variable | where | required | notes |
|---|---|---|---|
| `REVENUECAT_WEBHOOK_SECRET` | API | **yes in production** | the dashboard's Authorization header value |
| `REVENUECAT_SECRET_KEY` | API | **yes** | `sk_...`, restore only. Never ship to the client |
| `REVENUECAT_API_URL` | API | no | defaults to `https://api.revenuecat.com` |
| `RC_PRODUCT_MAP` | API | no | `{"com.x.plus.monthly":"plus_monthly"}` when product ids differ from `PLANS` |
| `BILLING_MODE` | API | yes | `revenuecat` in production. `test` enables `/dev-purchase` and the unsigned webhook, and is refused at boot in production |
| `EXPO_PUBLIC_RC_IOS_KEY` | client build | yes (iOS) | public SDK key |
| `EXPO_PUBLIC_RC_ANDROID_KEY` | client build | yes (Android) | public SDK key |
| `EXPO_PUBLIC_BILLING_MODE` | client build | yes | `revenuecat` for store builds; anything else (and the whole web build) uses `DevBilling` |

---

## 5. Sandbox test plan

Run every row before submitting. "Server" means check `GET /v1/me` (or the `Subscription` row).

| # | do | expect |
|---|---|---|
| 1 | iOS sandbox account, buy `plus_monthly` from SCR-030 | payment sheet shows the **store** price; success state; server shows `plus_monthly` active; wallet daily max 50; ads gone |
| 2 | same on an Android licence-tester account | as above |
| 3 | cancel the sandbox subscription in the store | `CANCELLATION` arrives; **still Plus** until the period end |
| 4 | wait for the sandbox renewal (1 week = 3 min in sandbox) | `RENEWAL`; `renewsAt` moves; tank topped up |
| 5 | let it lapse | `EXPIRATION`; after `renewsAt` passes the wallet is back to 10/day and ads return |
| 6 | force a billing issue (sandbox: decline the payment) | `BILLING_ISSUE`; entitlements survive until the grace end |
| 7 | request a refund (App Store sandbox refund / Play order refund) | `REFUND`; entitlements gone **immediately**; energy clawed back to 10 |
| 8 | reinstall the app, sign in, tap Restore in Settings | the plan comes back with `source:"revenuecat"` |
| 9 | tap Restore on an account that owns nothing | Settings reports the free plan — not an error |
| 10 | start a purchase and cancel the sheet | the paywall closes quietly, **no error toast** |
| 11 | buy on account A, sign out, sign in as B on the same device | B does **not** inherit Plus (RevenueCat `logOut` on sign-out) |
| 12 | replay any webhook delivery from the RevenueCat dashboard | `duplicate:true`, nothing changes |
| 13 | POST the webhook with a wrong signature | 401, nothing changes |

## 6. Before submission

- [ ] All four products **Ready to Submit**, with screenshots and localized descriptions.
- [ ] Paid Applications agreement signed; banking and tax forms complete (nothing works without it).
- [ ] The paywall shows: price, period, what is included, and — where a trial exists — its length,
      before the purchase button. Required by App Store 3.1.2.
- [ ] Terms and Privacy links reachable from the paywall's surroundings (Settings has them today) —
      replace the `LEGAL` placeholders in `packages/shared/src/constants.ts` with the real URLs.
- [ ] **Restore Purchases** visible without a purchase (Settings → Subscription → Restore). ✅ shipped
- [ ] Manage-subscription link points at the store's own page. ✅ shipped
- [ ] `BILLING_MODE=revenuecat` and `ADS_MODE=admob` in production; `assertProductionConfig()` will
      refuse to boot otherwise.
- [ ] `REVENUECAT_WEBHOOK_SECRET` set, and one real event delivered end to end in sandbox.
- [ ] Server clock is UTC and NTP-synced — every entitlement decision compares against `renewsAt`.
