import type { NotificationKind, PrismaClient, PushToken } from "@prisma/client";
import { envNum, envStr } from "../env";
import { recordPushTickets } from "../jobs/push-receipts";

/**
 * S2-2 — Expo push delivery.
 *
 * Transport is off unless `PUSH_ENABLED=1`: every send then logs what it *would* have sent and
 * reports `skipped`, which is what keeps vitest and the E2E web export completely silent. With the
 * flag on, messages go to the Expo push service in chunks of 100 (its documented maximum), the
 * tickets are read back, and any token the service reports as `DeviceNotRegistered` is deleted —
 * an uninstalled app must stop costing us a request per notification.
 *
 * Policy, in one place (`shouldSend`), because a notification service that ignores it is how an app
 * gets muted at the OS level:
 *   • **quiet hours** — nothing between 23:00 and 08:00 *local* time. There is no timezone column
 *     on `User` (the schema is not this agent's to change), so local time is inferred from the
 *     user's locale: `ja` → Asia/Tokyo, everything else → `PUSH_DEFAULT_TZ` (default UTC).
 *     Documented in `docs/push.md`; the moment a real timezone lands, `timezoneForLocale` is the
 *     only function to change.
 *   • **daily cap** — at most `PUSH_DAILY_CAP` (default 4) pushes per user per local day.
 *   • **quiet gap** — notification-derived pushes are at least `PUSH_MIN_GAP_MINUTES` apart.
 *   • **away only** — a reply/DM/event push is pointless while the user is holding the app, so a
 *     notification-derived push waits until the persona has been idle `PUSH_AWAY_MINUTES`.
 *
 * The counters are in-process `Map`s, the same single-process assumption `src/types.ts` documents
 * for the rest of the app's non-persisted state. They fail *open* only after a restart, and the
 * worst case is one extra push.
 */
export const PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
export const PUSH_RECEIPTS_ENDPOINT = "https://exp.host/--/api/v2/push/getReceipts";

/** Read lazily so tests can flip the flag between app instances (env.ts is Agent F's file). */
export const pushEnabled = (): boolean => envStr("PUSH_ENABLED", "0") === "1";
export const pushDailyCap = (): number => envNum("PUSH_DAILY_CAP", 4);
export const pushQuietStartHour = (): number => envNum("PUSH_QUIET_START_HOUR", 23);
export const pushQuietEndHour = (): number => envNum("PUSH_QUIET_END_HOUR", 8);
export const pushMinGapMinutes = (): number => envNum("PUSH_MIN_GAP_MINUTES", 15);
export const pushAwayMinutes = (): number => envNum("PUSH_AWAY_MINUTES", 30);
export const pushDefaultTimezone = (): string => envStr("PUSH_DEFAULT_TZ", "UTC");

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface PushResult {
  sent: number;
  skipped: boolean;
  error: string | null;
  /** tokens deleted because the device is gone */
  pruned: number;
  /** why nothing was sent, when nothing was */
  reason: string | null;
}

const nothing = (reason: string | null): PushResult => ({ sent: 0, skipped: true, error: null, pruned: 0, reason });

/** Expo caps a single request at 100 messages. */
export const BATCH = 100;

/* ------------------------------------------------------------------ transport ---- */

interface ExpoTicket {
  status: string;
  id?: string;
  message?: string;
  details?: { error?: string };
}
interface ExpoReceipt {
  status: string;
  message?: string;
  details?: { error?: string };
}

const isTicket = (v: unknown): v is ExpoTicket =>
  typeof v === "object" && v !== null && typeof (v as { status?: unknown }).status === "string";

const errorCodeOf = (v: ExpoTicket | ExpoReceipt): string =>
  typeof v.details?.error === "string" ? v.details.error : "";

/** The one error that means "stop sending to this token, forever". */
export const DEVICE_GONE = "DeviceNotRegistered";

export async function pruneTokens(prisma: PrismaClient, tokens: readonly string[]): Promise<number> {
  if (tokens.length === 0) return 0;
  const res = await prisma.pushToken.deleteMany({ where: { token: { in: [...tokens] } } });
  return res.count;
}

