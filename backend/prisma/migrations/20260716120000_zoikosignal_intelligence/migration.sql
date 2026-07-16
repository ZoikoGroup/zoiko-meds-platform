-- ZoikoSignal™ intelligence: event ingestion substrate + hardened aggregate cells.

-- CreateEnum
CREATE TYPE "SignalEventType" AS ENUM ('SEARCH', 'ZERO_RESULT', 'RESTOCK', 'CONFIRMATION');

-- CreateEnum
CREATE TYPE "AggregateBucket" AS ENUM ('HOUR', 'DAY', 'WEEK');

-- CreateTable
CREATE TABLE "SignalEvent" (
    "id" TEXT NOT NULL,
    "type" "SignalEventType" NOT NULL,
    "medicineId" TEXT,
    "jurisdictionId" TEXT,
    "pharmacyId" TEXT,
    "searchTerm" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aggregatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SignalEvent_aggregatedAt_idx" ON "SignalEvent"("aggregatedAt");

-- CreateIndex
CREATE INDEX "SignalEvent_type_occurredAt_idx" ON "SignalEvent"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "SignalEvent_medicineId_occurredAt_idx" ON "SignalEvent"("medicineId", "occurredAt");

-- CreateIndex
CREATE INDEX "SignalEvent_type_aggregatedAt_idx" ON "SignalEvent"("type", "aggregatedAt");

-- AlterTable: harden SignalAggregate into governed, k-anonymity-aware cells.
ALTER TABLE "SignalAggregate"
    ADD COLUMN "bucket" "AggregateBucket" NOT NULL DEFAULT 'DAY',
    ADD COLUMN "confirmationCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "sampleSize" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "suppressed" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE UNIQUE INDEX "SignalAggregate_medicineId_jurisdictionId_bucket_periodStart_key" ON "SignalAggregate"("medicineId", "jurisdictionId", "bucket", "periodStart");

-- CreateIndex
CREATE INDEX "SignalAggregate_bucket_periodStart_idx" ON "SignalAggregate"("bucket", "periodStart");

-- CreateIndex
CREATE INDEX "SignalAggregate_suppressed_idx" ON "SignalAggregate"("suppressed");
