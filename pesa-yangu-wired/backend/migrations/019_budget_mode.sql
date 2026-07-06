-- Migration 019: per-account budgeting style — Manual (today's flat categories,
-- default, zero behaviour change) or Percentage (new hierarchical allocation).

ALTER TABLE users ADD COLUMN IF NOT EXISTS budget_mode TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_budget_mode_check;
ALTER TABLE users ADD CONSTRAINT users_budget_mode_check CHECK (budget_mode IN ('manual','percentage'));
