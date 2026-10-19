-- Additive only. No data movement, no drops.
ALTER TABLE "User" ADD COLUMN "aliases" TEXT;
ALTER TABLE "Task" ADD COLUMN "aiEffortHours" DOUBLE PRECISION;
ALTER TABLE "Task" ADD COLUMN "aiEffortAt" TIMESTAMP(3);
ALTER TABLE "TeamLoadSnapshot" ADD COLUMN "driversJson" TEXT;
