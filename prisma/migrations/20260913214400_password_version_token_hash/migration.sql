-- AlterTable
ALTER TABLE "PasswordResetToken" ADD COLUMN     "tokenHash" TEXT,
ADD COLUMN     "usedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "passwordVersion" INTEGER NOT NULL DEFAULT 0;
