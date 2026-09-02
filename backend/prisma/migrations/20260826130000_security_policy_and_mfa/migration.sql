-- Workspace security policy, and TOTP enrolment (MSA-42).
--
-- The settings page carried three switches bound to component state: enforce
-- MFA, SSO, IP allowlist. These are the columns the auth path reads to make two
-- of them real, and to say plainly that SAML is not among them.
--
-- Every default is the behaviour already in force before this table had an
-- opinion, so applying this changes nothing until somebody sets a policy.

-- Organization is the single-row settings table added by
-- 20260826120000_organization_profile, which also seeds the one row, so these
-- defaults land on an existing row rather than waiting for a first write.
ALTER TABLE "Organization"
  -- Enforced in AuthService.login against each account's enrolment: a member who
  -- has not enrolled is refused a session rather than let in on the password.
  ADD COLUMN "requireMfa" BOOLEAN NOT NULL DEFAULT false,
  -- Separate from the list being empty on purpose. Switching the allowlist on
  -- with nothing in it would deny the very request that adds the first entry —
  -- including the one that would switch it back off — so the guard reads that
  -- combination as "not configured yet" rather than "deny everything".
  ADD COLUMN "ipAllowlistEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ipAllowlist" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- Enforced in AuthService.oauthLogin, before an account is provisioned, so a
  -- workspace with sign-on switched off does not quietly accumulate accounts it
  -- will never admit.
  ADD COLUMN "allowOauthSignIn" BOOLEAN NOT NULL DEFAULT true;

-- TOTP enrolment.
--
-- Two columns rather than one flag, because a secret exists from the moment
-- setup begins and an enrolment begun and abandoned must not count as a second
-- factor. mfaEnabledAt is written only once a code has been proved against the
-- secret, and it alone is what makes a code required at sign-in — so opening the
-- setup panel and closing the tab cannot lock somebody out of their account.
ALTER TABLE "User"
  ADD COLUMN "mfaSecret" TEXT,
  ADD COLUMN "mfaEnabledAt" TIMESTAMP(3);
