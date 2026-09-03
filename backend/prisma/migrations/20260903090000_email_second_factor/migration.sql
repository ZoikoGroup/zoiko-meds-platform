-- Opt-in emailed sign-in link as a second factor (MSA-42).
--
-- Defaults to false, so every existing account signs in exactly as it did
-- before this migration ran. Turning it on is the member's own decision, taken
-- on their profile; nothing sets it on their behalf.
ALTER TABLE "User" ADD COLUMN "mfaEmailEnabled" BOOLEAN NOT NULL DEFAULT false;
