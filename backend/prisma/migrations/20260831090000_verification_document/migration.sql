-- Storage for the licence document behind a verification request.
--
-- VerificationRequest.docName / docUrl already existed and were never written:
-- the Pharmacy Portal had no upload control and its submit path never set them,
-- so every self-submitted request reached the Verification Center reading
-- "No document" with a dead View File link.
--
-- The bytes live in their own table so they are never pulled into the list
-- queries the Verification Center runs, and in the database rather than on disk
-- because the API is redeployed as a container — a file written to the
-- filesystem would not survive that.
CREATE TABLE "VerificationDocument" (
    "id" TEXT NOT NULL,
    "verificationRequestId" TEXT NOT NULL,
    "pharmacyId" TEXT,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VerificationDocument_verificationRequestId_key"
  ON "VerificationDocument"("verificationRequestId");

CREATE INDEX "VerificationDocument_pharmacyId_idx" ON "VerificationDocument"("pharmacyId");

ALTER TABLE "VerificationDocument"
  ADD CONSTRAINT "VerificationDocument_verificationRequestId_fkey"
  FOREIGN KEY ("verificationRequestId") REFERENCES "VerificationRequest"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VerificationDocument"
  ADD CONSTRAINT "VerificationDocument_pharmacyId_fkey"
  FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
