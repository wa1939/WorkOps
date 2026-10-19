-- CreateTable
CREATE TABLE "TeamLoadSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "loadHours" DOUBLE PRECISION NOT NULL,
    "loadPercent" DOUBLE PRECISION NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamLoadSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamLoadSnapshot_weekStart_idx" ON "TeamLoadSnapshot"("weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "TeamLoadSnapshot_userId_weekStart_key" ON "TeamLoadSnapshot"("userId", "weekStart");

-- AddForeignKey
ALTER TABLE "TeamLoadSnapshot" ADD CONSTRAINT "TeamLoadSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
