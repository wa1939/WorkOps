-- CreateEnum
CREATE TYPE "ProjectAccessLevel" AS ENUM ('ADMIN', 'MANAGER', 'MEMBER', 'VIEWER');

-- AlterTable
ALTER TABLE "ProjectMember" ADD COLUMN     "accessLevel" "ProjectAccessLevel" NOT NULL DEFAULT 'MEMBER';
