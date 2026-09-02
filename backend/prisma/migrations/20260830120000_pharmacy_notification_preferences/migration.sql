-- Pharmacy-portal notification preferences.
--
-- The settings page has always drawn its four switches from React state: they
-- flipped, flashed "saved", and were gone on the next navigation. Nothing was
-- ever stored, so nothing could be enforced either — a member who switched
-- system messages off still received them.
--
-- Defaults are all true so every existing account keeps the behaviour it has
-- today. A missing row is read the same way (see PharmacyNotificationPreference
-- in schema.prisma): absent means everything on, never "notify nobody".
CREATE TABLE "PharmacyNotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inventoryAlerts" BOOLEAN NOT NULL DEFAULT true,
    "verificationUpdates" BOOLEAN NOT NULL DEFAULT true,
    "uploadResults" BOOLEAN NOT NULL DEFAULT true,
    "systemMessages" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PharmacyNotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PharmacyNotificationPreference_userId_key" ON "PharmacyNotificationPreference"("userId");

ALTER TABLE "PharmacyNotificationPreference"
  ADD CONSTRAINT "PharmacyNotificationPreference_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
