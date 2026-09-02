-- Backfill MedicineEntity.jurisdictionId for identities a pharmacy created
-- without one (MSA-35). addInventoryItem / updateInventoryItem / importCsv
-- never set it before this migration's companion code fix, so every
-- pharmacy-sourced identity carried jurisdictionId = NULL forever, and the
-- MediBase dashboard's market counts were permanently zero regardless of how
-- large the catalog grew.
--
-- Infers each identity's jurisdiction from whichever pharmacy holds the
-- earliest AvailabilitySignal against it — a medicine can be stocked by
-- pharmacies in different jurisdictions, so the earliest signal (first
-- stockist to report it) is the deterministic tie-break.
--
-- A no-op wherever that pharmacy itself has no jurisdictionId — true for
-- every pharmacy in every deployment as of this migration, since no
-- Jurisdiction row has ever been created here. Assigning jurisdictions to
-- pharmacies is a separate gap; this UPDATE only makes sure the catalog stops
-- silently discarding the answer once that exists. Idempotent: already-set
-- rows are excluded, so re-running finds nothing left to do.
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
