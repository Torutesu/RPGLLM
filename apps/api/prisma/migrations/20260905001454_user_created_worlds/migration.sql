-- CreateEnum
CREATE TYPE "WorldStatus" AS ENUM ('draft', 'generating', 'ready', 'review', 'published', 'rejected');

-- CreateEnum
CREATE TYPE "WorldVisibility" AS ENUM ('private', 'unlisted', 'public');

-- AlterTable
ALTER TABLE "World" ADD COLUMN     "failureReason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "generationId" TEXT,
ADD COLUMN     "playCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "premise" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "rejectedReason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedBy" TEXT,
ADD COLUMN     "safety" "SafetyVerdict",
ADD COLUMN     "safetyNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "status" "WorldStatus" NOT NULL DEFAULT 'published',
ADD COLUMN     "visibility" "WorldVisibility" NOT NULL DEFAULT 'private';

-- CreateIndex
CREATE INDEX "World_status_visibility_createdAt_idx" ON "World"("status", "visibility", "createdAt");

-- CreateIndex
CREATE INDEX "World_createdBy_createdAt_idx" ON "World"("createdBy", "createdAt");

-- AddForeignKey
ALTER TABLE "World" ADD CONSTRAINT "World_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

