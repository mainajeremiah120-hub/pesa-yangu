-- Migration 005: Add is_active to users if missing (backfill for pre-migration DBs)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
