-- The workspace's own profile (MSA-40).
--
-- The settings page rendered "Meridian Health Network / org-meridian / North
-- America (us-east)" to every super admin, and its Save button had no handler,
-- because nothing in the schema could hold the answer. This is that table.
--
-- One row, addressed by a fixed primary key. A CHECK constraint would say so in
-- the database too, but Prisma cannot express one, so `migrate diff` would read
-- it as drift on every run of the schema-reproduction check. The single row is
-- held by OrganizationService, which addresses no other id.
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "dataResidency" TEXT,
    "organizationType" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- SET NULL, not CASCADE: deleting the administrator who last saved the profile
-- must not delete the organization.
ALTER TABLE "Organization"
  ADD CONSTRAINT "Organization_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Seeded here rather than lazily on first read, so every deployment answers the
-- settings page from the same place and the first GET is not a write.
INSERT INTO "Organization" ("id", "name", "slug", "updatedAt")
VALUES ('singleton', 'ZoikoMeds', 'zoikomeds', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
