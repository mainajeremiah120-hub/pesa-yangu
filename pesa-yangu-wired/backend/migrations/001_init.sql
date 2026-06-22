-- Pesa Yangu — PostgreSQL Schema
-- Run via: npm run migrate

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── USERS ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           TEXT        NOT NULL UNIQUE,
  password_hash   TEXT        NOT NULL,
  full_name       TEXT        NOT NULL DEFAULT '',
  plan            TEXT        NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro')),
  plan_expires_at TIMESTAMPTZ,
  base_currency   TEXT        NOT NULL DEFAULT 'KES',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── REFRESH TOKENS ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT        NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rt_user ON refresh_tokens(user_id);

-- ── WALLETS ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallets (
  id           UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT          NOT NULL,
  account_type TEXT          NOT NULL DEFAULT 'current'
                             CHECK (account_type IN ('current','savings','investment','cash','digital')),
  currency     TEXT          NOT NULL DEFAULT 'KES',
  balance      NUMERIC(18,4) NOT NULL DEFAULT 0,
  color        TEXT          NOT NULL DEFAULT '#00D4AA',
  icon         TEXT          NOT NULL DEFAULT '🏦',
  is_archived  BOOLEAN       NOT NULL DEFAULT FALSE,
  sort_order   INTEGER       NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets(user_id);

-- ── CATEGORIES ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  type        TEXT        NOT NULL CHECK (type IN ('expense','income')),
  icon        TEXT        NOT NULL DEFAULT '🏷️',
  color       TEXT        NOT NULL DEFAULT '#4A90E2',
  budget_kes  NUMERIC(18,4) NOT NULL DEFAULT 0,
  watch       BOOLEAN     NOT NULL DEFAULT FALSE,
  is_system   BOOLEAN     NOT NULL DEFAULT FALSE,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name, type)
);
CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id);

