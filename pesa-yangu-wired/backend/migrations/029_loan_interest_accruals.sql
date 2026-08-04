-- Migration 029: automatic monthly interest accrual for Compound-interest loans.
-- Simple-interest loans fix their total at creation (unaffected). Compound
-- loans previously only ever shrank via repayments — the interest_rate field
-- was purely informational. This adds a record of each month's automatically
-- calculated interest charge, added to the loan's remaining_kes at the end
-- of the month it applies to.
--
-- UNIQUE(loan_id, period) is the idempotency guard: the scheduled job can
-- safely run more than once (e.g. after a redeploy) without double-charging
-- the same month — a repeat INSERT for the same (loan, period) just no-ops.
CREATE TABLE IF NOT EXISTS loan_interest_accruals (
  id         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id    UUID          NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  user_id    UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_kes NUMERIC(18,4) NOT NULL,
  period     DATE          NOT NULL, -- first day of the month this charge is for
  created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (loan_id, period)
);
CREATE INDEX IF NOT EXISTS idx_loan_interest_accruals_loan ON loan_interest_accruals(loan_id);
