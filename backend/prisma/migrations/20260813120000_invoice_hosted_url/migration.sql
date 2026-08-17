-- Adds the provider-hosted payment page URL so an unpaid invoice is actionable.

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "hostedInvoiceUrl" TEXT;

