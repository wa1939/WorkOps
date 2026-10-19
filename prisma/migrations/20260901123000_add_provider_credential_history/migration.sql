-- AlterTable
ALTER TABLE "AiProviderCredential" ADD COLUMN "previousEncryptedValue" TEXT;
ALTER TABLE "AiProviderCredential" ADD COLUMN "previousIv" TEXT;
ALTER TABLE "AiProviderCredential" ADD COLUMN "previousAuthTag" TEXT;
ALTER TABLE "AiProviderCredential" ADD COLUMN "previousKeyVersion" INTEGER;
