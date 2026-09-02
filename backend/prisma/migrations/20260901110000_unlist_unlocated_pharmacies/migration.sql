-- Stop listing pharmacies that no patient can be shown.
--
-- Verification and publication used to be one write: approving a licence set
-- verificationStatus = VERIFIED and isParticipating = true together. They are
-- different judgements, and fusing them published records nobody could find. A
-- verification request that arrives without a pharmacy row creates one with no
-- address and no coordinates; approving the licence then marked it
-- participating, so it counted as part of the verified network while every
-- distance-bounded patient search dropped it for having no pin.
--
-- canParticipate() now derives the flag from VERIFIED *and* located, and every
-- write path goes through it. This brings the rows already in the table to the
-- same answer, rather than leaving them inconsistent until something happens to
-- touch them.
--
-- Nothing is un-verified here. The licence stays approved on its own merits;
-- only the listing is withdrawn, and it comes back by itself the moment the
-- pharmacy has a location — the operator saving a maps link, or a reviewer
-- setting the pin from the console, both re-derive it.
UPDATE "Pharmacy"
SET "isParticipating" = false
WHERE "isParticipating" = true
  AND ("latitude" IS NULL OR "longitude" IS NULL);
