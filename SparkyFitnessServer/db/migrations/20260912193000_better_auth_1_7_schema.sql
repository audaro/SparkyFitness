-- Better Auth 1.5 -> 1.7 schema catch-up.
--
-- Derived from `npx auth@1.7.4 generate`, then corrected in three places the
-- generator could not know about:
--   1. it emitted `text` for the new id columns, but every Better Auth id in
--      this database is `uuid` (see session.user_id), so the foreign keys it
--      produced would not have been creatable;
--   2. it emitted `not null` on sso_provider.user_id, which would abort the
--      migration for any install that already has an SSO provider row -- the
--      column is left nullable because env-configured providers have no owning
--      user (this trades a startup "declared required but nullable" warning,
--      the same one secret/backup_codes/config_id already produce, for an
--      upgrade that does not break existing self-hosters);
--   3. the generator explicitly cannot fix sso_provider.client_id -- see below.

-- Admin plugin: records which admin is impersonating a session.
ALTER TABLE "session"
  ADD COLUMN IF NOT EXISTS "impersonated_by" uuid
  REFERENCES "user" ("id") ON DELETE SET NULL;

-- Two-factor plugin gained a TOTP lockout / re-enrolment guard in 1.7. Every
-- verification reads locked_until and increments failed_verification_count, so
-- without these columns TOTP and email-OTP sign-in fail outright.
--
-- `verified` defaults to true so that anyone already enrolled stays enrolled:
-- the enable endpoint now refuses to overwrite an authenticator whose row is
-- not explicitly `verified = false`, and a false backfill would also let a
-- second enrolment silently replace an existing authenticator.
ALTER TABLE "two_factor"
  ADD COLUMN IF NOT EXISTS "verified" boolean NOT NULL DEFAULT true;
ALTER TABLE "two_factor"
  ADD COLUMN IF NOT EXISTS "failed_verification_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "two_factor"
  ADD COLUMN IF NOT EXISTS "locked_until" timestamptz;

-- SSO plugin: SAML support, plus provider ownership.
ALTER TABLE "sso_provider"
  ADD COLUMN IF NOT EXISTS "saml_config" text;
ALTER TABLE "sso_provider"
  ADD COLUMN IF NOT EXISTS "user_id" uuid
  REFERENCES "user" ("id") ON DELETE CASCADE;
ALTER TABLE "sso_provider"
  ADD COLUMN IF NOT EXISTS "organization_id" text;

-- Credential accounts must key on the user's id, not their email.
--
-- Better Auth's email sign-in resolves the password row with
--   providerId === 'credential' && accountId === user.id
-- Up to 1.6 the accountId half was not checked, so rows written by this repo's
-- own createUser/demo-seed paths (which stored the email) still authenticated.
-- On 1.7 they no longer match and sign-in fails with "User not found" even
-- though the account row and its bcrypt hash are perfectly valid.
--
-- Scoped to provider_id = 'credential' on purpose: social and OIDC rows
-- correctly store the provider's own subject in account_id and must not be
-- touched.
UPDATE "account"
   SET account_id = user_id::text,
       updated_at = NOW()
 WHERE provider_id = 'credential'
   AND account_id IS DISTINCT FROM user_id::text;

-- 1.7 moved the OIDC client id inside the oidc_config payload and stopped
-- writing this top-level column, so a NOT NULL constraint here rejects every
-- insert Better Auth makes ("Inserts into sso_provider will fail" at startup).
-- Existing rows keep their value; only the constraint is dropped.
ALTER TABLE "sso_provider"
  ALTER COLUMN "client_id" DROP NOT NULL;
