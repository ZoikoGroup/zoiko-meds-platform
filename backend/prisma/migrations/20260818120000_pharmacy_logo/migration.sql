-- Pharmacy logos.
--
-- The image lives in its own table, not on "Pharmacy": that row is read by
-- patient search, and every scalar on it is selected by default, so a blob there
-- would be fetched by queries that never display it.
--
-- Safe to apply to a live database: one new nullable column and one new table.
-- No existing row is read, rewritten or removed.

ALTER TABLE "Pharmacy" ADD COLUMN "logoUpdatedAt" TIMESTAMP(3);

CREATE TABLE "PharmacyLogo" (
    "pharmacyId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PharmacyLogo_pkey" PRIMARY KEY ("pharmacyId")
);

-- Cascade: a deleted pharmacy takes its logo with it rather than leaving bytes
-- nothing can reach.
ALTER TABLE "PharmacyLogo"
  ADD CONSTRAINT "PharmacyLogo_pharmacyId_fkey"
  FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
