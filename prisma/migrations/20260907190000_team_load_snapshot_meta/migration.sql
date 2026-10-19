-- Additive only: snapshot metadata and durable run ledger.
ALTER TABLE "TeamLoadSnapshot" ADD COLUMN     "backlogCount" INTEGER,
ADD COLUMN     "calendarVersion" TEXT,
ADD COLUMN     "confidence" DOUBLE PRECISION,
ADD COLUMN     "inputVersion" TEXT,
ADD COLUMN     "unknownTaskCount" INTEGER;

CREATE TABLE "TeamLoadRun" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "inputVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "leaseUntil" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "TeamLoadRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TeamLoadRun_scope_status_idx" ON "TeamLoadRun"("scope", "status");
