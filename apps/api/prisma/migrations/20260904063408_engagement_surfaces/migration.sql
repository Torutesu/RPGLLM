-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('like', 'reply', 'follow', 'mention', 'dm', 'milestone', 'event', 'digest', 'unlock');

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "heat" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "mediaKind" TEXT,
ADD COLUMN     "mediaSeed" TEXT;

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "actorId" TEXT,
    "target" TEXT,
    "text" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AchievementUnlock" (
    "id" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "seenAt" TIMESTAMP(3),
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AchievementUnlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_personaId_readAt_idx" ON "Notification"("personaId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_personaId_createdAt_idx" ON "Notification"("personaId", "createdAt");

-- CreateIndex
CREATE INDEX "AchievementUnlock_personaId_unlockedAt_idx" ON "AchievementUnlock"("personaId", "unlockedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AchievementUnlock_personaId_key_key" ON "AchievementUnlock"("personaId", "key");

-- CreateIndex
CREATE INDEX "Post_personaId_heat_idx" ON "Post"("personaId", "heat");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "WorldCharacter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AchievementUnlock" ADD CONSTRAINT "AchievementUnlock_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

