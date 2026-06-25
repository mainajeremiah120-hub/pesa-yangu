-- Change tx_date from DATE to TIMESTAMPTZ so transactions can store time-of-day
ALTER TABLE transactions
  ALTER COLUMN tx_date TYPE TIMESTAMP WITH TIME ZONE
  USING tx_date::timestamp with time zone;

ALTER TABLE transactions
  ALTER COLUMN tx_date SET DEFAULT NOW();