export interface SendOptions {
  /** needed to prune dead tokens; without it a `DeviceNotRegistered` is only counted */
  prisma?: PrismaClient;
  /** injectable for tests */
  fetchImpl?: typeof fetch;
}

/**
 * Push to raw tokens. Chunks at 100, reads the tickets, then asks the receipts endpoint about the
 * ticket ids it got back (best effort — Expo fills receipts in asynchronously, so an immediate read
 * usually returns nothing, and a scheduled second pass would catch the rest).
 */
export async function sendPush(
  tokens: readonly string[],
  message: PushMessage,
  opts: SendOptions = {},
): Promise<PushResult> {
  const unique = [...new Set(tokens.filter((t) => t.length > 0))];
  if (unique.length === 0) return nothing("no_tokens");

  if (!pushEnabled()) {
    console.info(`[push] skipped (PUSH_ENABLED != 1): "${message.title}" -> ${String(unique.length)} token(s)`);
    return nothing("disabled");
  }

  const doFetch = opts.fetchImpl ?? fetch;
  let sent = 0;
  let error: string | null = null;
  const dead: string[] = [];
  const ticketToToken = new Map<string, string>();

  for (let i = 0; i < unique.length; i += BATCH) {
    const chunk = unique.slice(i, i + BATCH);
    const payload = chunk.map((to) => ({
      to,
      title: message.title,
      body: message.body,
      sound: "default",
      ...(message.data ? { data: message.data } : {}),
    }));
    try {
      const res = await doFetch(PUSH_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        error = `HTTP ${String(res.status)}`;
        continue;
      }
      const body: unknown = await res.json().catch(() => null);
      const tickets = Array.isArray((body as { data?: unknown } | null)?.data)
        ? (body as { data: unknown[] }).data.filter(isTicket)
        : [];
      if (tickets.length === 0) {
        // A 200 with no ticket array still means Expo accepted the batch.
        sent += chunk.length;
        continue;
      }
      tickets.forEach((ticket, idx) => {
        const token = chunk[idx];
        if (ticket.status === "ok") {
          sent += 1;
          if (ticket.id && token) ticketToToken.set(ticket.id, token);
          return;
        }
        error = ticket.message ?? (errorCodeOf(ticket) || "push rejected");
        if (errorCodeOf(ticket) === DEVICE_GONE && token) dead.push(token);
      });
    } catch (e) {
      error = e instanceof Error ? e.message : "push transport failed";
    }
  }

  if (ticketToToken.size > 0) {
    // Expo fills receipts in asynchronously, so this immediate read usually returns nothing. Record
    // the tickets so the scheduled `push-receipts` sweep can come back for them; without this the
    // sweep has a table to read and nothing writing to it, and a device that goes away is never
    // pruned.
    if (opts.prisma) {
      const rows = [...ticketToToken].map(([ticketId, token]) => ({ ticketId, token }));
      await recordPushTickets(opts.prisma, rows, new Date());
    }
    const gone = await deadTokensFromReceipts(ticketToToken, doFetch);
    dead.push(...gone);
  }

  let pruned = 0;
  if (dead.length > 0 && opts.prisma) pruned = await pruneTokens(opts.prisma, dead);

  return { sent, skipped: false, error, pruned, reason: null };
}

/** Reads delivery receipts for the ticket ids of one send and returns the tokens that are gone. */
async function deadTokensFromReceipts(
  ticketToToken: ReadonlyMap<string, string>,
  doFetch: typeof fetch,
): Promise<string[]> {
  const ids = [...ticketToToken.keys()];
  const dead: string[] = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    try {
      const res = await doFetch(PUSH_RECEIPTS_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ ids: chunk }),
      });
      if (!res.ok) continue;
      const body: unknown = await res.json().catch(() => null);
      const map = (body as { data?: unknown } | null)?.data;
      if (typeof map !== "object" || map === null) continue;
      for (const [ticketId, value] of Object.entries(map as Record<string, unknown>)) {
        if (!isTicket(value)) continue;
        if (value.status !== "error") continue;
        if (errorCodeOf(value) !== DEVICE_GONE) continue;
        const token = ticketToToken.get(ticketId);
        if (token) dead.push(token);
      }
    } catch {
      /* receipts are best effort — a failure here must never fail the send */
    }
  }
  return dead;
}

