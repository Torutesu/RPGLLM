-- AlterTable: the two things a rejected world's creator and a reviewer were each missing.
--
-- Appeals (WORLD_MODERATION.APPEALS_PER_REJECTION). A rejected world could only wait out the
-- resubmit cooldown and hope for a different reviewer, which is the wrong answer when the reason
-- was simply wrong. `appealsUsed` counts appeals against *the rejection currently standing* — it is
-- reset when a new review cycle starts (a genuine resubmit, an automatic pull, an approval), so
-- "once per rejection" is a per-decision budget rather than a per-world one. `appealMessage` and
-- `appealReason` are what the queue card shows: the creator's case, and the decision it argues with.
ALTER TABLE "World" ADD COLUMN     "appealsUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "appealedAt" TIMESTAMP(3),
ADD COLUMN     "appealMessage" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "appealReason" TEXT NOT NULL DEFAULT '',
-- Review claims: a lease, not a lock. `claimedUntil` in the past *is* an unclaimed world — nothing
-- has to run to release it, so a reviewer who closed their laptop cannot strand a world.
ADD COLUMN     "claimedBy" TEXT,
ADD COLUMN     "claimedUntil" TIMESTAMP(3);
