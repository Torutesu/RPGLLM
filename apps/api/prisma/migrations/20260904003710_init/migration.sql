-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('en', 'ja');

-- CreateEnum
CREATE TYPE "WorldMode" AS ENUM ('single', 'multi');

-- CreateEnum
CREATE TYPE "PostKind" AS ENUM ('user', 'character', 'news', 'ambient', 'system');

-- CreateEnum
CREATE TYPE "ThreadPartyKind" AS ENUM ('persona', 'character');

-- CreateEnum
CREATE TYPE "LedgerSource" AS ENUM ('daily_refill', 'ad_reward', 'referral', 'purchase', 'plus_daily', 'spend', 'admin');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('energy', 'coffee', 'gems');

-- CreateEnum
CREATE TYPE "SubPlan" AS ENUM ('plus_weekly', 'plus_monthly', 'plus_yearly', 'adfree_monthly');

-- CreateEnum
CREATE TYPE "SafetyVerdict" AS ENUM ('allow', 'soften', 'block');

-- CreateEnum
CREATE TYPE "GeneratorId" AS ENUM ('G1', 'G2', 'G3', 'G4', 'G5', 'G7', 'G8', 'G9', 'G10', 'GJ');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "authProvider" TEXT NOT NULL,
    "authSubject" TEXT NOT NULL,
    "birthYear" INTEGER NOT NULL,
    "isMinor" BOOLEAN NOT NULL DEFAULT true,
    "locale" "Locale" NOT NULL DEFAULT 'en',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Persona" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "bio" TEXT NOT NULL DEFAULT '',
    "avatarUrl" TEXT,
    "voiceNotes" TEXT NOT NULL DEFAULT '',
    "followers" INTEGER NOT NULL DEFAULT 120,
    "aura" INTEGER NOT NULL DEFAULT 20,
    "humor" INTEGER NOT NULL DEFAULT 20,
    "level" INTEGER NOT NULL DEFAULT 1,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "actionCount" INTEGER NOT NULL DEFAULT 0,
    "worldSummary" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Persona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "World" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" JSONB NOT NULL,
    "scenario" JSONB NOT NULL,
    "bible" JSONB NOT NULL,
    "bibleTokens" INTEGER NOT NULL,
    "mode" "WorldMode" NOT NULL DEFAULT 'single',
    "isPreset" BOOLEAN NOT NULL DEFAULT true,
    "difficulty" INTEGER NOT NULL DEFAULT 2,
    "coverUrl" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "World_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorldCharacter" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "card" JSONB NOT NULL,
    "avatarUrl" TEXT,
    "isPressAccount" BOOLEAN NOT NULL DEFAULT false,
    "canBeFirstFollower" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "WorldCharacter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "personaId" TEXT,
    "authorPersonaId" TEXT,
    "authorCharacterId" TEXT,
    "kind" "PostKind" NOT NULL,
    "text" TEXT NOT NULL,
    "parentId" TEXT,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "generationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmbientPost" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "locale" "Locale" NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmbientPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DMThread" (
    "id" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DMThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DMMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "fromCharacter" BOOLEAN NOT NULL,
    "text" TEXT NOT NULL,
    "generationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DMMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "choices" JSONB NOT NULL,
    "chosenId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "generationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatSnapshot" (
    "id" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "cause" TEXT NOT NULL,
    "narrative" TEXT NOT NULL,
    "followersDelta" INTEGER NOT NULL,
    "auraDelta" INTEGER NOT NULL,
    "humorDelta" INTEGER NOT NULL,
    "relDeltas" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelationshipState" (
    "id" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "affinity" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT NOT NULL DEFAULT '',
    "isFollower" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RelationshipState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryEntry" (
    "id" TEXT NOT NULL,
    "relationshipId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "consolidated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "energy" INTEGER NOT NULL DEFAULT 10,
    "coffee" INTEGER NOT NULL DEFAULT 0,
    "gems" INTEGER NOT NULL DEFAULT 0,
    "dailyRefillAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "adRewardsToday" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "delta" INTEGER NOT NULL,
    "source" "LedgerSource" NOT NULL,
    "ref" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "store" TEXT NOT NULL,
    "amountUsd" DECIMAL(8,2) NOT NULL,
    "rcEventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plan" "SubPlan" NOT NULL,
    "active" BOOLEAN NOT NULL,
    "renewsAt" TIMESTAMP(3),
    "rcSubscriberId" TEXT NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "generator" "GeneratorId" NOT NULL,
    "variantId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptHash" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "cacheWriteTokens" INTEGER NOT NULL,
    "cacheReadTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "costUsd" DECIMAL(10,6) NOT NULL,
    "ttftMs" INTEGER,
    "latencyMs" INTEGER NOT NULL,
    "stopReason" TEXT NOT NULL,
    "safetyVerdict" "SafetyVerdict",
    "escalatedFrom" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GenerationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "experimentKey" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExperimentAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rating" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "generationId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "regenerate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_authProvider_authSubject_key" ON "User"("authProvider", "authSubject");

-- CreateIndex
CREATE UNIQUE INDEX "Persona_worldId_handle_key" ON "Persona"("worldId", "handle");

-- CreateIndex
CREATE UNIQUE INDEX "World_slug_key" ON "World"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "WorldCharacter_worldId_handle_key" ON "WorldCharacter"("worldId", "handle");

-- CreateIndex
CREATE INDEX "Post_personaId_createdAt_idx" ON "Post"("personaId", "createdAt");

-- CreateIndex
CREATE INDEX "Post_parentId_idx" ON "Post"("parentId");

-- CreateIndex
CREATE INDEX "AmbientPost_worldId_locale_idx" ON "AmbientPost"("worldId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "DMThread_personaId_characterId_key" ON "DMThread"("personaId", "characterId");

-- CreateIndex
CREATE INDEX "DMMessage_threadId_createdAt_idx" ON "DMMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "Event_personaId_resolvedAt_idx" ON "Event"("personaId", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RelationshipState_personaId_characterId_key" ON "RelationshipState"("personaId", "characterId");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- CreateIndex
CREATE INDEX "LedgerEntry_walletId_createdAt_idx" ON "LedgerEntry"("walletId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_rcEventId_key" ON "Purchase"("rcEventId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");

-- CreateIndex
CREATE INDEX "GenerationLog_generator_variantId_createdAt_idx" ON "GenerationLog"("generator", "variantId", "createdAt");

-- CreateIndex
CREATE INDEX "GenerationLog_userId_createdAt_idx" ON "GenerationLog"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExperimentAssignment_userId_experimentKey_key" ON "ExperimentAssignment"("userId", "experimentKey");

-- AddForeignKey
ALTER TABLE "Persona" ADD CONSTRAINT "Persona_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Persona" ADD CONSTRAINT "Persona_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldCharacter" ADD CONSTRAINT "WorldCharacter_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_authorCharacterId_fkey" FOREIGN KEY ("authorCharacterId") REFERENCES "WorldCharacter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "GenerationLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmbientPost" ADD CONSTRAINT "AmbientPost_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DMThread" ADD CONSTRAINT "DMThread_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DMThread" ADD CONSTRAINT "DMThread_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "WorldCharacter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DMMessage" ADD CONSTRAINT "DMMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "DMThread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatSnapshot" ADD CONSTRAINT "StatSnapshot_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipState" ADD CONSTRAINT "RelationshipState_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipState" ADD CONSTRAINT "RelationshipState_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "WorldCharacter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryEntry" ADD CONSTRAINT "MemoryEntry_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "RelationshipState"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentAssignment" ADD CONSTRAINT "ExperimentAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "GenerationLog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
