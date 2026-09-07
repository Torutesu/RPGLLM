-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'world_played';
ALTER TYPE "NotificationKind" ADD VALUE 'world_ready';
ALTER TYPE "NotificationKind" ADD VALUE 'world_reviewed';
ALTER TYPE "NotificationKind" ADD VALUE 'world_pulled';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "userId" TEXT,
ALTER COLUMN "personaId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "creatorHandleRenamedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "World" ADD COLUMN     "playsNotified" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "remixCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "remixOfId" TEXT;

-- CreateTable
CREATE TABLE "CreatorHandleRelease" (
    "handle" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "releasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorHandleRelease_pkey" PRIMARY KEY ("handle")
);

-- CreateIndex
CREATE INDEX "CreatorHandleRelease_userId_idx" ON "CreatorHandleRelease"("userId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "World_remixOfId_idx" ON "World"("remixOfId");

-- AddForeignKey
ALTER TABLE "World" ADD CONSTRAINT "World_remixOfId_fkey" FOREIGN KEY ("remixOfId") REFERENCES "World"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorHandleRelease" ADD CONSTRAINT "CreatorHandleRelease_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

