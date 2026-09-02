-- Scoped keys for the ZoikoAvail availability API (MSA-41 follow-up).
--
-- The settings page listed keys from a frontend fixture, with Reveal, Rotate and
-- Revoke actions behind them that had no handlers and no endpoint — every
-- deployment's super admin was shown the same three invented keys.
--
-- Only the hash is stored, so a key is shown in full exactly once. keyPrefix is
-- kept for display: enough to tell two keys apart in a list, never enough to
-- reconstruct one.
CREATE TABLE "PlatformApiKey" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    -- Revoking sets this rather than deleting the row: a revoked key still has
    -- to be nameable in the audit trail, and its hash must stay claimed so the
    -- same key can never be issued twice.
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformApiKey_pkey" PRIMARY KEY ("id")
);

-- Unique, because a collision would mean two keys authenticating as each other.
CREATE UNIQUE INDEX "PlatformApiKey_keyHash_key" ON "PlatformApiKey"("keyHash");

-- The console lists live keys first, which is a scan over this.
CREATE INDEX "PlatformApiKey_revokedAt_idx" ON "PlatformApiKey"("revokedAt");

-- SET NULL, not CASCADE: removing the administrator who issued a key must not
-- delete the key, which is very likely still in use by something.
ALTER TABLE "PlatformApiKey"
  ADD CONSTRAINT "PlatformApiKey_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
