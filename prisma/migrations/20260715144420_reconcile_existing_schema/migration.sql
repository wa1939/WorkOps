-- Reconcile additive schema changes that predate migration tracking.
ALTER TABLE "KPI" ADD COLUMN IF NOT EXISTS "trackingPeriod" TEXT NOT NULL DEFAULT 'ANNUAL';

ALTER TABLE "KPIUpdate"
ADD COLUMN IF NOT EXISTS "achievementPercent" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "quarter" TEXT,
ADD COLUMN IF NOT EXISTS "score" DOUBLE PRECISION;

ALTER TABLE "NotePage"
ADD COLUMN IF NOT EXISTS "caseStudyId" TEXT,
ADD COLUMN IF NOT EXISTS "color" TEXT NOT NULL DEFAULT 'default',
ADD COLUMN IF NOT EXISTS "isPinned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "taskId" TEXT;

ALTER TABLE "SavedView"
ADD COLUMN IF NOT EXISTS "blocksJson" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN IF NOT EXISTS "color" TEXT NOT NULL DEFAULT 'blue',
ADD COLUMN IF NOT EXISTS "description" TEXT,
ADD COLUMN IF NOT EXISTS "icon" TEXT,
ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "entity" DROP NOT NULL,
ALTER COLUMN "viewType" DROP NOT NULL,
ALTER COLUMN "query" DROP NOT NULL;

ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "isPrivate" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "emailVerified" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "password" TEXT,
ALTER COLUMN "name" SET DEFAULT '';

CREATE TABLE IF NOT EXISTS "TaskReminder" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "offsetMinutes" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskReminder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SavedViewVote" (
    "id" TEXT NOT NULL,
    "viewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SavedViewVote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "UserStreak" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "bestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastActiveAt" TIMESTAMP(3),
    "totalPoints" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserStreak_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TaskReminder_taskId_userId_offsetMinutes_key" ON "TaskReminder"("taskId", "userId", "offsetMinutes");
CREATE UNIQUE INDEX IF NOT EXISTS "SavedViewVote_viewId_userId_key" ON "SavedViewVote"("viewId", "userId");
CREATE UNIQUE INDEX IF NOT EXISTS "UserStreak_userId_key" ON "UserStreak"("userId");
CREATE INDEX IF NOT EXISTS "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "Comment_taskId_idx" ON "Comment"("taskId");
CREATE INDEX IF NOT EXISTS "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");
CREATE INDEX IF NOT EXISTS "Task_status_idx" ON "Task"("status");
CREATE INDEX IF NOT EXISTS "Task_dueAt_idx" ON "Task"("dueAt");
CREATE INDEX IF NOT EXISTS "Task_createdById_idx" ON "Task"("createdById");
CREATE INDEX IF NOT EXISTS "Task_projectId_idx" ON "Task"("projectId");
CREATE INDEX IF NOT EXISTS "Task_caseStudyId_idx" ON "Task"("caseStudyId");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NotePage_taskId_fkey') THEN
        ALTER TABLE "NotePage" ADD CONSTRAINT "NotePage_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NotePage_caseStudyId_fkey') THEN
        ALTER TABLE "NotePage" ADD CONSTRAINT "NotePage_caseStudyId_fkey" FOREIGN KEY ("caseStudyId") REFERENCES "CaseStudy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskReminder_taskId_fkey') THEN
        ALTER TABLE "TaskReminder" ADD CONSTRAINT "TaskReminder_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskReminder_userId_fkey') THEN
        ALTER TABLE "TaskReminder" ADD CONSTRAINT "TaskReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SavedViewVote_viewId_fkey') THEN
        ALTER TABLE "SavedViewVote" ADD CONSTRAINT "SavedViewVote_viewId_fkey" FOREIGN KEY ("viewId") REFERENCES "SavedView"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
