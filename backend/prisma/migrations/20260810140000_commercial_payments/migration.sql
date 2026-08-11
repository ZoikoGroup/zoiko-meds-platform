-- ZM-COM-BILL-001 — payment provider, invoices, tax determination & credit notes.
-- Additive only: new tables and enums, no existing column altered or dropped.

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE', 'FINANCE_MANUAL');

-- CreateEnum
CREATE TYPE "ProviderMode" AS ENUM ('TEST', 'LIVE');

-- CreateEnum
CREATE TYPE "ProviderEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PAID', 'UNCOLLECTIBLE', 'VOID', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "CreditNoteReason" AS ENUM ('SERVICE_CREDIT', 'BILLING_ERROR', 'DUPLICATE_CHARGE', 'APPROVED_EXCEPTION', 'CONTRACT_TERMINATION');

-- CreateTable
CREATE TABLE "ProviderEvent" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'STRIPE',
    "mode" "ProviderMode" NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" "ProviderEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "payload" JSONB,
    "failureReason" TEXT,
    "relatedInvoiceId" TEXT,
    "processedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "billingProfileId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "supplierLegalEntity" TEXT NOT NULL,
    "customerLegalName" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "locationCount" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "subtotalMinor" INTEGER NOT NULL,
    "discountMinor" INTEGER NOT NULL DEFAULT 0,
    "taxMinor" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL,
    "amountPaidMinor" INTEGER NOT NULL DEFAULT 0,
    "amountRefundedMinor" INTEGER NOT NULL DEFAULT 0,
    "taxDeterminationId" TEXT,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'STRIPE',
    "mode" "ProviderMode" NOT NULL,
    "providerInvoiceId" TEXT,
    "providerPaymentIntentId" TEXT,
    "catalogVersion" TEXT,
    "issuedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "reason" "CreditNoteReason" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvalReference" TEXT,
    "note" TEXT,
    "incidentReference" TEXT,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'STRIPE',
    "providerCreditNoteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxDetermination" (
    "id" TEXT NOT NULL,
    "billingProfileId" TEXT NOT NULL,
    "customerCountry" TEXT NOT NULL,
    "customerRegion" TEXT,
    "customerPostalCode" TEXT,
    "taxId" TEXT,
    "taxExempt" BOOLEAN NOT NULL DEFAULT false,
    "productTaxCode" TEXT,
    "rateBasisPoints" INTEGER NOT NULL,
    "taxAmountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "treatment" TEXT NOT NULL,
    "determinedBy" TEXT NOT NULL,
    "determinationRef" TEXT,
    "jurisdictionNote" TEXT,
    "determinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxDetermination_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderEvent_providerEventId_key" ON "ProviderEvent"("providerEventId");

-- CreateIndex
CREATE INDEX "ProviderEvent_eventType_receivedAt_idx" ON "ProviderEvent"("eventType", "receivedAt");

-- CreateIndex
CREATE INDEX "ProviderEvent_status_idx" ON "ProviderEvent"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_billingProfileId_createdAt_idx" ON "Invoice"("billingProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_providerInvoiceId_idx" ON "Invoice"("providerInvoiceId");

-- CreateIndex
CREATE INDEX "CreditNote_invoiceId_idx" ON "CreditNote"("invoiceId");

-- CreateIndex
CREATE INDEX "CreditNote_reason_idx" ON "CreditNote"("reason");

-- CreateIndex
CREATE INDEX "TaxDetermination_billingProfileId_determinedAt_idx" ON "TaxDetermination"("billingProfileId", "determinedAt");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_billingProfileId_fkey" FOREIGN KEY ("billingProfileId") REFERENCES "BillingProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_taxDeterminationId_fkey" FOREIGN KEY ("taxDeterminationId") REFERENCES "TaxDetermination"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

