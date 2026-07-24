-- Reports: saved & scheduled governed exports surfaced in the admin console.

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('EXECUTIVE_BRIEFING', 'REGIONAL_DIGEST', 'GOVERNANCE_EXPORT', 'NETWORK_REPORT', 'OPERATIONS', 'DATA_QUALITY', 'FORECAST');

-- CreateEnum
CREATE TYPE "ReportFormat" AS ENUM ('PDF', 'CSV', 'XLSX', 'JSON');

-- CreateEnum
CREATE TYPE "ReportScope" AS ENUM ('ALL', 'SIGNAL', 'JURISDICTION', 'NETWORK');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('READY', 'SCHEDULED', 'RUNNING', 'FAILED');

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ReportType" NOT NULL DEFAULT 'EXECUTIVE_BRIEFING',
    "format" "ReportFormat" NOT NULL DEFAULT 'PDF',
    "scope" "ReportScope" NOT NULL DEFAULT 'ALL',
    "status" "ReportStatus" NOT NULL DEFAULT 'READY',
    "owner" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "schedule" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Report_status_idx" ON "Report"("status");

-- CreateIndex
CREATE INDEX "Report_type_idx" ON "Report"("type");
