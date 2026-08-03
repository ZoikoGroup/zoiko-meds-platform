-- ZM-NOT-EMAIL-02: governed notification delivery.
-- Immutable event records, per-recipient delivery audit trail, and
-- address-level suppression for the email template library.

-- CreateEnum
CREATE TYPE "NotificationStream" AS ENUM ('TRANSACTIONAL', 'SECURITY', 'LEGAL', 'OPERATIONAL', 'INTERNAL', 'MARKETING');

-- CreateEnum
CREATE TYPE "NotificationGate" AS ENUM ('P0', 'P1', 'P2', 'INTERNAL', 'CONDITIONAL');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'IN_APP');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "NotificationSuppressionReason" AS ENUM ('TEMPLATE_NOT_ACTIVE', 'GATE_NOT_RELEASED', 'RECIPIENT_UNSUBSCRIBED', 'RECIPIENT_BOUNCED', 'RECIPIENT_COMPLAINED', 'NO_RESOLVED_RECIPIENT', 'DUPLICATE_EVENT', 'STATE_REVALIDATION_FAILED');

-- CreateTable
CREATE TABLE "NotificationEvent" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "baseEvent" TEXT NOT NULL,
    "stream" "NotificationStream" NOT NULL,
    "gate" "NotificationGate" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "workflowRef" TEXT,
    "workflowType" TEXT,
    "payload" JSONB NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en-US',
    "actorId" TEXT,
    "actorEmail" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "recipientEmail" TEXT,
    "recipientUserId" TEXT,
    "recipientResolution" TEXT NOT NULL,
    "senderAddress" TEXT,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "suppressionReason" "NotificationSuppressionReason",
    "providerMessageId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationSuppression" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" "NotificationSuppressionReason" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationEvent_idempotencyKey_key" ON "NotificationEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "NotificationEvent_templateId_idx" ON "NotificationEvent"("templateId");

-- CreateIndex
CREATE INDEX "NotificationEvent_workflowType_workflowRef_idx" ON "NotificationEvent"("workflowType", "workflowRef");

-- CreateIndex
CREATE INDEX "NotificationEvent_occurredAt_idx" ON "NotificationEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_eventId_idx" ON "NotificationDelivery"("eventId");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_idx" ON "NotificationDelivery"("status");

-- CreateIndex
CREATE INDEX "NotificationDelivery_recipientUserId_idx" ON "NotificationDelivery"("recipientUserId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSuppression_email_key" ON "NotificationSuppression"("email");

-- CreateIndex
CREATE INDEX "NotificationSuppression_reason_idx" ON "NotificationSuppression"("reason");

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "NotificationEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
