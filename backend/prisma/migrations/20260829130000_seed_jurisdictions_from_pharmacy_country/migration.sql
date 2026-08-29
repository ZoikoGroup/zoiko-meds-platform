-- Closes the other half of MSA-35's jurisdiction gap for data that already
-- existed before the companion code fix: Jurisdiction had zero rows in every
-- deployment, and nothing ever wrote to it, so no existing pharmacy — and no
-- medicine identity reported through one — could carry a jurisdiction. The
-- application now creates a Jurisdiction the moment a pharmacy registers or
-- edits its country (see resolveJurisdictionId), but that only reaches
-- pharmacies that get created or edited going forward. This backfills the
-- ones already on file.
--
-- "country" is free text a person typed ("India", "india", "IN" all appear
-- for the same country here), so this normalizes only the values actually
-- observed in this platform's own data rather than inventing a full country
-- taxonomy — the application's resolveCountryAlpha2 is the authority for
-- everything going forward.

-- 1. One jurisdiction per normalized country already on a pharmacy row.
WITH normalized AS (
  SELECT
    CASE
      WHEN upper(btrim(country)) IN ('IN', 'INDIA') THEN 'IN'
      WHEN upper(btrim(country)) IN ('US', 'USA', 'UNITED STATES') THEN 'US'
      ELSE upper(btrim(country))
    END AS code
  FROM "Pharmacy"
  WHERE country IS NOT NULL AND btrim(country) <> ''
)
INSERT INTO "Jurisdiction" ("id", "code", "name", "createdAt")
SELECT
  'jur-' || lower(code),
  code,
  CASE code WHEN 'IN' THEN 'India' WHEN 'US' THEN 'United States' ELSE code END,
  CURRENT_TIMESTAMP
FROM (SELECT DISTINCT code FROM normalized WHERE code IS NOT NULL) distinct_codes
ON CONFLICT ("code") DO NOTHING;

-- 2. Assign each pharmacy to the jurisdiction its own (normalized) country
-- maps to. Idempotent: only rows with no jurisdiction yet are touched.
WITH normalized AS (
  SELECT
    id AS pharmacy_id,
    CASE
      WHEN upper(btrim(country)) IN ('IN', 'INDIA') THEN 'IN'
      WHEN upper(btrim(country)) IN ('US', 'USA', 'UNITED STATES') THEN 'US'
      ELSE upper(btrim(country))
    END AS code
  FROM "Pharmacy"
  WHERE country IS NOT NULL AND btrim(country) <> ''
)
UPDATE "Pharmacy" p
SET "jurisdictionId" = j.id
FROM normalized n
JOIN "Jurisdiction" j ON j.code = n.code
WHERE p.id = n.pharmacy_id
  AND p."jurisdictionId" IS NULL;

-- 3. Re-run the MedicineEntity backfill from 20260829120000_backfill_medicine
-- _jurisdiction now that pharmacies actually have a jurisdiction to hand
-- down — that migration ran before any pharmacy had one, so it could not
-- have set anything.
WITH earliest_signal AS (
  SELECT DISTINCT ON ("medicineId")
    "medicineId",
    "pharmacyId"
  FROM "AvailabilitySignal"
  ORDER BY "medicineId", "computedAt" ASC
)
UPDATE "MedicineEntity" m
SET "jurisdictionId" = p."jurisdictionId"
FROM earliest_signal es
JOIN "Pharmacy" p ON p.id = es."pharmacyId"
WHERE m.id = es."medicineId"
  AND m."jurisdictionId" IS NULL
  AND p."jurisdictionId" IS NOT NULL;
