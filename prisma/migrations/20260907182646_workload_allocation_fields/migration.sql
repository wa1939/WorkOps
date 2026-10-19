-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "estimateConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "plannedEndAt" TIMESTAMP(3),
ADD COLUMN     "plannedStartAt" TIMESTAMP(3),
ADD COLUMN     "remainingEffortHours" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "TaskAssignment" ADD COLUMN     "plannedShare" DOUBLE PRECISION;
