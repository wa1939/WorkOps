-- CreateEnum
CREATE TYPE "ProjectSponsorStatus" AS ENUM ('NOT_REQUIRED', 'DRAFT', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProjectHealth" AS ENUM ('NOT_SET', 'ON_TRACK', 'AT_RISK', 'OFF_TRACK');

-- CreateEnum
CREATE TYPE "ProjectOutputStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'DELIVERED', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "ProjectRiskStatus" AS ENUM ('OPEN', 'MITIGATING', 'CLOSED');

-- CreateEnum
CREATE TYPE "ProjectStageStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETE', 'BLOCKED');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "health" "ProjectHealth" NOT NULL DEFAULT 'NOT_SET',
ADD COLUMN     "managerId" TEXT,
ADD COLUMN     "metadataJson" TEXT,
ADD COLUMN     "objective" TEXT,
ADD COLUMN     "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "projectType" TEXT,
ADD COLUMN     "responsibleDepartmentId" TEXT,
ADD COLUMN     "scope" TEXT,
ADD COLUMN     "sponsorId" TEXT,
ADD COLUMN     "sponsorStatus" "ProjectSponsorStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN     "successCriteria" TEXT;

-- AlterTable
ALTER TABLE "ProjectStage" ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "gateCriteria" TEXT,
ADD COLUMN     "startAt" TIMESTAMP(3),
ADD COLUMN     "status" "ProjectStageStatus" NOT NULL DEFAULT 'PLANNED';

-- CreateTable
CREATE TABLE "ProjectObjective" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "measure" TEXT,
    "target" TEXT,
    "kpiId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectObjective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectOutput" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "acceptanceCriteria" TEXT,
    "ownerId" TEXT,
    "dueAt" TIMESTAMP(3),
    "status" "ProjectOutputStatus" NOT NULL DEFAULT 'PLANNED',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectOutput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectRisk" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "likelihood" INTEGER NOT NULL,
    "impact" INTEGER NOT NULL,
    "mitigation" TEXT,
    "ownerId" TEXT,
    "status" "ProjectRiskStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectRisk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectObjective_projectId_order_idx" ON "ProjectObjective"("projectId", "order");

-- CreateIndex
CREATE INDEX "ProjectObjective_kpiId_idx" ON "ProjectObjective"("kpiId");

-- CreateIndex
CREATE INDEX "ProjectOutput_projectId_order_idx" ON "ProjectOutput"("projectId", "order");

-- CreateIndex
CREATE INDEX "ProjectOutput_ownerId_idx" ON "ProjectOutput"("ownerId");

-- CreateIndex
CREATE INDEX "ProjectOutput_status_idx" ON "ProjectOutput"("status");

-- CreateIndex
CREATE INDEX "ProjectRisk_projectId_status_idx" ON "ProjectRisk"("projectId", "status");

-- CreateIndex
CREATE INDEX "ProjectRisk_ownerId_idx" ON "ProjectRisk"("ownerId");

-- CreateIndex
CREATE INDEX "Project_responsibleDepartmentId_idx" ON "Project"("responsibleDepartmentId");

-- CreateIndex
CREATE INDEX "Project_managerId_idx" ON "Project"("managerId");

-- CreateIndex
CREATE INDEX "Project_sponsorId_sponsorStatus_idx" ON "Project"("sponsorId", "sponsorStatus");

-- CreateIndex
CREATE INDEX "Project_health_idx" ON "Project"("health");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_responsibleDepartmentId_fkey" FOREIGN KEY ("responsibleDepartmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_sponsorId_fkey" FOREIGN KEY ("sponsorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectObjective" ADD CONSTRAINT "ProjectObjective_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectObjective" ADD CONSTRAINT "ProjectObjective_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "KPI"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOutput" ADD CONSTRAINT "ProjectOutput_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOutput" ADD CONSTRAINT "ProjectOutput_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectRisk" ADD CONSTRAINT "ProjectRisk_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectRisk" ADD CONSTRAINT "ProjectRisk_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

