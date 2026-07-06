-- Migration 018: monthly Gross Income input for percentage-based budgeting.
-- One row per user/year/month; missing months carry forward the latest prior
-- value (handled in the route, not here), so the user only edits it when
-- their income actually changes.

CREATE TABLE IF NOT EXISTS income_plans (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year             INT  NOT NULL,
  month            INT  NOT NULL CHECK (month BETWEEN 1 AND 12),
  gross_income_kes NUMERIC(18,4) NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, year, month)
);
CREATE INDEX IF NOT EXISTS idx_income_plans_user_ym ON income_plans(user_id, year, month);
