-- Migration 022: Windfall Rules (a separate one-off % split, distinct from
-- the monthly Gross Income cascade) and Goal targets (a savings target +
-- deadline on a Primary category, progress read from its linked wallet's
-- balance), plus a PIN lock for the app.

ALTER TABLE categories ADD COLUMN IF NOT EXISTS windfall_percent NUMERIC(6,3);
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_windfall_percent_range_check;
ALTER TABLE categories ADD CONSTRAINT categories_windfall_percent_range_check CHECK (windfall_percent IS NULL OR (windfall_percent >= 0 AND windfall_percent <= 100));

ALTER TABLE categories ADD COLUMN IF NOT EXISTS goal_target_kes NUMERIC(18,4);
ALTER TABLE categories ADD COLUMN IF NOT EXISTS goal_deadline DATE;

ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_hash TEXT;
