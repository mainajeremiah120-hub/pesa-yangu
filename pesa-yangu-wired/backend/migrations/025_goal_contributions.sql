-- Migration 025: Real money movement for Savings Goals.
-- Funding a goal used to just decrement the source wallet and bump an
-- abstract goals.saved_kes counter — the receiving wallet's balance never
-- moved, nothing was written to `transactions`, and there was no per-goal
-- contribution history to show, edit, or delete.
--
-- goal_contributions is the real ledger (mirrors loan_repayments /
-- investment_returns / premium_payments): each row is one top-up, moving
-- money from a (flexible, chosen per-contribution) source wallet into the
-- goal's receiving wallet (goals.wallet_id). The transfer_out/transfer_in
-- pair it creates in `transactions` is what makes it show up on both
-- wallets' statements automatically.

CREATE TABLE IF NOT EXISTS goal_contributions (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id          UUID          NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  user_id          UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_wallet_id   UUID          REFERENCES wallets(id) ON DELETE SET NULL,
  to_wallet_id     UUID          REFERENCES wallets(id) ON DELETE SET NULL,
  amount_kes       NUMERIC(18,4) NOT NULL,
  contributed_date DATE          NOT NULL DEFAULT CURRENT_DATE,
  note             TEXT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_goal_contributions_goal ON goal_contributions(goal_id);

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS goal_contribution_id UUID REFERENCES goal_contributions(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_tx_goal_contribution ON transactions(goal_contribution_id);
