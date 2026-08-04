-- Migration 028: link loan repayments to their ledger transaction.
-- Same pattern as investment_return_id (023), premium_payment_id (024), and
-- goal_contribution_id (025): editing or deleting a loan repayment had no
-- way to find and update/remove the transaction row it created, since
-- transactions.loan_id only points at the LOAN, not at a specific
-- repayment. That left stale/orphaned entries in Records after any edit or
-- delete. ON DELETE CASCADE means deleting a repayment now also removes its
-- transaction automatically — existing repayments created before this
-- migration won't have this link (their transactions were never traceable
-- to begin with), but everything going forward does.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS loan_repayment_id UUID REFERENCES loan_repayments(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_tx_loan_repayment ON transactions(loan_repayment_id);
