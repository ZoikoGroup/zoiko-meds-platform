-- SavedMedicine.alertsEnabled: the column the schema has always declared and no
-- migration ever created.
--
-- It was added to schema.prisma and reached developer databases through
-- `db push`, which writes to the database without recording a migration. Every
-- database built from this directory alone — production among them — never got
-- it, while `prisma migrate status` reported "up to date" the whole time,
-- because the ledger only knows which migrations ran, not what they produced.
-- Every SavedMedicine query selects alertsEnabled, so all of them failed with
-- P2022 and Saved Medicines was unusable.
--
-- IF NOT EXISTS is load-bearing, not caution: the developer databases that were
-- pushed to already have this column, and a plain ADD COLUMN would fail there,
-- record a failed migration, and block every later one behind P3009.
--
-- NOT NULL DEFAULT true matches `alertsEnabled Boolean @default(true)`, and the
-- default is what backfills the existing rows: a medicine saved before this
-- keeps the alerts it was saved with.
ALTER TABLE "SavedMedicine"
  ADD COLUMN IF NOT EXISTS "alertsEnabled" BOOLEAN NOT NULL DEFAULT true;
