-- CreateEnum
CREATE TYPE "AiProcessingMode" AS ENUM ('LOCAL_ONLY', 'LOCAL_PREFERRED', 'CLOUD_QUALITY');

-- CreateEnum
CREATE TYPE "AiSourceBlockKind" AS ENUM ('TEXT', 'TABLE', 'FORMULA', 'IMAGE_CAPTION', 'TRANSCRIPT');

-- CreateEnum
CREATE TYPE "AiExtractionStatus" AS ENUM ('SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "AiProcessingConsentDecision" AS ENUM ('APPROVED', 'DENIED');

-- CreateTable
CREATE TABLE "AiAsset" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteCount" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "storageKey" TEXT,
    "retentionUntil" TIMESTAMP(3),
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSourceBlock" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "kind" "AiSourceBlockKind" NOT NULL,
    "text" TEXT NOT NULL,
    "layoutJson" TEXT,
    "page" INTEGER,
    "timeStartMs" INTEGER,
    "timeEndMs" INTEGER,
    "boundingBoxJson" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "engine" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSourceBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiExtractionRun" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "actorId" TEXT,
    "requestedMode" "AiProcessingMode" NOT NULL,
    "effectiveMode" "AiProcessingMode" NOT NULL,
    "engine" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "metricsJson" TEXT NOT NULL,
    "status" "AiExtractionStatus" NOT NULL,
    "errorCode" TEXT,
    "consentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AiExtractionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiProcessingConsent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "assetChecksum" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decision" "AiProcessingConsentDecision" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProcessingConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiAsset_ownerId_createdAt_idx" ON "AiAsset"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "AiAsset_checksum_idx" ON "AiAsset"("checksum");

-- CreateIndex
CREATE INDEX "AiSourceBlock_assetId_page_idx" ON "AiSourceBlock"("assetId", "page");

-- CreateIndex
CREATE INDEX "AiSourceBlock_assetId_reviewed_idx" ON "AiSourceBlock"("assetId", "reviewed");

-- CreateIndex
CREATE INDEX "AiExtractionRun_assetId_createdAt_idx" ON "AiExtractionRun"("assetId", "createdAt");

-- CreateIndex
CREATE INDEX "AiExtractionRun_actorId_createdAt_idx" ON "AiExtractionRun"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AiExtractionRun_status_createdAt_idx" ON "AiExtractionRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AiProcessingConsent_actorId_createdAt_idx" ON "AiProcessingConsent"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AiProcessingConsent_assetChecksum_provider_idx" ON "AiProcessingConsent"("assetChecksum", "provider");

-- CreateIndex
CREATE INDEX "AiProcessingConsent_expiresAt_decision_idx" ON "AiProcessingConsent"("expiresAt", "decision");

-- AddForeignKey
ALTER TABLE "AiAsset" ADD CONSTRAINT "AiAsset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSourceBlock" ADD CONSTRAINT "AiSourceBlock_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "AiAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiExtractionRun" ADD CONSTRAINT "AiExtractionRun_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "AiAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiExtractionRun" ADD CONSTRAINT "AiExtractionRun_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiExtractionRun" ADD CONSTRAINT "AiExtractionRun_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "AiProcessingConsent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiProcessingConsent" ADD CONSTRAINT "AiProcessingConsent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
