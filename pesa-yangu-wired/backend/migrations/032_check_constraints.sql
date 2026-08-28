-- Migration 032: Phase 4 hardening backstops.
-- Everything up to this point relied entirely on application-layer (Zod)
-- validation being correct in every code path. These add database-level
-- backstops so a bug anywhere in the app (or a raw script, or a future
-- migration) can't silently write invalid financial data.
--
-- Verified safe against live data first (reconcile-audit.js query 7 —
-- zero negative/zero amounts found) before writing this file.
--
-- Deliberately NOT adding wallets.balance >= 0 — plain expense
-- transactions are allowed to overdraw an account (a real account can go
-- temporarily negative), so a blanket non-negative constraint would break
-- legitimate use. Loan repayments and insurance premium payments already
-- block overdraft at the application layer (see all-routes.js).
--
-- Deliberately NOT adding a transfer_pair_id "exactly 2 legs" constraint —
-- that's a cross-row invariant, not cleanly expressible as a CHECK or a
-- single-row trigger; it stays an application-layer + periodic
-- reconcile-audit.js invariant (query 2).

ALTER TABLE transactions        ADD CONSTRAINT chk_tx_amount_positive       CHECK (amount_kes > 0);
ALTER TABLE loan_repayments     ADD CONSTRAINT chk_repay_total_positive     CHECK (total_kes > 0);
ALTER TABLE loan_repayments     ADD CONSTRAINT chk_repay_principal_nonneg   CHECK (principal_kes >= 0);
ALTER TABLE loan_repayments     ADD CONSTRAINT chk_repay_interest_nonneg    CHECK (interest_kes >= 0);
ALTER TABLE premium_payments    ADD CONSTRAINT chk_premium_amount_positive  CHECK (amount_kes > 0);
ALTER TABLE investment_returns  ADD CONSTRAINT chk_return_amount_positive   CHECK (amount_kes > 0);
ALTER TABLE goal_contributions  ADD CONSTRAINT chk_contrib_amount_positive  CHECK (amount_kes > 0);

-- Category/transaction type matching (an income category can't be used on
-- an expense row, or vice versa). Not expressible as a plain CHECK since
-- it needs to look up another table — implemented as a trigger instead.
-- 'refund' is treated as compatible with expense-type categories, matching
-- reconcile-audit.js query 6's logic.
CREATE OR REPLACE FUNCTION check_category_type_match() RETURNS TRIGGER AS $$
DECLARE
  cat_type TEXT;
BEGIN
  IF NEW.category_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT type INTO cat_type FROM categories WHERE id = NEW.category_id;
  IF cat_type IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.type = 'income' AND cat_type <> 'income' THEN
    RAISE EXCEPTION 'Category type mismatch: an income transaction cannot use an expense category';
  END IF;
  IF NEW.type IN ('expense','refund') AND cat_type <> 'expense' THEN
    RAISE EXCEPTION 'Category type mismatch: an expense/refund transaction cannot use an income category';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_category_type_match ON transactions;
CREATE TRIGGER trg_check_category_type_match
  BEFORE INSERT OR UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION check_category_type_match();
