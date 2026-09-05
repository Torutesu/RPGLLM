-- AlterTable: what happens to a world *after* it is approved (WORLD_MODERATION).
-- `pulledAt` marks a world enough distinct reporters took back off the shelf; `reviewRequestedAt`
-- is when it entered the queue, so the review SLA is measured from the wait and not from creation.
ALTER TABLE "World" ADD COLUMN     "pulledAt" TIMESTAMP(3),
ADD COLUMN     "reviewRequestedAt" TIMESTAMP(3);

-- Worlds already waiting when this shipped have been waiting since they were created.
UPDATE "World" SET "reviewRequestedAt" = "createdAt" WHERE "status" = 'review' AND "reviewRequestedAt" IS NULL;

-- The queue reads `status = 'review'` ordered by how long each row has waited.
CREATE INDEX "World_status_reviewRequestedAt_idx" ON "World"("status", "reviewRequestedAt");
