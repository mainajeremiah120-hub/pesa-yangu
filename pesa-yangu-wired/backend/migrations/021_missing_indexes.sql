-- Migration 021: missing indexes on wallet_id / user_id foreign-key columns,
-- flagged by a performance audit. Every wallet delete checks these five
-- tables for linked records (backend/src/routes/wallets.js DELETE /:id) via
-- a sequential scan today; insurance_policies was the one table missing its
-- user_id index that every other table already has.

CREATE INDEX IF NOT EXISTS idx_goals_wallet              ON goals(wallet_id);
CREATE INDEX IF NOT EXISTS idx_investments_wallet         ON investments(wallet_id);
CREATE INDEX IF NOT EXISTS idx_investment_returns_wallet  ON investment_returns(wallet_id);
CREATE INDEX IF NOT EXISTS idx_loan_repayments_wallet     ON loan_repayments(wallet_id);
CREATE INDEX IF NOT EXISTS idx_recurring_wallet           ON recurring_transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_insurance_policies_user    ON insurance_policies(user_id);
-- Composite index so the budget endpoints' date-range rewrite (see
-- 022_*.sql-adjacent route changes) can use an index scan instead of a
-- sequential scan when filtering a user's transactions by month.
CREATE INDEX IF NOT EXISTS idx_tx_user_date ON transactions(user_id, tx_date);