-- ── RECURRING TRANSACTIONS (defined before transactions for FK) ───────────────
CREATE TABLE IF NOT EXISTS recurring_transactions (
  id          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id   UUID          NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  category_id UUID          REFERENCES categories(id) ON DELETE SET NULL,
  type        TEXT          NOT NULL CHECK (type IN ('expense','income')),
  amount_kes  NUMERIC(18,4) NOT NULL,
  merchant    TEXT,
  note        TEXT,
  freq        TEXT          NOT NULL CHECK (freq IN ('daily','weekly','monthly','yearly')),
  next_date   DATE          NOT NULL,
  is_active   BOOLEAN       NOT NULL DEFAULT TRUE,
  loan_id     UUID,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recurring_user ON recurring_transactions(user_id);

-- ── LOANS ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loans (
  id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                TEXT          NOT NULL,
  lender              TEXT,
  currency            TEXT          NOT NULL DEFAULT 'KES',
  principal_kes       NUMERIC(18,4) NOT NULL,
  remaining_kes       NUMERIC(18,4) NOT NULL,
  interest_rate       NUMERIC(6,3)  NOT NULL DEFAULT 0,
  monthly_payment_kes NUMERIC(18,4) NOT NULL DEFAULT 0,
  next_due_date       DATE,
  note                TEXT,
  is_settled          BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_loans_user ON loans(user_id);

-- ── TRANSACTIONS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id        UUID          NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  category_id      UUID          REFERENCES categories(id) ON DELETE SET NULL,
  type             TEXT          NOT NULL CHECK (type IN ('expense','income','transfer_in','transfer_out')),
  amount_kes       NUMERIC(18,4) NOT NULL,
  amount_native    NUMERIC(18,4),
  currency         TEXT          NOT NULL DEFAULT 'KES',
  merchant         TEXT,
  note             TEXT,
  tx_date          DATE          NOT NULL DEFAULT CURRENT_DATE,
  recurring_id     UUID          REFERENCES recurring_transactions(id) ON DELETE SET NULL,
  loan_id          UUID          REFERENCES loans(id) ON DELETE SET NULL,
  principal_paid   NUMERIC(18,4),
  interest_paid    NUMERIC(18,4),
  transfer_pair_id UUID,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tx_user    ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_tx_wallet  ON transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_tx_date    ON transactions(tx_date DESC);
CREATE INDEX IF NOT EXISTS idx_tx_cat     ON transactions(category_id);

-- ── SAVINGS GOALS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS goals (
  id          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id   UUID          NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  name        TEXT          NOT NULL,
  icon        TEXT          NOT NULL DEFAULT '🎯',
  color       TEXT          NOT NULL DEFAULT '#00D4AA',
  target_kes  NUMERIC(18,4) NOT NULL,
  saved_kes   NUMERIC(18,4) NOT NULL DEFAULT 0,
  deadline    DATE,
  is_achieved BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_goals_user ON goals(user_id);

-- ── INVESTMENTS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS investments (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id         UUID          NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  name              TEXT          NOT NULL,
  ticker            TEXT,
  type              TEXT          NOT NULL DEFAULT 'Stock'
                                  CHECK (type IN ('Stock','ETF','Bond','Money Mkt','REIT','Crypto','Other')),
  currency          TEXT          NOT NULL DEFAULT 'KES',
  units             NUMERIC(18,8) NOT NULL,
  buy_price_kes     NUMERIC(18,4) NOT NULL,
  current_price_kes NUMERIC(18,4) NOT NULL,
  note              TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_investments_user ON investments(user_id);

-- ── INVESTMENT RETURNS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS investment_returns (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  investment_id UUID          NOT NULL REFERENCES investments(id) ON DELETE CASCADE,
  user_id       UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id     UUID          NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  return_type   TEXT          NOT NULL CHECK (return_type IN ('interest','dividend','capital_gain','coupon','other')),
  amount_kes    NUMERIC(18,4) NOT NULL,
  return_date   DATE          NOT NULL DEFAULT CURRENT_DATE,
  note          TEXT,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inv_returns_inv ON investment_returns(investment_id);

-- ── LOAN REPAYMENTS ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loan_repayments (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  loan_id       UUID          NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  user_id       UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id     UUID          NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  total_kes     NUMERIC(18,4) NOT NULL,
  principal_kes NUMERIC(18,4) NOT NULL DEFAULT 0,
  interest_kes  NUMERIC(18,4) NOT NULL DEFAULT 0,
  payment_date  DATE          NOT NULL DEFAULT CURRENT_DATE,
  note          TEXT,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_loan_repay_loan ON loan_repayments(loan_id);

-- ── LOAN ATTACHMENTS ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loan_attachments (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  repayment_id UUID        NOT NULL REFERENCES loan_repayments(id) ON DELETE CASCADE,
  filename     TEXT        NOT NULL,
  storage_key  TEXT        NOT NULL,
  content_type TEXT,
  size_bytes   INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── FX RATE CACHE ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fx_rates (
  currency    TEXT          PRIMARY KEY,
  rate_to_kes NUMERIC(18,8) NOT NULL,
  fetched_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

INSERT INTO fx_rates (currency, rate_to_kes) VALUES
  ('KES', 1), ('USD', 129.03), ('EUR', 139.86), ('GBP', 163.93),
  ('UGX', 0.0351), ('TZS', 0.0498), ('ZAR', 6.99), ('NGN', 0.0794)
ON CONFLICT (currency) DO NOTHING;

-- ── SUBSCRIPTIONS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id                   UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id              UUID          NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  provider             TEXT          NOT NULL DEFAULT 'mpesa',
  provider_sub_id      TEXT,
  status               TEXT          NOT NULL DEFAULT 'active',
  plan                 TEXT          NOT NULL DEFAULT 'pro',
  amount_kes           NUMERIC(10,2) NOT NULL DEFAULT 499,
  current_period_end   TIMESTAMPTZ,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── AUTO updated_at TRIGGER ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'users','wallets','categories','recurring_transactions',
    'goals','investments','loans','subscriptions'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS set_updated_at ON %I;
       CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();', tbl, tbl
    );
  END LOOP;
END $$;
