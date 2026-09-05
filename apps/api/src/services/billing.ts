import { createHmac, timingSafeEqual } from "node:crypto";
import { Prisma, type PrismaClient, type Subscription } from "@prisma/client";
import { ENERGY, GEM_PACKS, PLANS, isGemPack, type PlanId } from "@rpgllm/shared";
import { z } from "zod";
import type { Clock } from "../clock";
import { nextMidnight } from "../clock";
import { billingMode, envStr, isProduction } from "../env";
import { entitlementsFor } from "./entitlements";
import { newWalletData } from "./wallet";
import type { Tx } from "../types";

/**
 * RevenueCat — server side.
 *
 * Two entry points: the webhook (RevenueCat tells us what the stores did) and restore (we ask
 * RevenueCat what a user owns). Everything here is written so that:
 *   • the client is never trusted — the only inputs are RevenueCat's, and the app-user id we
 *     reconcile against is always one *we* already know for the authenticated user;
 *   • applying the same event twice is a no-op — `Purchase.rcEventId` is unique and is created in
 *     the same transaction as the subscription and wallet writes, so the event is the idempotency
 *     key for the whole effect, not just for the receipt row;
 *   • entitlement rules live in `services/entitlements.ts`, never here.
 *
 * Env (read lazily; `env.ts` belongs to another agent, so the two RevenueCat secrets are read
 * straight from `process.env` and documented in `.env.example` + `docs/billing.md`):
 *   REVENUECAT_WEBHOOK_SECRET  shared secret for the webhook. Required in production.
 *   REVENUECAT_SECRET_KEY      REST API v1 secret key (`sk_...`) used by restore.
 *   REVENUECAT_API_URL         override for tests (default https://api.revenuecat.com).
 *   RC_PRODUCT_MAP             optional JSON {"<store product id>":"<PlanId>"} .
 */

export const revenueCatWebhookSecret = (): string => envStr("REVENUECAT_WEBHOOK_SECRET", "");
export const revenueCatSecretKey = (): string => envStr("REVENUECAT_SECRET_KEY", "");
export const revenueCatApiUrl = (): string => envStr("REVENUECAT_API_URL", "https://api.revenuecat.com").replace(/\/+$/, "");

/* ------------------------------------------------------------------ signature ---- */

const constantTimeEquals = (a: string, b: string): boolean => {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  // timingSafeEqual throws on a length mismatch; hash both sides so the compare is always
  // over equal-length buffers and the length itself does not leak through the timing.
  const ah = createHmac("sha256", "len").update(ab).digest();
  const bh = createHmac("sha256", "len").update(bb).digest();
  return timingSafeEqual(ah, bh);
};

export type SignatureVerdict =
  | { ok: true; via: "hmac" | "shared-secret" | "test-bypass" }
  | { ok: false; reason: "missing" | "mismatch" | "unconfigured" };

/**
 * RevenueCat signs a webhook with the value you type into its dashboard. Two schemes are in the
 * wild and both are accepted here:
 *   • `X-RevenueCat-Signature: [sha256=]<hex|base64>` — HMAC-SHA256 of the **raw** body;
 *   • `Authorization: <secret>` (optionally `Bearer <secret>`) — the shared-secret header.
 * Anything else is rejected. `BILLING_MODE=test` (never allowed in production, see
 * `assertProductionConfig`) accepts an unsigned request so vitest and the sandbox can post events.
 */
export function verifyWebhookSignature(headers: Headers, rawBody: string): SignatureVerdict {
  const secret = revenueCatWebhookSecret();
  const signature = headers.get("x-revenuecat-signature") ?? headers.get("x-revenuecat-signature-256") ?? "";
  const authorization = headers.get("authorization") ?? "";

  if (!secret) {
    if (billingMode() === "test" && !isProduction()) return { ok: true, via: "test-bypass" };
    return { ok: false, reason: "unconfigured" };
  }

  if (signature) {
    const provided = signature.replace(/^sha256=/i, "").trim();
    const mac = createHmac("sha256", secret).update(rawBody, "utf8").digest();
    const expected = [mac.toString("hex"), mac.toString("base64")];
    return expected.some((e) => constantTimeEquals(e, provided))
      ? { ok: true, via: "hmac" }
      : { ok: false, reason: "mismatch" };
  }

  if (authorization) {
    const provided = authorization.replace(/^Bearer\s+/i, "").trim();
    return constantTimeEquals(secret, provided) ? { ok: true, via: "shared-secret" } : { ok: false, reason: "mismatch" };
  }

  // A secret is configured and the request carried neither header: refuse. The test bypass above
  // exists only for an environment that has no secret at all.
  return { ok: false, reason: "missing" };
}

