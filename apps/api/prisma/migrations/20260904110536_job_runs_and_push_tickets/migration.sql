-- These two tables were created at runtime by the worker while the schema was frozen, so an
-- already-running deployment has them. IF NOT EXISTS makes this migration a no-op there and a
-- real create everywhere else; from here on Prisma owns them.
-- CreateTable
CREATE TABLE IF NOT EXISTS "JobRun" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "trigger" TEXT NOT NULL DEFAULT 'schedule',
    "host" TEXT,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PushTicket" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "checkedAt" TIMESTAMP(3),

    CONSTRAINT "PushTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "JobRun_job_startedAt_idx" ON "JobRun"("job", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PushTicket_ticketId_key" ON "PushTicket"("ticketId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PushTicket_checkedAt_sentAt_idx" ON "PushTicket"("checkedAt", "sentAt");

