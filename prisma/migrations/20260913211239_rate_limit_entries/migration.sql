-- CreateTable
CREATE TABLE "RateLimitEntry" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RateLimitEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RateLimitEntry_key_windowStart_idx" ON "RateLimitEntry"("key", "windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimitEntry_key_windowStart_key" ON "RateLimitEntry"("key", "windowStart");
