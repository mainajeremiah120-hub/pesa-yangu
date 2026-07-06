-- Migration 017: category hierarchy + percentage-based allocation
-- Existing rows default to allocation_type='fixed', parent_id=NULL — identical
-- semantics to today's flat Manual budgeting, so this is a no-op for them.

ALTER TABLE categories ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES categories(id) ON DELETE RESTRICT;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS allocation_type TEXT NOT NULL DEFAULT 'fixed';
ALTER TABLE categories ADD COLUMN IF NOT EXISTS percent_of_parent NUMERIC(6,3);
ALTER TABLE categories ADD COLUMN IF NOT EXISTS spend_kind TEXT;

ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_allocation_type_check;
ALTER TABLE categories ADD CONSTRAINT categories_allocation_type_check CHECK (allocation_type IN ('fixed','percent'));

ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_spend_kind_check;
ALTER TABLE categories ADD CONSTRAINT categories_spend_kind_check CHECK (spend_kind IS NULL OR spend_kind IN ('fixed','variable'));

ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_percent_range_check;
ALTER TABLE categories ADD CONSTRAINT categories_percent_range_check CHECK (percent_of_parent IS NULL OR (percent_of_parent >= 0 AND percent_of_parent <= 100));

ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_percent_consistency_check;
ALTER TABLE categories ADD CONSTRAINT categories_percent_consistency_check CHECK (
  (allocation_type = 'percent' AND percent_of_parent IS NOT NULL) OR
  (allocation_type = 'fixed'   AND percent_of_parent IS NULL)
);

ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_no_self_parent_check;
ALTER TABLE categories ADD CONSTRAINT categories_no_self_parent_check CHECK (id <> parent_id);

CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);
