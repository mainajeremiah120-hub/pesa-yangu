-- Migration 020: link a category to a wallet, making it a "Primary" income
-- allocation instead of an expense — recording money against it is a
-- transfer into that wallet (see backend/src/routes/wallets.js POST /transfer),
-- not spending, so it stays out of every expense-based calculation for free.

ALTER TABLE categories ADD COLUMN IF NOT EXISTS linked_wallet_id UUID REFERENCES wallets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_categories_linked_wallet ON categories(linked_wallet_id);
