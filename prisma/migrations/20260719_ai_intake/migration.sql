-- CreateTable
CREATE TABLE "AiIntake" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "rowsJson" TEXT,
    "text" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiIntake_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiIntake_userId_createdAt_idx" ON "AiIntake"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiIntake" ADD CONSTRAINT "AiIntake_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
