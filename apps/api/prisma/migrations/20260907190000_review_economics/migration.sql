-- gtm.md §2 — the three exits out of "$5.00 of human time per public world".

-- AlterTable: Exit 2 lives on the creator, not on the world.
ALTER TABLE "User" ADD COLUMN     "trustApprovals" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "trustSubmissions" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "trustResetAt" TIMESTAMP(3);

-- AlterTable: Exit 1 (the standing charge, so it can be refunded exactly once),
-- Exit 3 (the digest, computed once at submission), Exit 2's measurable half.
ALTER TABLE "World" ADD COLUMN     "publishChargeGems" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "publishSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "reviewDigest" JSONB,
ADD COLUMN     "reviewDigestAt" TIMESTAMP(3),
ADD COLUMN     "sampledAwayAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "World_sampledAwayAt_idx" ON "World"("sampledAwayAt");