/* ---------------------------------------------------------------------- events ---- */

/** The subset of the RevenueCat v1 webhook event we act on. Unknown keys are ignored, not rejected. */
export const RcEventZ = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  app_user_id: z.string().min(1).optional(),
  original_app_user_id: z.string().min(1).optional(),
  aliases: z.array(z.string()).optional(),
  product_id: z.string().optional(),
  new_product_id: z.string().optional(),
  period_type: z.string().optional(),
  purchased_at_ms: z.number().optional(),
  expiration_at_ms: z.number().nullable().optional(),
  grace_period_expiration_at_ms: z.number().nullable().optional(),
  auto_renew_status: z.boolean().optional(),
  price: z.number().optional(),
  price_in_purchased_currency: z.number().optional(),
  currency: z.string().optional(),
  store: z.string().optional(),
  environment: z.string().optional(),
  entitlement_ids: z.array(z.string()).nullable().optional(),
  transferred_from: z.array(z.string()).optional(),
  transferred_to: z.array(z.string()).optional(),
  cancel_reason: z.string().optional(),
  event_timestamp_ms: z.number().optional(),
});
export type RcEvent = z.infer<typeof RcEventZ>;

export const RcWebhookBodyZ = z.object({ api_version: z.string().optional(), event: RcEventZ });

/** Every event type we know what to do with. Anything else is recorded and ignored. */
export const HANDLED_EVENTS = [
  "INITIAL_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "UNCANCELLATION",
  "CANCELLATION",
  "EXPIRATION",
  "BILLING_ISSUE",
  "SUBSCRIPTION_PAUSED",
  "SUBSCRIBER_ALIAS",
  "TRANSFER",
  "REFUND",
  "NON_RENEWING_PURCHASE",
] as const;
export type HandledEvent = (typeof HANDLED_EVENTS)[number];

const isHandled = (type: string): type is HandledEvent => (HANDLED_EVENTS as readonly string[]).includes(type);

/** `INITIAL_PURCHASE`, `RENEWAL`, `PRODUCT_CHANGE` and a trial conversion all top the tank up. */
const GRANTS_ENERGY: readonly string[] = ["INITIAL_PURCHASE", "RENEWAL", "PRODUCT_CHANGE", "UNCANCELLATION"];

/* --------------------------------------------------------------------- mapping ---- */

const PRODUCT_HINTS: readonly [RegExp, PlanId][] = [
  [/ad[_.-]?free/i, "adfree_monthly"],
  [/week/i, "plus_weekly"],
  [/(month|monthly)/i, "plus_monthly"],
  [/(year|annual)/i, "plus_yearly"],
];

/** Optional `RC_PRODUCT_MAP` JSON, so store product ids need not literally equal the `PLANS` keys. */
function productMap(): Record<string, PlanId> {
  const raw = envStr("RC_PRODUCT_MAP", "");
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, PlanId> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && v in PLANS) out[k] = v as PlanId;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Store product id → plan. Exact `PLANS` key first (what `docs/billing.md` tells you to name the
 * products), then `RC_PRODUCT_MAP`, then a conservative keyword match so a `com.x.plus.monthly`
 * style id still lands on the right row instead of silently doing nothing.
 */
export function planFromProductId(productId: string | undefined | null): PlanId | null {
  if (!productId) return null;
  if (productId in PLANS) return productId as PlanId;
  const mapped = productMap()[productId];
  if (mapped) return mapped;
  for (const [re, plan] of PRODUCT_HINTS) if (re.test(productId)) return plan;
  return null;
}

export function storeOf(event: RcEvent): string {
  switch ((event.store ?? "").toUpperCase()) {
    case "APP_STORE":
    case "MAC_APP_STORE":
      return "app_store";
    case "PLAY_STORE":
      return "play";
    case "STRIPE":
      return "stripe";
    case "":
      return "unknown";
    default:
      return (event.store ?? "unknown").toLowerCase();
  }
}

