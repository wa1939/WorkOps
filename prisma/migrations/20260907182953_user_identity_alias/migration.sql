-- CreateTable
CREATE TABLE "UserIdentityAlias" (
    "id" TEXT NOT NULL,
    "sourceUserId" TEXT NOT NULL,
    "canonicalUserId" TEXT NOT NULL,
    "approvedById" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserIdentityAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserIdentityAlias_sourceUserId_key" ON "UserIdentityAlias"("sourceUserId");

-- AddForeignKey
ALTER TABLE "UserIdentityAlias" ADD CONSTRAINT "UserIdentityAlias_sourceUserId_fkey" FOREIGN KEY ("sourceUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserIdentityAlias" ADD CONSTRAINT "UserIdentityAlias_canonicalUserId_fkey" FOREIGN KEY ("canonicalUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserIdentityAlias" ADD CONSTRAINT "UserIdentityAlias_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
