-- Migration 036: money the user LENDS OUT to someone else.
-- The existing `loans` table only models money the user BORROWED (a
-- liability) — repayments there are recorded as an 'expense' transaction on
-- purpose, since paying back debt really is money leaving for good. Money
-- the user hands to someone else isn't an expense: it's still the user's
-- asset, just temporarily held as a receivable instead of cash, so it must
-- never show up in expense totals/budgets. Mirrors `loans`/`loan_repayments`
-- structurally, but handing out the loan and receiving it back are both
-- modeled as plain transfer_out/transfer_in transactions (same bucket
-- already used for wallet-to-wallet transfers and goal contributions, which
-- are excluded from expense/income reports) so wallet balances stay exactly
-- right without ever touching a budget category.

CREATE TABLE IF NOT EXISTS loans_given (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id     UUID          NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  borrower_name TEXT          NOT NULL,
  currency      TEXT          NOT NULL DEFAULT 'KES',
  principal_kes NUMERIC(18,4) NOT NULL CHECK (principal_kes > 0),
  remaining_kes NUMERIC(18,4) NOT NULL CHECK (remaining_kes >= 0),
  interest_rate NUMERIC(6,3)  NOT NULL DEFAULT 0,
  interest_type TEXT          NOT NULL DEFAULT 'simple' CHECK (interest_type IN ('simple','compound')),
  term_months   INTEGER,
  due_date      DATE,
  note          TEXT,
  is_settled    BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_loans_given_user ON loans_given(user_id);

CREATE TABLE IF NOT EXISTS loan_given_repayments (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  loan_given_id UUID          NOT NULL REFERENCES loans_given(id) ON DELETE CASCADE,
  user_id       UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id     UUID          NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  total_kes     NUMERIC(18,4) NOT NULL CHECK (total_kes > 0),
  principal_kes NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (principal_kes >= 0),
  interest_kes  NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (interest_kes >= 0),
  payment_date  DATE          NOT NULL DEFAULT CURRENT_DATE,
  note          TEXT,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_loan_given_repay_loan ON loan_given_repayments(loan_given_id);

-- Same traceability pattern as loan_id/loan_repayment_id (028): lets Records,
-- edits and deletes find exactly which ledger row a given/repaid loan
-- created. loan_given_id -> SET NULL (the loan can be deleted independently
-- of history the way a borrowed loan can); loan_given_repayment_id ->
-- CASCADE (deleting one repayment removes the one transaction it made).
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS loan_given_id           UUID REFERENCES loans_given(id) ON DELETE SET NULL;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS loan_given_repayment_id UUID REFERENCES loan_given_repayments(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_tx_loan_given           ON transactions(loan_given_id);
CREATE INDEX IF NOT EXISTS idx_tx_loan_given_repayment ON transactions(loan_given_repayment_id);
