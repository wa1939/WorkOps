-- CreateEnum
CREATE TYPE "AiMemoryState" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'ARCHIVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "AiMemoryScope" AS ENUM ('USER', 'TEAM', 'DEPARTMENT', 'WORKSPACE');

-- CreateEnum
CREATE TYPE "AiMemoryKind" AS ENUM ('PREFERENCE', 'FACT', 'DECISION', 'TERMINOLOGY', 'RELATIONSHIP', 'LESSON');

-- CreateEnum
CREATE TYPE "AiMemoryProvenance" AS ENUM ('GENERATED', 'USER_PROVIDED', 'IMPORTED', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AiMemoryFreshness" AS ENUM ('FRESH', 'AGING', 'STALE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AiPlaybookState" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AiFeedbackOutcome" AS ENUM ('ACCEPTED', 'EDITED', 'REJECTED', 'IGNORED', 'UNDONE', 'CORRECTED');

-- CreateTable
CREATE TABLE "AiMemory" (
    "id" TEXT NOT NULL,
    "scope" "AiMemoryScope" NOT NULL,
    "kind" "AiMemoryKind" NOT NULL,
    "state" "AiMemoryState" NOT NULL DEFAULT 'PROPOSED',
    "content" TEXT NOT NULL,
    "provenance" "AiMemoryProvenance" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "freshness" "AiMemoryFreshness" NOT NULL DEFAULT 'FRESH',
    "expiresAt" TIMESTAMP(3),
    "supersededById" TEXT,
    "ownerId" TEXT,
    "departmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMemorySource" (
    "id" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "locatorJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMemorySource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiPlaybook" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "scope" "AiMemoryScope" NOT NULL,
    "state" "AiPlaybookState" NOT NULL DEFAULT 'DRAFT',
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiPlaybook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiPlaybookVersion" (
    "id" TEXT NOT NULL,
    "playbookId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "normalizedInstructions" TEXT NOT NULL,
    "triggerRulesJson" TEXT NOT NULL,
    "contextRequirementsJson" TEXT NOT NULL,
    "capabilityAllowlistJson" TEXT NOT NULL,
    "approvalOverridesJson" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiPlaybookVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiPlaybookEvaluation" (
    "id" TEXT NOT NULL,
    "playbookVersionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "resultJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiPlaybookEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiFeedback" (
    "id" TEXT NOT NULL,
    "outcome" "AiFeedbackOutcome" NOT NULL,
    "contextJson" TEXT NOT NULL,
    "proposedDiffHash" TEXT,
    "finalDiffHash" TEXT,
    "workflowId" TEXT,
    "approvalId" TEXT,
    "conversationId" TEXT,
    "messageId" TEXT,
    "sourceId" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiConversationSummary" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "startMessageId" TEXT NOT NULL,
    "endMessageId" TEXT NOT NULL,
    "protectedStateJson" TEXT NOT NULL,
    "sourceMessageIdsJson" TEXT NOT NULL,
    "supersededById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiConversationSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiKnowledgeChunk" (
    "id" TEXT NOT NULL,
    "entityType" VARCHAR(64) NOT NULL,
    "entityId" VARCHAR(128) NOT NULL,
    "chunkKind" VARCHAR(64) NOT NULL,
    "text" VARCHAR(12000) NOT NULL,
    "normalizedText" VARCHAR(12000) NOT NULL,
    "checksum" VARCHAR(128) NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "visibilityClass" VARCHAR(64) NOT NULL,
    "staleAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiKnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiEntityFingerprint" (
    "id" TEXT NOT NULL,
    "entityType" VARCHAR(64) NOT NULL,
    "entityId" VARCHAR(128) NOT NULL,
    "kind" VARCHAR(64) NOT NULL,
    "fingerprint" VARCHAR(128) NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "staleAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiEntityFingerprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiEmbeddingVector" (
    "id" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "providerKey" VARCHAR(64) NOT NULL,
    "modelName" VARCHAR(128) NOT NULL,
    "dimension" INTEGER NOT NULL,
    "vectorJson" VARCHAR(12000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiEmbeddingVector_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiMemory_scope_state_freshness_idx" ON "AiMemory"("scope", "state", "freshness");

-- CreateIndex
CREATE INDEX "AiMemory_ownerId_idx" ON "AiMemory"("ownerId");

-- CreateIndex
CREATE INDEX "AiMemory_departmentId_idx" ON "AiMemory"("departmentId");

-- CreateIndex
CREATE INDEX "AiMemorySource_sourceType_sourceId_idx" ON "AiMemorySource"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "AiMemorySource_memoryId_sourceType_sourceId_key" ON "AiMemorySource"("memoryId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "AiPlaybook_ownerId_state_idx" ON "AiPlaybook"("ownerId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "AiPlaybookVersion_playbookId_version_key" ON "AiPlaybookVersion"("playbookId", "version");

-- CreateIndex
CREATE INDEX "AiPlaybookEvaluation_playbookVersionId_status_idx" ON "AiPlaybookEvaluation"("playbookVersionId", "status");

-- CreateIndex
CREATE INDEX "AiFeedback_outcome_createdAt_idx" ON "AiFeedback"("outcome", "createdAt");

-- CreateIndex
CREATE INDEX "AiFeedback_conversationId_createdAt_idx" ON "AiFeedback"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiConversationSummary_conversationId_version_key" ON "AiConversationSummary"("conversationId", "version");

-- CreateIndex
CREATE INDEX "AiKnowledgeChunk_entityType_entityId_idx" ON "AiKnowledgeChunk"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AiKnowledgeChunk_sourceUpdatedAt_idx" ON "AiKnowledgeChunk"("sourceUpdatedAt");

-- CreateIndex
CREATE INDEX "AiKnowledgeChunk_visibilityClass_staleAt_deletedAt_idx" ON "AiKnowledgeChunk"("visibilityClass", "staleAt", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiKnowledgeChunk_entityType_entityId_chunkKind_key" ON "AiKnowledgeChunk"("entityType", "entityId", "chunkKind");

-- CreateIndex
CREATE INDEX "AiEntityFingerprint_fingerprint_idx" ON "AiEntityFingerprint"("fingerprint");

-- CreateIndex
CREATE INDEX "AiEntityFingerprint_entityType_entityId_idx" ON "AiEntityFingerprint"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AiEntityFingerprint_sourceUpdatedAt_idx" ON "AiEntityFingerprint"("sourceUpdatedAt");

-- CreateIndex
CREATE INDEX "AiEntityFingerprint_staleAt_deletedAt_idx" ON "AiEntityFingerprint"("staleAt", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiEntityFingerprint_entityType_entityId_kind_key" ON "AiEntityFingerprint"("entityType", "entityId", "kind");

-- CreateIndex
CREATE INDEX "AiEmbeddingVector_chunkId_idx" ON "AiEmbeddingVector"("chunkId");

-- CreateIndex
CREATE INDEX "AiEmbeddingVector_providerKey_modelName_idx" ON "AiEmbeddingVector"("providerKey", "modelName");

-- CreateIndex
CREATE UNIQUE INDEX "AiEmbeddingVector_chunkId_providerKey_modelName_key" ON "AiEmbeddingVector"("chunkId", "providerKey", "modelName");

-- AddForeignKey
ALTER TABLE "AiMemory" ADD CONSTRAINT "AiMemory_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMemory" ADD CONSTRAINT "AiMemory_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMemory" ADD CONSTRAINT "AiMemory_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "AiMemory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMemorySource" ADD CONSTRAINT "AiMemorySource_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "AiMemory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPlaybook" ADD CONSTRAINT "AiPlaybook_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPlaybookVersion" ADD CONSTRAINT "AiPlaybookVersion_playbookId_fkey" FOREIGN KEY ("playbookId") REFERENCES "AiPlaybook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPlaybookEvaluation" ADD CONSTRAINT "AiPlaybookEvaluation_playbookVersionId_fkey" FOREIGN KEY ("playbookVersionId") REFERENCES "AiPlaybookVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiFeedback" ADD CONSTRAINT "AiFeedback_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "AiWorkflow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiFeedback" ADD CONSTRAINT "AiFeedback_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "AiApproval"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiFeedback" ADD CONSTRAINT "AiFeedback_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiFeedback" ADD CONSTRAINT "AiFeedback_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AiMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiFeedback" ADD CONSTRAINT "AiFeedback_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "AiMemorySource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiFeedback" ADD CONSTRAINT "AiFeedback_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConversationSummary" ADD CONSTRAINT "AiConversationSummary_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConversationSummary" ADD CONSTRAINT "AiConversationSummary_startMessageId_fkey" FOREIGN KEY ("startMessageId") REFERENCES "AiMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConversationSummary" ADD CONSTRAINT "AiConversationSummary_endMessageId_fkey" FOREIGN KEY ("endMessageId") REFERENCES "AiMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConversationSummary" ADD CONSTRAINT "AiConversationSummary_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "AiConversationSummary"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiEmbeddingVector" ADD CONSTRAINT "AiEmbeddingVector_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "AiKnowledgeChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;
