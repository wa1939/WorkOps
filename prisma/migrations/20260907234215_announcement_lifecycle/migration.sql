-- CreateEnum
CREATE TYPE "AnnouncementPriority" AS ENUM ('NORMAL', 'IMPORTANT', 'CRITICAL');

-- AlterTable
ALTER TABLE "Announcement" ADD COLUMN     "audienceJson" TEXT,
ADD COLUMN     "audienceVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "ctaUrl" TEXT,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "priority" "AnnouncementPriority" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "publishAt" TIMESTAMP(3),
ADD COLUMN     "requireAcknowledgement" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'DRAFT';
-- workspaceId on Announcement is added by 20260907220806_workspace_expand;
-- removed here to avoid a duplicate-column failure when both migrations run.

-- AlterTable
ALTER TABLE "AnnouncementSeen" ADD COLUMN     "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "audienceVersion" INTEGER NOT NULL DEFAULT 1;
