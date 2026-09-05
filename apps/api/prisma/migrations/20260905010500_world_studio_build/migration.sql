-- AlterTable: World Studio build state (AIF-003)
ALTER TABLE "World" ADD COLUMN     "genre" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "genLocale" "Locale",
ADD COLUMN     "seed" JSONB,
ADD COLUMN     "buildStartedAt" TIMESTAMP(3),
ADD COLUMN     "refundedAt" TIMESTAMP(3);