/** Amount in USD the event carries, 0 when it carries none. A refund is recorded as negative. */
export function amountUsdOf(event: RcEvent): number {
  const raw = event.price ?? 0;
  const amount = Number.isFinite(raw) ? raw : 0;
  return event.type === "REFUND" ? -Math.abs(amount) : amount;
}

const msToDate = (ms: number | null | undefined): Date | null =>
  typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? new Date(ms) : null;

/* ------------------------------------------------------------------- appliance ---- */

export interface SubscriptionPatch {
  plan: PlanId | null;
  active: boolean;
  renewsAt: Date | null;
}

/**
 * The whole event→state table, as a pure function (so the vitest cases can read like the table in
 * `docs/billing.md`). `current` is the row we already have, or null.
 *
 * The rule for every "the user is losing access" event is the same: **do not touch `active`, let
 * `renewsAt` do the work**, because `entitlementsFor` already drops entitlements the moment the
 * period end passes. Only a REFUND revokes on the spot.
 */
export function subscriptionPatchFor(event: RcEvent, current: Subscription | null, now: Date): SubscriptionPatch | null {
  const currentPlan = current && current.plan in PLANS ? (current.plan as PlanId) : null;
  const productPlan = planFromProductId(event.new_product_id ?? event.product_id);
  const plan = productPlan ?? currentPlan;
  const expiration = msToDate(event.expiration_at_ms);
  const grace = msToDate(event.grace_period_expiration_at_ms);

  switch (event.type) {
    case "INITIAL_PURCHASE":
    case "RENEWAL":
    case "PRODUCT_CHANGE":
    case "UNCANCELLATION":
      if (!plan) return null;
      return { plan, active: true, renewsAt: expiration ?? current?.renewsAt ?? null };

    case "CANCELLATION":
      // auto-renew turned off: the user keeps everything until the period end.
      if (!plan) return null;
      return { plan, active: true, renewsAt: expiration ?? current?.renewsAt ?? null };

    case "SUBSCRIPTION_PAUSED":
      if (!plan) return null;
      return { plan, active: true, renewsAt: expiration ?? current?.renewsAt ?? null };

    case "BILLING_ISSUE": {
      // Billing retry / grace period: entitlements survive until the grace end the store gave us
      // (or the current period end when it gave us none).
      if (!plan) return null;
      const until = grace ?? expiration ?? current?.renewsAt ?? null;
      return { plan, active: true, renewsAt: until };
    }

    case "EXPIRATION": {
      if (!plan) return null;
      const end = expiration ?? current?.renewsAt ?? now;
      // Past the period end this is simply a dead row; before it, access runs out on its own.
      return { plan, active: end.getTime() > now.getTime(), renewsAt: end };
    }

    case "REFUND":
      // The only immediate revocation. The money came back, the entitlement goes now.
      return { plan, active: false, renewsAt: null };

    // Non-subscription purchase (coffee / gem packs) — no entitlement moves. A gem pack is
    // granted upstream in `applyWebhookEvent`, before this is consulted.
    case "NON_RENEWING_PURCHASE":
      return null;

    default:
      return null;
  }
}

export interface ApplyResult {
  applied: boolean;
  duplicate: boolean;
  eventId: string;
  type: string;
  reason: string | null;
  userId: string | null;
  plan: PlanId | null;
  active: boolean | null;
  energy: number | null;
  /** gems granted by a consumable pack, when the event was one */
  gems: number | null;
}

const skip = (event: RcEvent, reason: string): ApplyResult => ({
  applied: false,
  duplicate: false,
  eventId: event.id,
  type: event.type,
  reason,
  userId: null,
  plan: null,
  active: null,
  energy: null,
  gems: null,
});

/** Every app-user id the event could plausibly name, most specific first. */
export function candidateUserIds(event: RcEvent): string[] {
  const ids = [
    event.app_user_id,
    ...(event.transferred_to ?? []),
    event.original_app_user_id,
    ...(event.aliases ?? []),
    ...(event.transferred_from ?? []),
  ];
  return [...new Set(ids.filter((v): v is string => typeof v === "string" && v.length > 0))];
}

/**
 * Resolve the local user: by id (our app-user id *is* the user id), else by `rcSubscriberId`.
 *
 * The candidate list is **ordered** (the account the event is about first, the accounts it came
 * from last) and the match is picked in that order — a `findFirst` over an `IN` list would let
 * Postgres hand back whichever row it liked, which on a TRANSFER means applying the event to the
 * account that just lost the subscription.
 */
