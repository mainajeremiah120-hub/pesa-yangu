-- Migration 031: CSV import idempotency.
-- POST /transactions/import had no way to detect a re-upload of the same
-- file (e.g. after a UI timeout, or someone re-clicking "Import") — every
-- retry silently double-imported every row and double-applied every wallet
-- balance change. This table lets the import route recognize "I just
-- imported this exact file for this user a moment ago" and reject the
-- repeat instead of quietly duplicating the data.

CREATE TABLE IF NOT EXISTS import_batches (
  id         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_hash  TEXT          NOT NULL,
  row_count  INT           NOT NULL,
  created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_import_batches_user_hash ON import_batches(user_id, file_hash);
