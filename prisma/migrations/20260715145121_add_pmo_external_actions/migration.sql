-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('STANDARD', 'EXTERNAL_ACTION');

-- CreateEnum
CREATE TYPE "FollowUpTrigger" AS ENUM ('PRE_DUE', 'DUE', 'OVERDUE', 'MANUAL');

-- CreateEnum
CREATE TYPE "EmailDeliveryState" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "CaseStudy" ADD COLUMN     "workAreaId" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "workAreaId" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "type" "TaskType" NOT NULL DEFAULT 'STANDARD';

-- CreateTable
CREATE TABLE "WorkArea" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "description" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalContact" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "department" TEXT,
    "organization" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalAction" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "externalContactId" TEXT NOT NULL,
    "overdueIntervalDays" INTEGER DEFAULT 7,
    "lastExternalResponseAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closureNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderRule" (
    "id" TEXT NOT NULL,
    "externalActionId" TEXT NOT NULL,
    "daysBeforeDue" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpEvent" (
    "id" TEXT NOT NULL,
    "externalActionId" TEXT NOT NULL,
    "triggerType" "FollowUpTrigger" NOT NULL,
    "scheduledDate" DATE NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "notificationId" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "ownerEmailState" "EmailDeliveryState" NOT NULL DEFAULT 'PENDING',
    "ownerEmailAttempts" INTEGER NOT NULL DEFAULT 0,
    "ownerEmailLastAttemptAt" TIMESTAMP(3),
    "ownerEmailLastError" TEXT,
    "finalRecipient" TEXT,
    "finalSubject" TEXT,
    "finalBody" TEXT,
    "sentAt" TIMESTAMP(3),
    "sentById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUpEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionEvidence" (
    "id" TEXT NOT NULL,
    "externalActionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkArea_normalizedName_key" ON "WorkArea"("normalizedName");

-- CreateIndex
CREATE INDEX "WorkArea_isArchived_displayOrder_idx" ON "WorkArea"("isArchived", "displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalContact_normalizedEmail_key" ON "ExternalContact"("normalizedEmail");

-- CreateIndex
CREATE INDEX "ExternalContact_isArchived_name_idx" ON "ExternalContact"("isArchived", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalAction_taskId_key" ON "ExternalAction"("taskId");

-- CreateIndex
CREATE INDEX "ExternalAction_ownerId_idx" ON "ExternalAction"("ownerId");

-- CreateIndex
CREATE INDEX "ExternalAction_externalContactId_idx" ON "ExternalAction"("externalContactId");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderRule_externalActionId_daysBeforeDue_key" ON "ReminderRule"("externalActionId", "daysBeforeDue");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUpEvent_dedupKey_key" ON "FollowUpEvent"("dedupKey");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUpEvent_notificationId_key" ON "FollowUpEvent"("notificationId");

-- CreateIndex
CREATE INDEX "FollowUpEvent_externalActionId_scheduledDate_idx" ON "FollowUpEvent"("externalActionId", "scheduledDate");

-- CreateIndex
CREATE INDEX "FollowUpEvent_ownerEmailState_ownerEmailLastAttemptAt_idx" ON "FollowUpEvent"("ownerEmailState", "ownerEmailLastAttemptAt");

-- CreateIndex
CREATE INDEX "ActionEvidence_externalActionId_createdAt_idx" ON "ActionEvidence"("externalActionId", "createdAt");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_workAreaId_fkey" FOREIGN KEY ("workAreaId") REFERENCES "WorkArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseStudy" ADD CONSTRAINT "CaseStudy_workAreaId_fkey" FOREIGN KEY ("workAreaId") REFERENCES "WorkArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkArea" ADD CONSTRAINT "WorkArea_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalContact" ADD CONSTRAINT "ExternalContact_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalAction" ADD CONSTRAINT "ExternalAction_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalAction" ADD CONSTRAINT "ExternalAction_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalAction" ADD CONSTRAINT "ExternalAction_externalContactId_fkey" FOREIGN KEY ("externalContactId") REFERENCES "ExternalContact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalAction" ADD CONSTRAINT "ExternalAction_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderRule" ADD CONSTRAINT "ReminderRule_externalActionId_fkey" FOREIGN KEY ("externalActionId") REFERENCES "ExternalAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpEvent" ADD CONSTRAINT "FollowUpEvent_externalActionId_fkey" FOREIGN KEY ("externalActionId") REFERENCES "ExternalAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpEvent" ADD CONSTRAINT "FollowUpEvent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpEvent" ADD CONSTRAINT "FollowUpEvent_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpEvent" ADD CONSTRAINT "FollowUpEvent_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionEvidence" ADD CONSTRAINT "ActionEvidence_externalActionId_fkey" FOREIGN KEY ("externalActionId") REFERENCES "ExternalAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionEvidence" ADD CONSTRAINT "ActionEvidence_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SeedData
INSERT INTO "WorkArea" ("id", "name", "normalizedName", "displayOrder", "isArchived", "createdAt", "updatedAt") VALUES
('wa_employee_experience', 'Employee Experience', 'employee experience', 10, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('wa_engagement', 'Engagement', 'engagement', 20, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('wa_resignation', 'Resignation', 'resignation', 30, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('wa_turnover', 'Turnover', 'turnover', 40, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('wa_change_management', 'Change Management', 'change management', 50, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("normalizedName") DO NOTHING;