export async function resolveUserId(prisma: PrismaClient, event: RcEvent): Promise<string | null> {
  const candidates = candidateUserIds(event);
  if (candidates.length === 0) return null;
  const users = await prisma.user.findMany({ where: { id: { in: candidates } }, select: { id: true } });
  const byId = candidates.find((c) => users.some((u) => u.id === c));
  if (byId) return byId;
  const subs = await prisma.subscription.findMany({
    where: { rcSubscriberId: { in: candidates } },
    select: { userId: true, rcSubscriberId: true },
  });
  const bySubscriber = candidates
    .map((c) => subs.find((sub) => sub.rcSubscriberId === c))
    .find((sub) => sub !== undefined);
  return bySubscriber?.userId ?? null;
}

/** Top the tank up to what the (new) plan is worth. Never removes energy. */
async function topUpEnergy(tx: Tx, userId: string, dailyMax: number, now: Date, ref: string): Promise<number> {
  const wallet = await tx.wallet.upsert({
    where: { userId },
    create: { ...newWalletData(userId, now), energy: dailyMax },
    update: {},
  });
  const target = Math.max(wallet.energy, dailyMax);
  const delta = target - wallet.energy;
  if (delta === 0) return wallet.energy;
  await tx.wallet.update({ where: { id: wallet.id }, data: { energy: target } });
  await tx.ledgerEntry.create({
    data: { walletId: wallet.id, currency: "energy", delta, source: "purchase", ref },
  });
  return target;
}

/**
 * Consumable gem packs (World Studio, AIF-003).
 *
 * These arrive as `NON_RENEWING_PURCHASE`. Until now they were recorded as a `Purchase` row and
 * dropped on the floor — the money was taken and nothing was granted. The grant runs inside the
 * same transaction as that `Purchase` row, whose unique `rcEventId` is therefore the idempotency
 * key for the gems too: a redelivered webhook hits the unique index and the whole thing rolls back.
 */
async function grantGems(tx: Tx, userId: string, gems: number, now: Date, ref: string): Promise<number> {
  const wallet = await tx.wallet.upsert({ where: { userId }, create: newWalletData(userId, now), update: {} });
  const updated = await tx.wallet.update({ where: { id: wallet.id }, data: { gems: { increment: gems } } });
  await tx.ledgerEntry.create({ data: { walletId: wallet.id, currency: "gems", delta: gems, source: "purchase", ref } });
  return updated.gems;
}

/** A refund claws the tank back down to the free ceiling so a refunded purchase cannot be farmed. */
async function clawBackEnergy(tx: Tx, userId: string, now: Date, ref: string): Promise<number> {
  const wallet = await tx.wallet.upsert({
    where: { userId },
    create: newWalletData(userId, now),
    update: {},
  });
  const target = Math.min(wallet.energy, ENERGY.FREE_DAILY);
  const delta = target - wallet.energy;
  if (delta === 0) return wallet.energy;
  await tx.wallet.update({ where: { id: wallet.id }, data: { energy: target } });
  await tx.ledgerEntry.create({
    data: { walletId: wallet.id, currency: "energy", delta, source: "admin", ref },
  });
  return target;
}

/**
 * Apply one webhook event.
 *
 * The `Purchase` row (unique on `rcEventId`) is created **first, inside the same transaction** as
 * every other write: a replay of the same event id therefore hits the unique index and rolls the
 * whole thing back, so "replay changes nothing" is enforced by the database, not by a code path.
 */
