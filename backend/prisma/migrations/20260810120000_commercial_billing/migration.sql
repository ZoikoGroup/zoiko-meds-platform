-- ZM-COM-BILL-001 v1.0 — commercial billing, subscriptions & participation.
--
-- Additive only: one new column on Pharmacy plus new tables and enums. No
-- existing column is altered or dropped, so this is safe to apply to a live
-- database ahead of any billing being switched on.
-- CreateEnum
CREATE TYPE "CommercialClassification" AS ENUM ('DIRECTORY_UNCLAIMED', 'CLAIMED_PENDING', 'VERIFICATION_IN_REVIEW', 'VERIFIED_NETWORK_CORE', 'PRO_EVALUATION', 'PRO_ACTIVE', 'ENTERPRISE_CONTRACT_ACTIVE', 'PILOT_NON_BILLABLE', 'INTERNAL', 'DEMO', 'QA', 'STAGING', 'PARTNER_SANDBOX', 'SUSPENDED_COMPLIANCE', 'REJECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CommercialOffer" AS ENUM ('PATIENT_CAREGIVER_ACCESS', 'PHARMACY_NETWORK_CORE', 'PHARMACY_INTELLIGENCE_PRO', 'ENTERPRISE_API_DATA');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTH', 'YEAR', 'CONTRACT_DEFINED');

-- CreateEnum
CREATE TYPE "BillingChannel" AS ENUM ('WEB_SELF_SERVE', 'SALES_CONTRACT', 'MOBILE_COMPANION_ENTITLEMENT');

-- CreateEnum
CREATE TYPE "SubscriptionState" AS ENUM ('EVALUATION', 'ACTIVE', 'PAST_DUE', 'EXPANSION_BLOCKED', 'PAID_FEATURES_RESTRICTED', 'CANCELED', 'ELIGIBILITY_RESTRICTED');

-- CreateEnum
CREATE TYPE "UsageExclusionReason" AS ENUM ('PLATFORM_ERROR', 'CLIENT_ERROR', 'DUPLICATE', 'DENIED_BY_POLICY', 'CANCELED', 'NOT_METERED', 'SYNC_OR_PARSE_FAILURE');

-- CreateEnum
CREATE TYPE "BillingCapability" AS ENUM ('VIEW_PLAN_AND_USAGE', 'MANAGE_PAYMENT_METHODS', 'CHANGE_PLAN', 'CANCEL_SUBSCRIPTION', 'APPROVE_REFUND_OR_CREDIT', 'MANAGE_DISCOUNTS_AND_ADDONS', 'VIEW_INVOICES', 'MANAGE_PRICE_CATALOG', 'GRANT_CAPABILITIES');

-- AlterTable
ALTER TABLE "Pharmacy" ADD COLUMN     "commercialClassification" "CommercialClassification" NOT NULL DEFAULT 'DIRECTORY_UNCLAIMED';

-- CreateTable
CREATE TABLE "CapabilityGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "capability" "BillingCapability" NOT NULL,
    "billingProfileId" TEXT,
    "scopeKey" TEXT NOT NULL DEFAULT 'PLATFORM',
    "grantedById" TEXT,
    "reason" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CapabilityGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceCatalogEntry" (
    "id" TEXT NOT NULL,
    "offer" "CommercialOffer" NOT NULL,
    "market" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "interval" "BillingInterval" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "channel" "BillingChannel" NOT NULL,
    "catalogVersion" TEXT NOT NULL,
    "providerProductId" TEXT,
    "providerPriceId" TEXT,
    "taxBehavior" TEXT NOT NULL DEFAULT 'UNSPECIFIED',
    "approvalReference" TEXT NOT NULL,
    "legalTermsVersion" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceCatalogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingProfile" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "merchantEntity" TEXT,
    "billingEmail" TEXT NOT NULL,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "taxId" TEXT,
    "taxExempt" BOOLEAN NOT NULL DEFAULT false,
    "providerCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "billingProfileId" TEXT NOT NULL,
    "offer" "CommercialOffer" NOT NULL,
    "state" "SubscriptionState" NOT NULL,
    "channel" "BillingChannel" NOT NULL,
    "priceCatalogEntryId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "commercialEffectiveAt" TIMESTAMP(3) NOT NULL,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "evaluationEndsAt" TIMESTAMP(3),
    "paymentFailedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "contractReference" TEXT,
    "usageBillingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "includedUsageUnits" INTEGER,
    "usageRateCardVersion" TEXT,
    "providerSubscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionLocation" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "prorationAmountMinor" INTEGER,
    "providerInvoiceReference" TEXT,

    CONSTRAINT "SubscriptionLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL,
    "billingProfileId" TEXT,
    "subscriptionId" TEXT,
    "metricCode" TEXT NOT NULL,
    "endpointClass" TEXT,
    "requestId" TEXT,
    "responseStatus" INTEGER,
    "countableUnits" INTEGER NOT NULL DEFAULT 0,
    "exclusionReason" "UsageExclusionReason",
    "rateCardVersion" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CapabilityGrant_userId_revokedAt_idx" ON "CapabilityGrant"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CapabilityGrant_userId_capability_scopeKey_key" ON "CapabilityGrant"("userId", "capability", "scopeKey");

