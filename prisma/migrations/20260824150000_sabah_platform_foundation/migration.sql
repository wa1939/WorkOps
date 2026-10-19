-- CreateEnum
CREATE TYPE "AiWorkflowStatus" AS ENUM ('PLANNED', 'AWAITING_APPROVAL', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "AiWorkflowStepStatus" AS ENUM ('PENDING', 'APPROVAL_REQUIRED', 'RUNNING', 'VERIFIED', 'FAILED', 'BLOCKED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AiApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AiProviderKind" AS ENUM ('LOCAL', 'CLOUD');

-- CreateEnum
CREATE TYPE "AiModelRole" AS ENUM ('CHAT', 'PLANNER', 'CRITIC', 'COMPRESSION', 'VISION', 'OCR', 'ASR', 'EMBEDDING');

-- CreateTable
CREATE TABLE "AiWorkflow" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "recordVersion" INTEGER NOT NULL DEFAULT 1,
    "goal" TEXT NOT NULL,
    "status" "AiWorkflowStatus" NOT NULL DEFAULT 'PLANNED',
    "parentWorkflowId" TEXT,
    "actorId" TEXT,
    "conversationId" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AiWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiWorkflowStep" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "clientStepId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "capabilityVersion" INTEGER,
    "status" "AiWorkflowStepStatus" NOT NULL DEFAULT 'PENDING',
    "argsJson" TEXT NOT NULL,
    "previewJson" TEXT,
    "outputJson" TEXT,
    "errorJson" TEXT,
    "dependsOnJson" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "inferredFieldsJson" TEXT,
    "evidenceRefsJson" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AiWorkflowStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiWorkflowEvent" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "stepId" TEXT,
    "eventType" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiWorkflowEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiApproval" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "stepId" TEXT,
    "status" "AiApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "risk" TEXT NOT NULL,
    "fieldsJson" TEXT,
    "warningsJson" TEXT,
    "requestedById" TEXT,
    "decidedById" TEXT,
    "decisionType" TEXT,
    "decisionReason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "AiApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiOperationalLog" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "metadataJson" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiOperationalLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiProviderCredential" (
    "id" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "encryptedValue" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProviderCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiModelAssignment" (
    "id" TEXT NOT NULL,
    "role" "AiModelRole" NOT NULL,
    "providerKey" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "configJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiModelAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiWorkflow_idempotencyKey_key" ON "AiWorkflow"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "AiWorkflow_correlationId_key" ON "AiWorkflow"("correlationId");

-- CreateIndex
CREATE INDEX "AiWorkflow_actorId_status_idx" ON "AiWorkflow"("actorId", "status");

-- CreateIndex
CREATE INDEX "AiWorkflow_status_createdAt_idx" ON "AiWorkflow"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AiWorkflow_correlationId_idx" ON "AiWorkflow"("correlationId");

-- CreateIndex
CREATE INDEX "AiWorkflow_parentWorkflowId_idx" ON "AiWorkflow"("parentWorkflowId");

-- CreateIndex
CREATE INDEX "AiWorkflowStep_workflowId_status_idx" ON "AiWorkflowStep"("workflowId", "status");

-- CreateIndex
CREATE INDEX "AiWorkflowStep_clientStepId_idx" ON "AiWorkflowStep"("clientStepId");

-- CreateIndex
CREATE UNIQUE INDEX "AiWorkflowStep_workflowId_clientStepId_key" ON "AiWorkflowStep"("workflowId", "clientStepId");

-- CreateIndex
CREATE INDEX "AiWorkflowEvent_workflowId_createdAt_idx" ON "AiWorkflowEvent"("workflowId", "createdAt");

-- CreateIndex
CREATE INDEX "AiWorkflowEvent_stepId_createdAt_idx" ON "AiWorkflowEvent"("stepId", "createdAt");

-- CreateIndex
CREATE INDEX "AiWorkflowEvent_eventType_idx" ON "AiWorkflowEvent"("eventType");

-- CreateIndex
CREATE INDEX "AiWorkflowEvent_createdAt_idx" ON "AiWorkflowEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AiApproval_workflowId_status_idx" ON "AiApproval"("workflowId", "status");

-- CreateIndex
CREATE INDEX "AiApproval_stepId_status_idx" ON "AiApproval"("stepId", "status");

-- CreateIndex
CREATE INDEX "AiApproval_requestedById_status_idx" ON "AiApproval"("requestedById", "status");

-- CreateIndex
CREATE INDEX "AiApproval_decidedById_status_idx" ON "AiApproval"("decidedById", "status");

-- CreateIndex
CREATE INDEX "AiApproval_expiresAt_idx" ON "AiApproval"("expiresAt");

-- CreateIndex
CREATE INDEX "AiOperationalLog_workflowId_category_idx" ON "AiOperationalLog"("workflowId", "category");

-- CreateIndex
CREATE INDEX "AiOperationalLog_level_createdAt_idx" ON "AiOperationalLog"("level", "createdAt");

-- CreateIndex
CREATE INDEX "AiOperationalLog_expiresAt_idx" ON "AiOperationalLog"("expiresAt");

-- CreateIndex
CREATE INDEX "AiOperationalLog_createdAt_idx" ON "AiOperationalLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiProviderCredential_providerKey_key" ON "AiProviderCredential"("providerKey");

-- CreateIndex
CREATE INDEX "AiProviderCredential_providerKey_idx" ON "AiProviderCredential"("providerKey");

-- CreateIndex
CREATE INDEX "AiProviderCredential_isEnabled_idx" ON "AiProviderCredential"("isEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "AiModelAssignment_role_key" ON "AiModelAssignment"("role");

-- CreateIndex
CREATE INDEX "AiModelAssignment_providerKey_idx" ON "AiModelAssignment"("providerKey");

-- AddForeignKey
ALTER TABLE "AiWorkflow" ADD CONSTRAINT "AiWorkflow_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiWorkflowStep" ADD CONSTRAINT "AiWorkflowStep_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "AiWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiWorkflowEvent" ADD CONSTRAINT "AiWorkflowEvent_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "AiWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiWorkflowEvent" ADD CONSTRAINT "AiWorkflowEvent_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "AiWorkflowStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiApproval" ADD CONSTRAINT "AiApproval_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "AiWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiApproval" ADD CONSTRAINT "AiApproval_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "AiWorkflowStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiApproval" ADD CONSTRAINT "AiApproval_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiApproval" ADD CONSTRAINT "AiApproval_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiOperationalLog" ADD CONSTRAINT "AiOperationalLog_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "AiWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddColumn (correlationId for correlation-searchable operational logs)
ALTER TABLE "AiOperationalLog" ADD COLUMN "correlationId" TEXT NOT NULL DEFAULT '';

-- CreateIndex (correlationId for correlation-searchable operational logs)
CREATE INDEX "AiOperationalLog_correlationId_idx" ON "AiOperationalLog"("correlationId");

