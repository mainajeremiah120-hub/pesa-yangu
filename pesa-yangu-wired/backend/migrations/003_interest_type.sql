-- Migration 003: Add interest_type to loans
ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS interest_type TEXT NOT NULL DEFAULT 'compound'
  CHECK (interest_type IN ('simple', 'compound'));
