-- Pharmacy POS / ERP integration (MP-31).
--
-- Safe to apply to a live database: two new tables and two new enums. No
-- existing row is read, rewritten or removed, and a pharmacy with no feed
-- simply has no row in either table.

CREATE TYPE "IntegrationSyncStatus" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED');
CREATE TYPE "IntegrationDirection" AS ENUM ('PULL', 'PUSH');

CREATE TABLE "PharmacyIntegration" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "direction" "IntegrationDirection" NOT NULL DEFAULT 'PULL',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "feedUrl" TEXT,
    "authHeaderName" TEXT,
    "authHeaderSecret" TEXT,
    "syncMode" TEXT NOT NULL DEFAULT 'merge',
    "intervalMinutes" INTEGER NOT NULL DEFAULT 60,
    "apiKeyHash" TEXT,
    "apiKeyPrefix" TEXT,
    "apiKeyIssuedAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncStatus" "IntegrationSyncStatus",
    "nextSyncAt" TIMESTAMP(3),
    "syncingSince" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PharmacyIntegration_pkey" PRIMARY KEY ("id")
);

-- One feed per pharmacy: the portal edits a configuration, it does not
-- accumulate them.
CREATE UNIQUE INDEX "PharmacyIntegration_pharmacyId_key" ON "PharmacyIntegration"("pharmacyId");

-- The scheduler's only query: enabled feeds whose next run is due.
CREATE INDEX "PharmacyIntegration_enabled_nextSyncAt_idx" ON "PharmacyIntegration"("enabled", "nextSyncAt");

CREATE TABLE "PharmacySyncRun" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" "IntegrationSyncStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "rows" INTEGER NOT NULL DEFAULT 0,
    "imported" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "PharmacySyncRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PharmacySyncRun_pharmacyId_startedAt_idx" ON "PharmacySyncRun"("pharmacyId", "startedAt");

-- Cascades: a deleted pharmacy takes its feed configuration and its sync
-- history with it rather than leaving rows nothing can reach.
ALTER TABLE "PharmacyIntegration"
  ADD CONSTRAINT "PharmacyIntegration_pharmacyId_fkey"
  FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PharmacySyncRun"
  ADD CONSTRAINT "PharmacySyncRun_integrationId_fkey"
  FOREIGN KEY ("integrationId") REFERENCES "PharmacyIntegration"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PharmacySyncRun"
  ADD CONSTRAINT "PharmacySyncRun_pharmacyId_fkey"
  FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
