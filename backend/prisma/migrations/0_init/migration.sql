-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('PUBLIC', 'PHARMACY_STAFF', 'PHARMACY_ADMIN', 'ENTERPRISE', 'GOVERNMENT', 'ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "QualityState" AS ENUM ('VERIFIED', 'PARTNER_SUPPLIED', 'MAPPED', 'INFERRED', 'NEEDS_REVIEW', 'DEPRECATED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "PrescriptionCategory" AS ENUM ('OTC', 'PRESCRIPTION', 'CONTROLLED', 'RESTRICTED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'SUSPENDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "UploadMethod" AS ENUM ('MANUAL', 'CSV', 'API', 'POS_INTEGRATION');

-- CreateEnum
CREATE TYPE "AvailabilityConfidence" AS ENUM ('HIGH', 'MODERATE', 'LOW', 'UNKNOWN', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "InquiryType" AS ENUM ('MEDIBASE_BRIEFING', 'API_ACCESS', 'DATA_LICENSING', 'SECURITY_REVIEW', 'IMPLEMENTATION_WORKSHOP', 'GENERAL');

-- CreateEnum
CREATE TYPE "InquiryStatus" AS ENUM ('NEW', 'ROUTED', 'QUALIFIED', 'IN_REVIEW', 'CLOSED');

-- CreateEnum
CREATE TYPE "AuditSeverity" AS ENUM ('INFO', 'WARNING', 'SECURITY_ALERT');

-- CreateEnum
CREATE TYPE "VerificationRequestStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'ESCALATED', 'APPROVED', 'REJECTED', 'REQUEST_INFO');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('PLATFORM_UPDATE', 'MAINTENANCE', 'EMERGENCY_ALERT', 'SYSTEM_ANNOUNCEMENT');

-- CreateEnum
CREATE TYPE "NotificationTarget" AS ENUM ('ALL_USERS', 'PHARMACY_MANAGERS', 'ENTERPRISE_ADMINS', 'GOVERNMENT_PARTNERS');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('DRAFT', 'DISPATCHED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'PUBLIC',
    "passwordHash" TEXT,
    "pharmacyId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedMedicine" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedMedicine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "backToHigh" BOOLEAN NOT NULL DEFAULT true,
    "nearby" BOOLEAN NOT NULL DEFAULT true,
    "confidenceChange" BOOLEAN NOT NULL DEFAULT false,
    "shortage" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'reset',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Jurisdiction" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "regulatoryTag" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Jurisdiction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicineEntity" (
    "id" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "genericName" TEXT,
    "brandNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "manufacturer" TEXT,
    "description" TEXT,
    "activeIngredient" TEXT,
    "strength" TEXT,
    "dosageForm" TEXT,
    "route" TEXT,
    "presentation" TEXT,
    "atcCode" TEXT,
    "prescriptionCategory" "PrescriptionCategory" NOT NULL DEFAULT 'UNKNOWN',
    "qualityState" "QualityState" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "isControlled" BOOLEAN NOT NULL DEFAULT false,
    "isSuppressed" BOOLEAN NOT NULL DEFAULT false,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "jurisdictionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicineEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicineChangeLog" (
    "id" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "field" TEXT,
    "previousValue" JSONB,
    "newValue" JSONB,
    "fromState" "QualityState",
    "toState" "QualityState",
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicineChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentifierMapping" (
    "id" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "qualityState" "QualityState" NOT NULL DEFAULT 'MAPPED',
    "source" TEXT,
    "licenseScope" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdentifierMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pharmacy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "licenseNumber" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "country" TEXT,
    "postalCode" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "phone" TEXT,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "reliabilityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isParticipating" BOOLEAN NOT NULL DEFAULT false,
    "jurisdictionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pharmacy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventorySignal" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "uploadMethod" "UploadMethod" NOT NULL DEFAULT 'MANUAL',
    "quantityOnHand" INTEGER,
    "reportedInStock" BOOLEAN NOT NULL DEFAULT true,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventorySignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilitySignal" (
    "id" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "confidence" "AvailabilityConfidence" NOT NULL DEFAULT 'UNKNOWN',
    "freshnessMinutes" INTEGER,
    "requiresConfirmation" BOOLEAN NOT NULL DEFAULT false,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvailabilitySignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignalAggregate" (
    "id" TEXT NOT NULL,
    "medicineId" TEXT,
    "jurisdictionId" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "searchCount" INTEGER NOT NULL DEFAULT 0,
    "zeroResultCount" INTEGER NOT NULL DEFAULT 0,
    "restockEvents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignalAggregate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnterpriseInquiry" (
    "id" TEXT NOT NULL,
    "type" "InquiryType" NOT NULL DEFAULT 'GENERAL',
    "workEmail" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "organizationName" TEXT NOT NULL,
    "organizationType" TEXT NOT NULL,
    "primaryInterest" TEXT,
    "note" TEXT,
    "requestSource" TEXT,
    "assignedQueue" TEXT,
    "status" "InquiryStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnterpriseInquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "severity" "AuditSeverity" NOT NULL DEFAULT 'INFO',
    "metadata" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationRequest" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT,
    "pharmacyName" TEXT NOT NULL,
    "licenseNumber" TEXT NOT NULL,
    "submittedBy" TEXT NOT NULL,
    "status" "VerificationRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewer" TEXT,
    "docName" TEXT,
    "docUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL DEFAULT 'SYSTEM_ANNOUNCEMENT',
    "target" "NotificationTarget" NOT NULL DEFAULT 'ALL_USERS',
    "status" "NotificationStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "SavedMedicine_userId_idx" ON "SavedMedicine"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedMedicine_userId_medicineId_key" ON "SavedMedicine"("userId", "medicineId");

-- CreateIndex
CREATE UNIQUE INDEX "AlertPreference_userId_key" ON "AlertPreference"("userId");

-- CreateIndex
CREATE INDEX "SearchHistory_userId_createdAt_idx" ON "SearchHistory"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Jurisdiction_code_key" ON "Jurisdiction"("code");

-- CreateIndex
CREATE INDEX "MedicineEntity_canonicalName_idx" ON "MedicineEntity"("canonicalName");

-- CreateIndex
CREATE INDEX "MedicineEntity_genericName_idx" ON "MedicineEntity"("genericName");

-- CreateIndex
CREATE INDEX "MedicineEntity_qualityState_idx" ON "MedicineEntity"("qualityState");

-- CreateIndex
CREATE INDEX "MedicineEntity_isSuppressed_idx" ON "MedicineEntity"("isSuppressed");

-- CreateIndex
CREATE INDEX "MedicineChangeLog_medicineId_createdAt_idx" ON "MedicineChangeLog"("medicineId", "createdAt");

-- CreateIndex
CREATE INDEX "MedicineChangeLog_action_idx" ON "MedicineChangeLog"("action");

-- CreateIndex
CREATE INDEX "IdentifierMapping_system_value_idx" ON "IdentifierMapping"("system", "value");

-- CreateIndex
CREATE UNIQUE INDEX "IdentifierMapping_system_value_medicineId_key" ON "IdentifierMapping"("system", "value", "medicineId");

-- CreateIndex
CREATE INDEX "Pharmacy_verificationStatus_idx" ON "Pharmacy"("verificationStatus");

-- CreateIndex
CREATE INDEX "Pharmacy_latitude_longitude_idx" ON "Pharmacy"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "InventorySignal_pharmacyId_medicineId_idx" ON "InventorySignal"("pharmacyId", "medicineId");

-- CreateIndex
CREATE INDEX "InventorySignal_reportedAt_idx" ON "InventorySignal"("reportedAt");

-- CreateIndex
CREATE INDEX "AvailabilitySignal_medicineId_idx" ON "AvailabilitySignal"("medicineId");

-- CreateIndex
CREATE INDEX "AvailabilitySignal_confidence_idx" ON "AvailabilitySignal"("confidence");

-- CreateIndex
CREATE UNIQUE INDEX "AvailabilitySignal_medicineId_pharmacyId_key" ON "AvailabilitySignal"("medicineId", "pharmacyId");

-- CreateIndex
CREATE INDEX "SignalAggregate_medicineId_periodStart_idx" ON "SignalAggregate"("medicineId", "periodStart");

-- CreateIndex
CREATE INDEX "EnterpriseInquiry_type_status_idx" ON "EnterpriseInquiry"("type", "status");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_severity_idx" ON "AuditLog"("severity");

-- CreateIndex
CREATE INDEX "VerificationRequest_status_idx" ON "VerificationRequest"("status");

-- CreateIndex
CREATE INDEX "Notification_status_idx" ON "Notification"("status");

-- CreateIndex
CREATE INDEX "Notification_type_idx" ON "Notification"("type");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedMedicine" ADD CONSTRAINT "SavedMedicine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedMedicine" ADD CONSTRAINT "SavedMedicine_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "MedicineEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertPreference" ADD CONSTRAINT "AlertPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchHistory" ADD CONSTRAINT "SearchHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineEntity" ADD CONSTRAINT "MedicineEntity_jurisdictionId_fkey" FOREIGN KEY ("jurisdictionId") REFERENCES "Jurisdiction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineChangeLog" ADD CONSTRAINT "MedicineChangeLog_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "MedicineEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentifierMapping" ADD CONSTRAINT "IdentifierMapping_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "MedicineEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pharmacy" ADD CONSTRAINT "Pharmacy_jurisdictionId_fkey" FOREIGN KEY ("jurisdictionId") REFERENCES "Jurisdiction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySignal" ADD CONSTRAINT "InventorySignal_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilitySignal" ADD CONSTRAINT "AvailabilitySignal_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "MedicineEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilitySignal" ADD CONSTRAINT "AvailabilitySignal_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

