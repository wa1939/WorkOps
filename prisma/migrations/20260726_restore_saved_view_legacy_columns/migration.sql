-- Prisma's SavedView model declares the pre-block-layout fields `entity`, `viewType` and
-- `query` (kept as optional for compatibility), but they are absent from the production
-- table. Every Prisma read/write of SavedView selects them, so both GET and POST
-- /api/saved-views failed with P2022 ("column does not exist") and the UI showed
-- "Failed to create view".
--
-- Purely additive and idempotent: nullable columns with no default, so no table rewrite
-- and no existing data is touched.
ALTER TABLE "SavedView"
ADD COLUMN IF NOT EXISTS "entity" TEXT,
ADD COLUMN IF NOT EXISTS "viewType" TEXT,
ADD COLUMN IF NOT EXISTS "query" TEXT;