export async function applyWebhookEvent(prisma: PrismaClient, clock: Clock, event: RcEvent): Promise<ApplyResult> {
  const now = clock.now();
  const userId = await resolveUserId(prisma, event);
  if (!userId) return skip(event, "unknown_user");
  if (!isHandled(event.type)) {
    // Still record it, so the receipt log is complete and a replay stays idempotent.
    try {
      await prisma.purchase.create({
        data: {
          userId,
          sku: event.product_id ?? event.type,
          store: storeOf(event),
          amountUsd: new Prisma.Decimal(amountUsdOf(event).toFixed(2)),
          rcEventId: event.id,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return { ...skip(event, "duplicate"), duplicate: true, userId };
      }
      throw e;
    }
    return { ...skip(event, "unhandled_type"), userId };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.purchase.create({
        data: {
          userId,
          sku: event.new_product_id ?? event.product_id ?? event.type,
          store: storeOf(event),
          amountUsd: new Prisma.Decimal(amountUsdOf(event).toFixed(2)),
          rcEventId: event.id,
        },
      });

      const current = await tx.subscription.findUnique({ where: { userId } });
      const appUserId = event.app_user_id ?? event.original_app_user_id ?? userId;

      if (event.type === "SUBSCRIBER_ALIAS" || event.type === "TRANSFER") {
        // Nothing about the plan changes; the subscriber this account is known by does.
        const donors = event.transferred_from ?? [];
        const donated =
          donors.length > 0
            ? await tx.subscription.findFirst({
              where: { OR: [{ userId: { in: donors } }, { rcSubscriberId: { in: donors } }] },
            })
            : null;
        const source = donated ?? current;
        if (!source) return { ...skip(event, "no_subscription"), applied: true, userId };
        const saved = await tx.subscription.upsert({
          where: { userId },
          create: {
            userId,
            plan: source.plan,
            active: source.active,
            renewsAt: source.renewsAt,
            rcSubscriberId: appUserId,
          },
          update: {
            rcSubscriberId: appUserId,
            ...(event.type === "TRANSFER"
              ? { plan: source.plan, active: source.active, renewsAt: source.renewsAt }
              : {}),
          },
        });
        // The entitlement moves: the account it came from loses it in the same transaction.
        if (event.type === "TRANSFER" && donated && donated.userId !== userId) {
          await tx.subscription.update({
            where: { id: donated.id },
            data: { active: false, renewsAt: null },
          });
        }
        return {
          applied: true,
          duplicate: false,
          eventId: event.id,
          type: event.type,
          reason: null,
          userId,
          plan: saved.plan in PLANS ? (saved.plan as PlanId) : null,
          active: saved.active,
          energy: null,
          gems: null,
        };
      }

      // A consumable gem pack is not a subscription event at all: it grants a balance and stops.
      const purchased = event.new_product_id ?? event.product_id ?? "";
      if (event.type === "NON_RENEWING_PURCHASE" && isGemPack(purchased)) {
        const gems = await grantGems(tx, userId, GEM_PACKS[purchased].gems, now, `pack:${event.id}`);
        return {
          applied: true, duplicate: false, eventId: event.id, type: event.type, reason: "gems_granted",
          userId, plan: null, active: null, energy: null, gems,
        };
      }

      const patch = subscriptionPatchFor(event, current, now);
      if (!patch || !patch.plan) {
        // Recorded (the Purchase row above), but there is no entitlement to move.
        return { ...skip(event, patch ? "unknown_product" : "no_entitlement_change"), applied: true, userId };
      }

      const saved = await tx.subscription.upsert({
        where: { userId },
        create: {
          userId,
          plan: patch.plan,
          active: patch.active,
          renewsAt: patch.renewsAt,
          rcSubscriberId: appUserId,
        },
        update: { plan: patch.plan, active: patch.active, renewsAt: patch.renewsAt, rcSubscriberId: appUserId },
      });

      let energy: number | null = null;
      if (GRANTS_ENERGY.includes(event.type)) {
        const ent = entitlementsFor(saved, now);
        if (ent.entitled) energy = await topUpEnergy(tx, userId, ent.dailyEnergyMax, now, `${event.type.toLowerCase()}:${patch.plan}`);
      } else if (event.type === "REFUND") {
        energy = await clawBackEnergy(tx, userId, now, `refund:${event.id}`);
      }

      return {
        applied: true,
        duplicate: false,
        eventId: event.id,
        type: event.type,
        reason: null,
        userId,
        plan: patch.plan,
        active: saved.active,
        energy,
        gems: null,
      };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ...skip(event, "duplicate"), duplicate: true, userId };
    }
    throw e;
  }
}

/* ----------------------------------------------------------------------- restore ---- */

/** What `GET /v1/subscribers/{id}` gives us, narrowed to the fields restore needs. */
const RcEntitlementZ = z.object({
  expires_date: z.string().nullable().optional(),
  product_identifier: z.string().optional(),
  purchase_date: z.string().optional(),
});
const RcSubscriptionZ = z.object({
  expires_date: z.string().nullable().optional(),
  unsubscribe_detected_at: z.string().nullable().optional(),
  billing_issues_detected_at: z.string().nullable().optional(),
  grace_period_expires_date: z.string().nullable().optional(),
  store: z.string().optional(),
});
export const RcSubscriberResZ = z.object({
  subscriber: z.object({
    original_app_user_id: z.string().optional(),
    entitlements: z.record(z.string(), RcEntitlementZ).default({}),
    subscriptions: z.record(z.string(), RcSubscriptionZ).default({}),
  }),
});