/* --------------------------------------------------------------------- policy ---- */

/** Locale → IANA timezone. The single assumption quiet hours rest on; see `docs/push.md`. */
export function timezoneForLocale(locale: string): string {
  return locale === "ja" ? "Asia/Tokyo" : pushDefaultTimezone();
}

interface LocalTime {
  hour: number;
  /** YYYY-MM-DD in that timezone — the key the daily cap counts against */
  day: string;
}

export function localTime(now: Date, timeZone: string): LocalTime {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
    }).formatToParts(now);
    const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
    const hour = Number(get("hour"));
    return {
      hour: Number.isFinite(hour) ? hour % 24 : now.getUTCHours(),
      day: `${get("year")}-${get("month")}-${get("day")}`,
    };
  } catch {
    return { hour: now.getUTCHours(), day: now.toISOString().slice(0, 10) };
  }
}

/** 23:00–08:00 by default, and the window is allowed to wrap midnight. */
export function inQuietHours(hour: number, start = pushQuietStartHour(), end = pushQuietEndHour()): boolean {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

interface Counter {
  day: string;
  count: number;
  lastAtMs: number;
}
const counters = new Map<string, Counter>();

/** Test seam — the counters are per-process, so a suite must be able to clear them. */
export function resetPushPolicy(): void {
  counters.clear();
}

export type PushDecision = { send: true } | { send: false; reason: "quiet_hours" | "daily_cap" | "too_soon" };

export interface PolicyOptions {
  /** explicit sends (the digest) skip the gap check — they are the point of the notification */
  respectGap?: boolean;
}

/**
 * Decide, and — when the answer is yes — count the send. Deciding and counting are one step on
 * purpose: two callers racing must not both be told "yes" on the last slot of the day.
 */
export function shouldSend(userId: string, locale: string, now: Date, opts: PolicyOptions = {}): PushDecision {
  const { hour, day } = localTime(now, timezoneForLocale(locale));
  if (inQuietHours(hour)) return { send: false, reason: "quiet_hours" };

  const key = `${userId}:${day}`;
  const counter = counters.get(key) ?? { day, count: 0, lastAtMs: 0 };
  if (counter.count >= pushDailyCap()) return { send: false, reason: "daily_cap" };
  if (
    (opts.respectGap ?? false) &&
    counter.lastAtMs > 0 &&
    now.getTime() - counter.lastAtMs < pushMinGapMinutes() * 60_000
  ) {
    return { send: false, reason: "too_soon" };
  }

  counters.set(key, { day, count: counter.count + 1, lastAtMs: now.getTime() });
  // one stale key per user, dropped on the next day's first send
  for (const [k, v] of counters) if (v.day !== day && k.startsWith(`${userId}:`)) counters.delete(k);
  return { send: true };
}

/* ------------------------------------------------------------------ addressing ---- */

/**
 * The base (non-transactional) Prisma client, registered once by `createApp`. `services/notify.ts`
 * needs a client that is *not* the caller's transaction to be able to push for a notification, and
 * plumbing one through every `notify()` call site would have touched five other agents' files.
 */
let registered: PrismaClient | null = null;
export function setPushClient(prisma: PrismaClient | null): void {
  registered = prisma;
}
export const pushClient = (): PrismaClient | null => registered;

/** Enabled tokens for a user, newest first. */
export async function tokensForUser(prisma: PrismaClient, userId: string): Promise<PushToken[]> {
  return await prisma.pushToken.findMany({ where: { userId, enabled: true }, orderBy: { createdAt: "desc" } });
}

export interface NotifyOptions extends PolicyOptions {
  now?: Date;
  /** skip the locale lookup when the caller already has it */
  locale?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Send to one user, applying the policy. Callers that already decided a push is warranted (the
 * offline director's digest) call this directly; `pushForNotification` is the derived path.
 */
export async function notifyUser(
  prisma: PrismaClient,
  userId: string,
  message: PushMessage,
  opts: NotifyOptions = {},
): Promise<PushResult> {
  if (!pushEnabled()) {
    console.info(`[push] skipped (PUSH_ENABLED != 1): "${message.title}" -> user`);
    return nothing("disabled");
  }
  const now = opts.now ?? new Date();
  const locale =
    opts.locale ??
    (await prisma.user.findUnique({ where: { id: userId }, select: { locale: true } }))?.locale ??
    "en";
  const decision = shouldSend(userId, locale, now, opts);
  if (!decision.send) return nothing(decision.reason);

  const tokens = await tokensForUser(prisma, userId);
  if (tokens.length === 0) return nothing("no_tokens");
  return await sendPush(tokens.map((t) => t.token), message, { prisma, ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}) });
}

/* --------------------------------------------------------- notification bridge ---- */

/**
 * The notification kinds worth waking a phone for. `reply`, `like` and `follow` deliberately are
 * not: they arrive in bursts right after the user's own action, which is exactly the pattern that
 * gets an app muted. `digest` is missing because the offline director sends its own push with a
 * better title — including it here would double up.
 */
export const PUSHABLE_KINDS: readonly NotificationKind[] = ["dm", "event", "milestone"];

export interface NotificationPush {
  personaId: string;
  kind: NotificationKind;
  text: string;
  target: string | null;
}

/** Newest own post / own DM for this persona — "away" is measured from the last thing the user did. */
async function lastUserActionAt(prisma: PrismaClient, personaId: string): Promise<Date | null> {
  const [post, dm] = await Promise.all([
    prisma.post.findFirst({
      where: { personaId, authorCharacterId: null },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.dMMessage.findFirst({
      where: { thread: { personaId }, fromCharacter: false },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  const times = [post?.createdAt, dm?.createdAt].filter((d): d is Date => d instanceof Date);
  if (times.length === 0) return null;
  return times.reduce((a, b) => (a.getTime() > b.getTime() ? a : b));
}

/**
 * Push for a notification row (`services/notify.ts` calls this after writing one).
 *
 * Cheap and silent when push is off — it returns before touching the database — so the vitest and
 * Playwright suites are unaffected. It is intentionally **not** awaited inside the caller's
 * transaction: a network round trip must never hold a Postgres transaction open.
 */
export async function pushForNotification(
  prisma: PrismaClient,
  input: NotificationPush,
  opts: NotifyOptions = {},
): Promise<PushResult> {
  if (!pushEnabled()) return nothing("disabled");
  if (!PUSHABLE_KINDS.includes(input.kind)) return nothing("kind_not_pushable");

  const persona = await prisma.persona.findUnique({
    where: { id: input.personaId },
    select: { id: true, userId: true, displayName: true, user: { select: { locale: true } } },
  });
  if (!persona) return nothing("no_persona");

  const now = opts.now ?? new Date();
  const last = await lastUserActionAt(prisma, persona.id);
  if (last && now.getTime() - last.getTime() < pushAwayMinutes() * 60_000) return nothing("user_present");

  if (input.kind === "dm") {
    // The offline director writes its proactive DM and then sends the digest push; without this the
    // same run would buzz the phone twice.
    const fresh = await prisma.digest.findFirst({
      where: { personaId: persona.id, seenAt: null, createdAt: { gte: new Date(now.getTime() - 5 * 60_000) } },
      select: { id: true },
    });
    if (fresh) return nothing("digest_pending");
  }

  return await notifyUser(
    prisma,
    persona.userId,
    {
      title: persona.displayName,
      body: input.text,
      ...(input.target ? { data: { target: input.target, personaId: persona.id } } : {}),
    },
    { ...opts, now, locale: persona.user.locale, respectGap: true },
  );
}
