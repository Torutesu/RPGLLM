/**
 * The second pass over Expo delivery receipts.
 *
 * `sendPush` reads the receipts endpoint immediately after a send, but **Expo fills receipts in
 * asynchronously**: minutes later, sometimes longer. An immediate read therefore usually returns
 * nothing, and a token whose device is gone keeps being pushed to forever (Agent P's own note).
 * This is the scheduled pass that catches the rest: re-read the ticket ids that have had time to
 * settle, delete every token reported `DeviceNotRegistered`, and forget tickets older than Expo's
 * own 24-hour receipt retention.
 *
 * `sendPush` records its ticket ids here as it sends, so this pass has something to read: it waits
 * out `PUSH_RECEIPT_DELAY_MS`, asks Expo about the settled tickets, prunes any token that comes
 * back `DeviceNotRegistered`, and drops tickets older than Expo keeps receipts for.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { envNum } from "../env";
import { logLine } from "../middleware/request-log";
import { BATCH, DEVICE_GONE, PUSH_RECEIPTS_ENDPOINT, pruneTokens, pushEnabled } from "../services/push";
import { shortError } from "./runs";

/** Prisma owns this table now (migration `job_runs_and_push_tickets`); the DDL stays only so a
 * worker started against an older database still comes up. */
const DDL = [
  `CREATE TABLE IF NOT EXISTS "PushTicket" (
     "id" TEXT PRIMARY KEY,
     "ticketId" TEXT NOT NULL UNIQUE,
     "token" TEXT NOT NULL,
     "sentAt" TIMESTAMP(3) NOT NULL,
     "checkedAt" TIMESTAMP(3)
   )`,
  `CREATE INDEX IF NOT EXISTS "PushTicket_checkedAt_sentAt_idx" ON "PushTicket" ("checkedAt", "sentAt")`,
] as const;

const ready = new WeakSet<PrismaClient>();

export async function ensurePushTicketTable(prisma: PrismaClient): Promise<void> {
  if (ready.has(prisma)) return;
  for (const stmt of DDL) await prisma.$executeRawUnsafe(stmt);
  ready.add(prisma);
}

/** How long a ticket has to settle before its receipt is worth reading. */
export const receiptDelayMs = (): number => envNum("PUSH_RECEIPT_DELAY_MS", 15 * 60 * 1000);
/** Expo keeps receipts for about a day; after that a ticket id can only ever 404. */
export const receiptTtlMs = (): number => envNum("PUSH_RECEIPT_TTL_MS", 24 * 60 * 60 * 1000);
/** Ticket ids read per run (Expo's own request cap is 100 ids, so this is `BATCH`-chunked). */
export const receiptsPerRun = (): number => envNum("PUSH_RECEIPTS_PER_RUN", 500);

export interface PushTicketRow {
  ticketId: string;
  token: string;
  sentAt: Date;
}

/** Called by the send path (see the note at the top of this file). Ignores duplicates. */
export async function recordPushTickets(
  prisma: PrismaClient,
  tickets: readonly { ticketId: string; token: string }[],
  now: Date,
): Promise<number> {
  if (tickets.length === 0) return 0;
  await ensurePushTicketTable(prisma);
  let written = 0;
  for (const t of tickets) {
    written += await prisma.$executeRaw`
      INSERT INTO "PushTicket" ("id", "ticketId", "token", "sentAt")
      VALUES (${randomUUID()}, ${t.ticketId}, ${t.token}, ${now})
      ON CONFLICT ("ticketId") DO NOTHING`;
  }
  return written;
}

interface ExpoReceipt {
  status?: unknown;
  details?: { error?: unknown };
}

const goneFrom = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null) return false;
  const receipt = value as ExpoReceipt;
  if (receipt.status !== "error") return false;
  return receipt.details?.error === DEVICE_GONE;
};

export interface ReceiptSweepResult {
  /** ticket ids asked about */
  checked: number;
  /** tokens deleted because the device is gone */
  pruned: number;
  /** ticket rows forgotten (answered, or past Expo's retention) */
  dropped: number;
}

/**
 * Re-reads settled receipts and prunes the dead devices. Never throws: a push provider being down
 * must not fail the job that runs it.
 */
export async function sweepPushReceipts(
  prisma: PrismaClient,
  now: Date,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<ReceiptSweepResult> {
  await ensurePushTicketTable(prisma);
  const result: ReceiptSweepResult = { checked: 0, pruned: 0, dropped: 0 };

  // Expired tickets go whether or not push is on: they can never be answered again.
  result.dropped += await prisma.$executeRaw`
    DELETE FROM "PushTicket" WHERE "sentAt" < ${new Date(now.getTime() - receiptTtlMs())}`;
  if (!pushEnabled()) return result;

  const due = await prisma.$queryRaw<PushTicketRow[]>`
    SELECT "ticketId", "token", "sentAt" FROM "PushTicket"
     WHERE "checkedAt" IS NULL AND "sentAt" <= ${new Date(now.getTime() - receiptDelayMs())}
     ORDER BY "sentAt" ASC
     LIMIT ${receiptsPerRun()}`;
  if (due.length === 0) return result;

  const doFetch = opts.fetchImpl ?? fetch;
  const byTicket = new Map(due.map((row) => [row.ticketId, row.token]));
  const dead: string[] = [];
  const answered: string[] = [];

  for (let i = 0; i < due.length; i += BATCH) {
    const chunk = due.slice(i, i + BATCH).map((row) => row.ticketId);
    try {
      const res = await doFetch(PUSH_RECEIPTS_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ ids: chunk }),
      });
      result.checked += chunk.length;
      if (!res.ok) continue;
      const body: unknown = await res.json().catch(() => null);
      const map = (body as { data?: unknown } | null)?.data;
      if (typeof map !== "object" || map === null) continue;
      for (const [ticketId, value] of Object.entries(map as Record<string, unknown>)) {
        answered.push(ticketId);
        const token = byTicket.get(ticketId);
        if (token && goneFrom(value)) dead.push(token);
      }
    } catch (err: unknown) {
      // Receipts are best effort; leave the rows unchecked and try again next run.
      logLine({ level: "warn", msg: "push.receipts.failed", error: shortError(err) });
    }
  }

  if (dead.length > 0) result.pruned = await pruneTokens(prisma, [...new Set(dead)]);
  if (answered.length > 0) {
    // A list parameter, not an interpolated string: `= ANY($1::text[])` keeps it one bind.
    result.dropped += await prisma.$executeRawUnsafe(
      `DELETE FROM "PushTicket" WHERE "ticketId" = ANY($1::text[])`,
      answered,
    );
  }
  return result;
}
