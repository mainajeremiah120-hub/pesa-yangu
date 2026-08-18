-- Migration 030: Link a Loan / Insurance Policy / Investment to a specific
-- expense (or, for investments, income) category. Repayments, premium
-- payments, and investment returns previously always filed under one
-- generic category per module ("Loan Repayment" for every loan, "Premium"
-- for every policy, a return-type category like "Dividend" for every
-- investment) — so money moving outside the normal Add Transaction flow
-- couldn't be tracked per loan/policy/investment the way manually-entered
-- expenses can. Linking to a specific category (optional — falls back to
-- the old generic category when unset) fixes that.

ALTER TABLE loans              ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE investments        ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES categories(id) ON DELETE SET NULL;