-- CreateIndex
CREATE INDEX "PriceCatalogEntry_offer_market_currency_interval_effectiveF_idx" ON "PriceCatalogEntry"("offer", "market", "currency", "interval", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PriceCatalogEntry_offer_market_currency_interval_channel_ca_key" ON "PriceCatalogEntry"("offer", "market", "currency", "interval", "channel", "catalogVersion");

-- CreateIndex
CREATE INDEX "BillingProfile_country_idx" ON "BillingProfile"("country");

-- CreateIndex
CREATE INDEX "Subscription_state_idx" ON "Subscription"("state");

-- CreateIndex
CREATE INDEX "Subscription_offer_state_idx" ON "Subscription"("offer", "state");

-- CreateIndex
CREATE INDEX "SubscriptionLocation_pharmacyId_idx" ON "SubscriptionLocation"("pharmacyId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionLocation_subscriptionId_pharmacyId_key" ON "SubscriptionLocation"("subscriptionId", "pharmacyId");

-- CreateIndex
CREATE UNIQUE INDEX "UsageEvent_idempotencyKey_key" ON "UsageEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "UsageEvent_billingProfileId_occurredAt_idx" ON "UsageEvent"("billingProfileId", "occurredAt");

-- CreateIndex
CREATE INDEX "UsageEvent_metricCode_occurredAt_idx" ON "UsageEvent"("metricCode", "occurredAt");

-- AddForeignKey
ALTER TABLE "CapabilityGrant" ADD CONSTRAINT "CapabilityGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapabilityGrant" ADD CONSTRAINT "CapabilityGrant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_billingProfileId_fkey" FOREIGN KEY ("billingProfileId") REFERENCES "BillingProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_priceCatalogEntryId_fkey" FOREIGN KEY ("priceCatalogEntryId") REFERENCES "PriceCatalogEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionLocation" ADD CONSTRAINT "SubscriptionLocation_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionLocation" ADD CONSTRAINT "SubscriptionLocation_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_billingProfileId_fkey" FOREIGN KEY ("billingProfileId") REFERENCES "BillingProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: map existing eligibility onto a commercial classification.
--
-- Every target below is a NON-BILLABLE state. Doctrine S-Q1 requires that a
-- preloaded or pre-commercial pharmacy record can never become a paying customer
-- merely because billing launched, so nothing here lands on PRO_ACTIVE or
-- ENTERPRISE_CONTRACT_ACTIVE — those are reachable only through an explicit,
-- audited commercial conversion.
UPDATE "Pharmacy" SET "commercialClassification" = 'VERIFIED_NETWORK_CORE'
  WHERE "verificationStatus" = 'VERIFIED';

UPDATE "Pharmacy" SET "commercialClassification" = 'VERIFICATION_IN_REVIEW'
  WHERE "verificationStatus" IN ('PENDING', 'INFO_REQUESTED');

UPDATE "Pharmacy" SET "commercialClassification" = 'SUSPENDED_COMPLIANCE'
  WHERE "verificationStatus" = 'SUSPENDED';

UPDATE "Pharmacy" SET "commercialClassification" = 'REJECTED'
  WHERE "verificationStatus" = 'REJECTED';
-- UNVERIFIED keeps the DIRECTORY_UNCLAIMED default.
