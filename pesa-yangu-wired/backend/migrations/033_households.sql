-- Migration 033: Linked household accounts (couples sharing).
-- Two separate logins can link so both resolve to the same effective
-- data-owner id for every financial query (see requireAuth's
-- req.dataOwnerId), while keeping their own separate email/password/
-- profile/billing/support/AI-chat identity. Pure-additive — no existing
-- table's shape changes.

CREATE TABLE IF NOT EXISTS households (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS household_invites (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id       UUID        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  code               TEXT        NOT NULL UNIQUE,
  created_by_user_id UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at         TIMESTAMPTZ NOT NULL,
  used_at            TIMESTAMPTZ,
  used_by_user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_household_invites_household ON household_invites(household_id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS household_id UUID REFERENCES households(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_household ON users(household_id);
