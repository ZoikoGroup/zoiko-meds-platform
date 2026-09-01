-- Withdraw the workspace IP allowlist (MSA-42).
--
-- The control worked, which was the problem. An operator saved a subnet mask as
-- though it were a range, switched it on, and the guard then refused every
-- request from an address outside the list — including the console session of
-- the one account that could have switched it back off. Recovering meant a
-- direct write to this table.
--
-- Dropping the columns is what makes that unrepeatable. Leaving them while the
-- guard goes would keep a stored "restricted" that nothing enforces, which is
-- the same class of lie the original MSA-42 switches told. Network restriction
-- belongs at the load balancer, where locking yourself out does not also take
-- away the means to undo it.
ALTER TABLE "Organization" DROP COLUMN IF EXISTS "ipAllowlistEnabled";
ALTER TABLE "Organization" DROP COLUMN IF EXISTS "ipAllowlist";