export interface RemoteEntitlement {
  plan: PlanId;
  productId: string;
  expiresAt: Date | null;
  /** true while the store still serves it (period end in the future, or no end at all) */
  active: boolean;
}

const parseDate = (v: string | null | undefined): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** The best entitlement in a RevenueCat subscriber payload: active first, then the latest expiry. */
export function bestEntitlement(payload: z.infer<typeof RcSubscriberResZ>, now: Date): RemoteEntitlement | null {
  const found: RemoteEntitlement[] = [];
  for (const ent of Object.values(payload.subscriber.entitlements)) {
    const productId = ent.product_identifier ?? "";
    const plan = planFromProductId(productId);
    if (!plan) continue;
    const expiresAt = parseDate(ent.expires_date ?? null);
    const sub = payload.subscriber.subscriptions[productId];
    const graceEnd = parseDate(sub?.grace_period_expires_date ?? null);
    const end = graceEnd && expiresAt && graceEnd.getTime() > expiresAt.getTime() ? graceEnd : expiresAt;
    found.push({ plan, productId, expiresAt: end, active: end === null || end.getTime() > now.getTime() });
  }
  if (found.length === 0) return null;
  found.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return (b.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (a.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER);
  });
  return found[0] ?? null;
}

export type RestoreSource = "revenuecat" | "local";

export interface RestoreOutcome {
  subscription: Subscription | null;
  source: RestoreSource;
  /** why we fell back to the local row, when we did */
  note: string | null;
}

/**
 * Reconcile the local `Subscription` from RevenueCat.
 *
 * `appUserIds` is built by the caller from ids **the server already knows** for this user (the user
 * id and any `rcSubscriberId` on their row) — never from the request body, or restoring would be a
 * way to claim somebody else's subscription.
 */
export async function restoreFromRevenueCat(
  prisma: PrismaClient,
  clock: Clock,
  userId: string,
  appUserIds: readonly string[],
  fetchImpl: typeof fetch = fetch,
): Promise<RestoreOutcome> {
  const local = await prisma.subscription.findUnique({ where: { userId } });
  const key = revenueCatSecretKey();
  if (!key) return { subscription: local, source: "local", note: "REVENUECAT_SECRET_KEY is not configured" };

  const now = clock.now();
  let lastNote: string | null = null;
  for (const appUserId of appUserIds) {
    let payload: z.infer<typeof RcSubscriberResZ>;
    try {
      const res = await fetchImpl(`${revenueCatApiUrl()}/v1/subscribers/${encodeURIComponent(appUserId)}`, {
        headers: { authorization: `Bearer ${key}`, accept: "application/json" },
      });
      if (!res.ok) {
        lastNote = `RevenueCat responded ${res.status}`;
        continue;
      }
      const parsed = RcSubscriberResZ.safeParse(await res.json());
      if (!parsed.success) {
        lastNote = "RevenueCat response did not match the expected shape";
        continue;
      }
      payload = parsed.data;
    } catch {
      lastNote = "RevenueCat is unreachable";
      continue;
    }

    const best = bestEntitlement(payload, now);
    if (!best) {
      // An answer with no entitlements is authoritative: the account owns nothing.
      if (local && local.active) {
        const cleared = await prisma.subscription.update({
          where: { userId },
          data: { active: false, renewsAt: null },
        });
        return { subscription: cleared, source: "revenuecat", note: null };
      }
      return { subscription: local, source: "revenuecat", note: null };
    }

    const saved = await prisma.subscription.upsert({
      where: { userId },
      create: {
        userId,
        plan: best.plan,
        active: best.active,
        renewsAt: best.expiresAt,
        rcSubscriberId: payload.subscriber.original_app_user_id ?? appUserId,
      },
      update: {
        plan: best.plan,
        active: best.active,
        renewsAt: best.expiresAt,
        rcSubscriberId: payload.subscriber.original_app_user_id ?? appUserId,
      },
    });
    return { subscription: saved, source: "revenuecat", note: null };
  }

  return { subscription: local, source: "local", note: lastNote ?? "no app user id to reconcile" };
}
