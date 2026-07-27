-- Migration 026: Account-scoped notional allocation.
-- Reverts the transfer-based "Allocate" mechanism (migration 020 + the
-- POST /wallets/transfer category_id tagging) in favor of a plain label:
-- allocating money to a category no longer moves it anywhere. The account's
-- real balance is untouched — allocating just marks how much of that
-- balance is earmarked for a category, so you can see what's spoken for
-- and what's still free, without any transaction/transfer history.
--
-- A category linked directly to an account (linked_wallet_id set) draws its
-- pool from that account's real balance. A category whose PARENT already
-- has an allocation draws from the parent's account_allocated_kes instead
-- (Housing gets a slice of the account, Nanny Wages/Food Ingredients get a
-- slice of Housing's slice) — enforced in the application layer, not here.

ALTER TABLE categories ADD COLUMN IF NOT EXISTS account_allocated_kes NUMERIC(18,4) NOT NULL DEFAULT 0;
