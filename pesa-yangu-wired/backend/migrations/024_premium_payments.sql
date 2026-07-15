-- Migration 024: Insurance premium repayment tracking.
-- Premiums were "set it and forget it" — a premium_amount/frequency on the
-- policy and a manually-typed amount_paid with no real ledger behind it.
-- This adds a real payment history (mirrors loan_repayments) so "amount
-- paid so far" and "balance" can be derived from what was actually paid,
-- and each payment shows up as a real expense transaction.

CREATE TABLE IF NOT EXISTS premium_payments (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id     UUID          NOT NULL REFERENCES insurance_policies(id) ON DELETE CASCADE,
  user_id       UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id     UUID          REFERENCES wallets(id) ON DELETE SET NULL,
  amount_kes    NUMERIC(18,4) NOT NULL,
  payment_date  DATE          NOT NULL DEFAULT CURRENT_DATE,
  note          TEXT,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_premium_payments_policy ON premium_payments(policy_id);

-- Same pattern as investment_return_id (migration 023): link the expense
-- transaction a payment creates back to the payment row, CASCADE so
-- deleting/reversing a payment cleans up its ledger entry automatically.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS premium_payment_id UUID REFERENCES premium_payments(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_tx_premium_payment ON transactions(premium_payment_id);

-- Backfill the "Premium" expense category for every existing user (new
-- signups get it via defaultCategories.js going forward).
INSERT INTO categories (user_id, name, type, icon, color, budget_kes, watch, is_system, sort_order)
SELECT u.id, 'Premium', 'expense', '🛡️', '#16A085', 0, false, true,
  COALESCE((SELECT MAX(sort_order)+1 FROM categories WHERE user_id = u.id), 0)
FROM users u
ON CONFLICT (user_id, name, type) DO NOTHING;
