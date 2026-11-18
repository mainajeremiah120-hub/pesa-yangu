-- Migration 037: borrower contact details + automatic compound interest for
-- loans given out, bringing them to parity with the borrowed-loan feature.
--
-- Contact fields are plain optional text, same pattern as loans.lender —
-- no uniqueness/format constraint, just a place to keep a phone number and
-- an ID so the borrower can be identified or reached later.
--
-- Interest accrual mirrors migration 029 exactly, one table per direction:
-- Simple-interest loans given still fix their total at creation (unchanged).
-- Compound ones previously only ever shrank via repayments — interest_rate
-- was purely informational. This adds the same automatic monthly charge
-- (added to remaining_kes) that compound BORROWED loans already get.
-- UNIQUE(loan_given_id, period) is the same idempotency guard as 029: the
-- scheduled job can run more than once (e.g. after a redeploy) without
-- double-charging the same month.

ALTER TABLE loans_given ADD COLUMN IF NOT EXISTS borrower_phone     TEXT;
ALTER TABLE loans_given ADD COLUMN IF NOT EXISTS borrower_id_number TEXT;

CREATE TABLE IF NOT EXISTS loan_given_interest_accruals (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  loan_given_id UUID          NOT NULL REFERENCES loans_given(id) ON DELETE CASCADE,
  user_id       UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_kes    NUMERIC(18,4) NOT NULL,
  period        DATE          NOT NULL, -- first day of the month this charge is for
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (loan_given_id, period)
);
CREATE INDEX IF NOT EXISTS idx_loan_given_accrual_loan ON loan_given_interest_accruals(loan_given_id);
