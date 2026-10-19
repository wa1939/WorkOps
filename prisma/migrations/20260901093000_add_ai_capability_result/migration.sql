-- CreateTable
CREATE TABLE "AiCapabilityResult" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "state" VARCHAR(64) NOT NULL,
    "outputJson" TEXT,
    "compensatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiCapabilityResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiCapabilityResult_key_key" ON "AiCapabilityResult"("key");

-- CreateIndex
CREATE INDEX "AiCapabilityResult_createdAt_idx" ON "AiCapabilityResult"("createdAt");
