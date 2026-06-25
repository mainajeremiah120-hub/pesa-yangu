-- Add loan term (duration in months) to loans table
ALTER TABLE loans ADD COLUMN IF NOT EXISTS term_months INTEGER;
