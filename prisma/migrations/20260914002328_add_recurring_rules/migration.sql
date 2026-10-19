-- CreateTable
CREATE TABLE "RecurringRule" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "freq" TEXT NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "byDay" JSONB,
    "byMonthDay" INTEGER,
    "nthWeek" INTEGER,
    "weekday" INTEGER,
    "mode" TEXT NOT NULL DEFAULT 'create',
    "targetStatus" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecurringRule_taskId_key" ON "RecurringRule"("taskId");

-- CreateIndex
CREATE INDEX "RecurringRule_taskId_idx" ON "RecurringRule"("taskId");

-- CreateIndex
CREATE INDEX "RecurringRule_active_nextRunAt_idx" ON "RecurringRule"("active", "nextRunAt");

-- AddForeignKey
ALTER TABLE "RecurringRule" ADD CONSTRAINT "RecurringRule_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
