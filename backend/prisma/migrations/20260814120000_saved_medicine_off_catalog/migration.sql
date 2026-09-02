-- Saved medicines: allow following a medicine MediBase does not yet contain.
--
-- A patient can save a medicine by name before any verified pharmacy stocks it.
-- The row carries the name plus a normalized matching key, and is linked to a
-- governed MedicineEntity the first time a pharmacy adds that medicine.
--
-- Safe to apply to a live database: columns are added nullable, backfilled from
-- the existing relation, and only then made NOT NULL. No row is dropped.

-- 1. New columns, nullable for the backfill.
ALTER TABLE "SavedMedicine" ADD COLUMN "medicineName" TEXT;
ALTER TABLE "SavedMedicine" ADD COLUMN "normalizedName" TEXT;
ALTER TABLE "SavedMedicine" ADD COLUMN "linkedAt" TIMESTAMP(3);

-- 2. Backfill from the medicine every existing row already points at.
--    normalizedName mirrors normalizeMedicineName() in the application layer:
--    lower-cased with every non-alphanumeric character removed.
UPDATE "SavedMedicine" s
SET "medicineName" = m."canonicalName",
    "normalizedName" = regexp_replace(lower(m."canonicalName"), '[^a-z0-9]', '', 'g')
FROM "MedicineEntity" m
WHERE s."medicineId" = m."id";

-- 3. Any row whose medicine vanished mid-migration keeps a usable name rather
--    than blocking the NOT NULL below.
UPDATE "SavedMedicine"
SET "medicineName" = COALESCE("medicineName", 'Unknown medicine'),
    "normalizedName" = COALESCE(NULLIF("normalizedName", ''), 'unknown-' || "id")
WHERE "medicineName" IS NULL OR "normalizedName" IS NULL OR "normalizedName" = '';

-- 4. De-duplicate before the new unique index: two rows for the same user could
--    previously point at distinct MedicineEntity rows that normalize alike.
--    Keep the oldest, which owns the notification history.
DELETE FROM "SavedMedicine" a
USING "SavedMedicine" b
WHERE a."userId" = b."userId"
  AND a."normalizedName" = b."normalizedName"
  AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."id" > b."id"));

-- 5. Lock the columns down.
ALTER TABLE "SavedMedicine" ALTER COLUMN "medicineName" SET NOT NULL;
ALTER TABLE "SavedMedicine" ALTER COLUMN "normalizedName" SET NOT NULL;

-- 6. medicineId becomes optional, and its cascade becomes SET NULL so retiring
--    a medicine downgrades the save to name-only instead of deleting it.
ALTER TABLE "SavedMedicine" ALTER COLUMN "medicineId" DROP NOT NULL;
ALTER TABLE "SavedMedicine" DROP CONSTRAINT "SavedMedicine_medicineId_fkey";
ALTER TABLE "SavedMedicine"
  ADD CONSTRAINT "SavedMedicine_medicineId_fkey"
  FOREIGN KEY ("medicineId") REFERENCES "MedicineEntity"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 7. Uniqueness moves to the normalized name. A nullable medicineId would let
--    Postgres treat every unlinked row as distinct.
DROP INDEX IF EXISTS "SavedMedicine_userId_medicineId_key";
CREATE UNIQUE INDEX "SavedMedicine_userId_normalizedName_key"
  ON "SavedMedicine"("userId", "normalizedName");

-- 8. Lookup path for the linker: find unlinked saves matching a new medicine.
CREATE INDEX "SavedMedicine_normalizedName_medicineId_idx"
  ON "SavedMedicine"("normalizedName", "medicineId");
