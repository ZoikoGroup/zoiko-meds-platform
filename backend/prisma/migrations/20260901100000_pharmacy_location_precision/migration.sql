-- How precisely a pharmacy's pin locates the shop.
--
-- Until now a pharmacy either had coordinates or it did not, and an address
-- that could only be resolved to a city centroid was stored as no coordinates
-- at all. That is precise but unhelpful: a pharmacy with no pin is dropped by
-- every distance-bounded patient search, so a shop whose address is "Delhi,
-- 110006" was invisible to every patient in Delhi. Recording HOW precise the
-- pin is lets the area-level answer be stored and used, and labelled as rough
-- wherever a distance is shown.
CREATE TYPE "LocationPrecision" AS ENUM ('EXACT', 'APPROXIMATE');

ALTER TABLE "Pharmacy" ADD COLUMN "locationPrecision" "LocationPrecision";

-- How precise the pins already in the table are cannot be known from here: the
-- column recording it is the one being added. So it is inferred from the only
-- evidence the row carries — whether anyone ever gave it a street address.
--
-- A pharmacy with a street line was either geocoded from that line or pinned by
-- its operator, both of which are EXACT. A pharmacy located with nothing but a
-- city and a postcode was placed from an area however the pin was produced, and
-- calling that EXACT would print a distance to a tenth of a kilometre for a
-- point in the middle of a district.
--
-- The asymmetry is deliberate: an EXACT pin wrongly labelled APPROXIMATE only
-- rounds its distance, while an APPROXIMATE pin labelled EXACT tells a patient
-- a shop is somewhere it is not. Operators correct their own on the next save.
UPDATE "Pharmacy"
SET "locationPrecision" = CASE
  WHEN COALESCE(TRIM("addressLine1"), '') <> '' THEN 'EXACT'::"LocationPrecision"
  ELSE 'APPROXIMATE'::"LocationPrecision"
END
WHERE "latitude" IS NOT NULL AND "longitude" IS NOT NULL;
