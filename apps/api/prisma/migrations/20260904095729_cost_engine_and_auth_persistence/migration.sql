-- CreateEnum
CREATE TYPE "EvalStatus" AS ENUM ('running', 'finished', 'failed');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "streakBestDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "streakDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "streakLastAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LoginCode" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "salt" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BanditArm" (
    "id" TEXT NOT NULL,
    "generator" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "alpha" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "beta" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "rewardSum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costSum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isChampion" BOOLEAN NOT NULL DEFAULT false,
    "floor" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "disabledAt" TIMESTAMP(3),
    "disabledReason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BanditArm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionEvent" (
    "id" TEXT NOT NULL,
    "generator" TEXT NOT NULL,
    "fromVariant" TEXT,
    "toVariant" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromotionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalCase" (
    "id" TEXT NOT NULL,
    "generator" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "worldSlug" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "frozen" BOOLEAN NOT NULL DEFAULT true,
    "label" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvalCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalRun" (
    "id" TEXT NOT NULL,
    "generator" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "status" "EvalStatus" NOT NULL DEFAULT 'running',
    "cases" INTEGER NOT NULL DEFAULT 0,
    "passed" INTEGER NOT NULL DEFAULT 0,
    "meanScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "EvalRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "scores" JSONB NOT NULL DEFAULT '{}',
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "costUsd" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvalResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoginCode_email_createdAt_idx" ON "LoginCode"("email", "createdAt");

-- CreateIndex
CREATE INDEX "LoginCode_expiresAt_idx" ON "LoginCode"("expiresAt");

-- CreateIndex
CREATE INDEX "BanditArm_generator_isChampion_idx" ON "BanditArm"("generator", "isChampion");

-- CreateIndex
CREATE UNIQUE INDEX "BanditArm_generator_variantId_key" ON "BanditArm"("generator", "variantId");

-- CreateIndex
CREATE INDEX "PromotionEvent_generator_createdAt_idx" ON "PromotionEvent"("generator", "createdAt");

-- CreateIndex
CREATE INDEX "EvalCase_generator_locale_idx" ON "EvalCase"("generator", "locale");

-- CreateIndex
CREATE INDEX "EvalRun_generator_startedAt_idx" ON "EvalRun"("generator", "startedAt");

-- CreateIndex
CREATE INDEX "EvalResult_runId_idx" ON "EvalResult"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "EvalResult_runId_caseId_key" ON "EvalResult"("runId", "caseId");

-- AddForeignKey
ALTER TABLE "EvalResult" ADD CONSTRAINT "EvalResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "EvalRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvalResult" ADD CONSTRAINT "EvalResult_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "EvalCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

