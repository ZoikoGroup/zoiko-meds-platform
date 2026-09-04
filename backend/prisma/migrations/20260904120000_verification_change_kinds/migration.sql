-- What the pharmacy actually did in the save that raised a request.
--
-- Recorded rather than derived: a document on a request may be one the pharmacy
-- just uploaded or one carried forward so the reviewer is not left with nothing,
-- and those are indistinguishable afterwards. A resubmission answering a
-- REQUEST_INFO also overwrites that status with PENDING, erasing the only trace
-- that the pharmacy was replying to a question.
CREATE TYPE "VerificationChangeKind" AS ENUM (
  'DOCUMENT_SUBMITTED',
  'DOCUMENT_REPLACED',
  'PHARMACY_NAME_CHANGED',
  'LICENCE_NUMBER_CHANGED',
  'PROFILE_DETAILS_CHANGED',
  'REQUEST_INFO_RESPONSE'
);

-- Empty for every request that already exists. The reviewer-facing summary
-- reports "not recorded" for those rather than inferring a type it cannot know,
-- so no historical row is relabelled by this migration.
ALTER TABLE "VerificationRequest"
  ADD COLUMN "changeKinds" "VerificationChangeKind"[] DEFAULT ARRAY[]::"VerificationChangeKind"[];

-- The filename this request carried before a replacement overwrote it. Name
-- only: the previous bytes are genuinely gone, and a link to them would be a
-- link to nothing.
ALTER TABLE "VerificationRequest"
  ADD COLUMN "previousDocName" TEXT;
