-- Migration 023: Link transactions created from investment returns back to the
-- investment_returns row that produced them, so deleting a return (or an
-- entire investment) also removes its ledger entry instead of leaving an
-- orphaned income transaction behind after the wallet credit is reversed.

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS investment_return_id UUID REFERENCES investment_returns(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_tx_investment_return ON transactions(investment_return_id);
