-- CreateEnum
CREATE TYPE "AiJobStatus" AS ENUM ('QUEUED', 'LEASED', 'RUNNING', 'WAITING_APPROVAL', 'RETRY_WAIT', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "AiJobType" AS ENUM ('WORKFLOW_STEP', 'COMPRESSION', 'INDEX_ENTITY', 'MONITOR', 'CONNECTOR_DELIVERY', 'SPECIALIST_ANALYSIS', 'EXTRACTION');

-- CreateEnum
CREATE TYPE "AiJobAttemptStatus" AS ENUM ('LEASED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "AiMonitorStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ERROR');

-- CreateEnum
CREATE TYPE "AiSuggestionState" AS ENUM ('OPEN', 'SNOOZED', 'DISMISSED', 'ACCEPTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AiSuggestionSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AiConnectorDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'BIDIRECTIONAL');

-- CreateEnum
CREATE TYPE "AiWebhookDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'RETRY_WAIT', 'CANCELED');

-- CreateTable
CREATE TABLE "AiJob" (
    "id" TEXT NOT NULL,
    "type" "AiJobType" NOT NULL,
    "status" "AiJobStatus" NOT NULL DEFAULT 'QUEUED',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "idempotencyKey" VARCHAR(255) NOT NULL,
    "actorId" TEXT,
    "workflowId" TEXT,
    "stepId" TEXT,
    "payloadJson" TEXT,
    "checkpointJson" TEXT,
    "leaseOwner" VARCHAR(255),
    "leaseToken" VARCHAR(255),
    "leaseUntil" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "nextAttemptAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "resultJson" TEXT,
    "errorJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiJobAttempt" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "workerId" VARCHAR(255),
    "leaseToken" VARCHAR(255),
    "leasedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "status" "AiJobAttemptStatus" NOT NULL,
    "checkpointJson" TEXT,
    "resultJson" TEXT,
    "errorJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiJobAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMonitor" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "schedule" VARCHAR(255) NOT NULL,
    "scope" "AiMemoryScope" NOT NULL,
    "definitionJson" TEXT NOT NULL,
    "createdById" TEXT,
    "status" "AiMonitorStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiMonitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMonitorState" (
    "id" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "sourceFingerprint" VARCHAR(255),
    "nextRunAt" TIMESTAMP(3),
    "lastError" VARCHAR(2000),

    CONSTRAINT "AiMonitorState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSuggestion" (
    "id" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "fingerprint" VARCHAR(255) NOT NULL,
    "severity" "AiSuggestionSeverity" NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "summary" VARCHAR(4000) NOT NULL,
    "evidenceJson" TEXT NOT NULL,
    "state" "AiSuggestionState" NOT NULL DEFAULT 'OPEN',
    "snoozedUntil" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "cooldownUntil" TIMESTAMP(3),
    "actorId" TEXT,
    "scope" "AiMemoryScope" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiConnector" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" VARCHAR(128) NOT NULL,
    "direction" "AiConnectorDirection" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "eventType" VARCHAR(255) NOT NULL,
    "capability" VARCHAR(255) NOT NULL,
    "dataPolicy" VARCHAR(2000) NOT NULL,
    "configJson" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConnector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiConnectorCredential" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "encryptedValue" TEXT NOT NULL,
    "iv" VARCHAR(255) NOT NULL,
    "authTag" VARCHAR(255) NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConnectorCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiWebhookDelivery" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "eventType" VARCHAR(255) NOT NULL,
    "replayKey" VARCHAR(255) NOT NULL,
    "correlationId" VARCHAR(255),
    "payloadHash" VARCHAR(255) NOT NULL,
    "requestHash" VARCHAR(255),
    "responseHash" VARCHAR(255),
    "status" "AiWebhookDeliveryStatus" NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "errorMessage" VARCHAR(2000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "AiWebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiJob_idempotencyKey_key" ON "AiJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AiJob_actorId_status_idx" ON "AiJob"("actorId", "status");

-- CreateIndex
CREATE INDEX "AiJob_status_leaseUntil_idx" ON "AiJob"("status", "leaseUntil");

-- CreateIndex
CREATE INDEX "AiJob_status_nextAttemptAt_idx" ON "AiJob"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "AiJobAttempt_status_leasedAt_idx" ON "AiJobAttempt"("status", "leasedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiJobAttempt_jobId_attemptNumber_key" ON "AiJobAttempt"("jobId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AiMonitor_key_key" ON "AiMonitor"("key");

-- CreateIndex
CREATE INDEX "AiMonitor_enabled_status_idx" ON "AiMonitor"("enabled", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AiMonitorState_monitorId_key" ON "AiMonitorState"("monitorId");

-- CreateIndex
CREATE INDEX "AiMonitorState_nextRunAt_idx" ON "AiMonitorState"("nextRunAt");

-- CreateIndex
CREATE INDEX "AiSuggestion_state_fingerprint_idx" ON "AiSuggestion"("state", "fingerprint");

-- CreateIndex
CREATE INDEX "AiSuggestion_actorId_scope_idx" ON "AiSuggestion"("actorId", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "AiSuggestion_monitorId_fingerprint_key" ON "AiSuggestion"("monitorId", "fingerprint");

-- CreateIndex
CREATE INDEX "AiConnector_enabled_idx" ON "AiConnector"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "AiConnector_key_version_key" ON "AiConnector"("key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AiConnectorCredential_connectorId_key" ON "AiConnectorCredential"("connectorId");

-- CreateIndex
CREATE INDEX "AiWebhookDelivery_status_nextAttemptAt_idx" ON "AiWebhookDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "AiWebhookDelivery_replayKey_idx" ON "AiWebhookDelivery"("replayKey");

-- CreateIndex
CREATE UNIQUE INDEX "AiWebhookDelivery_connectorId_replayKey_key" ON "AiWebhookDelivery"("connectorId", "replayKey");

-- AddForeignKey
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "AiWorkflow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "AiWorkflowStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiJobAttempt" ADD CONSTRAINT "AiJobAttempt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AiJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMonitor" ADD CONSTRAINT "AiMonitor_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMonitorState" ADD CONSTRAINT "AiMonitorState_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "AiMonitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "AiMonitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConnector" ADD CONSTRAINT "AiConnector_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConnectorCredential" ADD CONSTRAINT "AiConnectorCredential_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "AiConnector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiWebhookDelivery" ADD CONSTRAINT "AiWebhookDelivery_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "AiConnector"("id") ON DELETE CASCADE ON UPDATE CASCADE;
