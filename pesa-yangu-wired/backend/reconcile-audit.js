"use strict";
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("render.com") ? { rejectUnauthorized: false } : false,
});

async function run(label, sql) {
  const { rows } = await pool.query(sql);
  console.log(`\n=== ${label} ===`);
  if (!rows.length) {
    console.log("OK — no rows (clean).");
  } else {
    console.log(`${rows.length} row(s):`);
    console.table(rows);
  }
  return rows;
}

(async () => {
  await run("1. Wallet balance derivability (stored vs opening_balance + sum(transactions))", `
    SELECT w.id, w.name, w.balance::numeric AS stored_balance,
           (w.opening_balance + COALESCE(SUM(
             CASE WHEN t.type IN ('income','transfer_in','refund') THEN t.amount_kes
                  ELSE -t.amount_kes END), 0))::numeric AS derived_balance,
           (w.balance - (w.opening_balance + COALESCE(SUM(
             CASE WHEN t.type IN ('income','transfer_in','refund') THEN t.amount_kes
                  ELSE -t.amount_kes END), 0)))::numeric AS drift
    FROM wallets w LEFT JOIN transactions t ON t.wallet_id = w.id
    GROUP BY w.id
    HAVING ABS(w.balance - (w.opening_balance + COALESCE(SUM(
             CASE WHEN t.type IN ('income','transfer_in','refund') THEN t.amount_kes
                  ELSE -t.amount_kes END), 0))) > 0.01
    ORDER BY ABS(w.balance - (w.opening_balance + COALESCE(SUM(
             CASE WHEN t.type IN ('income','transfer_in','refund') THEN t.amount_kes
                  ELSE -t.amount_kes END), 0))) DESC;
  `);

  await run("2. Transfer pairs missing exactly one out + one in leg", `
    SELECT transfer_pair_id, COUNT(*) AS leg_count,
           COUNT(*) FILTER (WHERE type='transfer_out') AS outs,
           COUNT(*) FILTER (WHERE type='transfer_in')  AS ins,
           SUM(CASE WHEN type='transfer_out' THEN amount_kes ELSE -amount_kes END) AS amount_mismatch
    FROM transactions WHERE transfer_pair_id IS NOT NULL
    GROUP BY transfer_pair_id
    HAVING COUNT(*) <> 2 OR COUNT(*) FILTER (WHERE type='transfer_out') <> 1
        OR COUNT(*) FILTER (WHERE type='transfer_in') <> 1;
  `);

  await run("3a. Loan remaining_kes vs principal - applied repayments", `
    SELECT l.id, l.name, l.interest_type, l.principal_kes, l.remaining_kes,
           (l.principal_kes - COALESCE(SUM(
             CASE WHEN l.interest_type='simple' THEN r.total_kes ELSE r.principal_kes END), 0))::numeric AS expected_remaining
    FROM loans l LEFT JOIN loan_repayments r ON r.loan_id = l.id
    GROUP BY l.id
    HAVING l.remaining_kes <> (l.principal_kes - COALESCE(SUM(
             CASE WHEN l.interest_type='simple' THEN r.total_kes ELSE r.principal_kes END), 0));
  `);

  await run("3b. Loan repayments where principal+interest <> total", `
    SELECT id, loan_id, total_kes, principal_kes, interest_kes, created_at
    FROM loan_repayments WHERE principal_kes + interest_kes <> total_kes;
  `);

  await run("4. Insurance amount_paid vs tracked premium_payments", `
    SELECT p.id, p.name, p.amount_paid, p.premium_amount, p.start_date,
           COALESCE(SUM(pp.amount_kes),0) AS tracked_paid,
           COUNT(pp.id) AS payment_count
    FROM insurance_policies p LEFT JOIN premium_payments pp ON pp.policy_id = p.id
    GROUP BY p.id
    ORDER BY p.id;
  `);

  await run("5a. Category allocation overcommit vs linked wallet balance", `
    SELECT c.linked_wallet_id, w.balance AS pool, SUM(c.account_allocated_kes) AS allocated
    FROM categories c JOIN wallets w ON w.id = c.linked_wallet_id
    GROUP BY c.linked_wallet_id, w.balance
    HAVING SUM(c.account_allocated_kes) > w.balance + 0.01;
  `);

  await run("5b. Sub-category allocation overcommit vs parent's own allocation", `
    SELECT c.parent_id, par.account_allocated_kes AS pool, SUM(c.account_allocated_kes) AS allocated
    FROM categories c JOIN categories par ON par.id = c.parent_id
    GROUP BY c.parent_id, par.account_allocated_kes
    HAVING SUM(c.account_allocated_kes) > par.account_allocated_kes + 0.01;
  `);

  await run("5c. Orphaned category allocation (no linked wallet, no parent, but allocated > 0)", `
    SELECT * FROM categories WHERE linked_wallet_id IS NULL AND parent_id IS NULL AND account_allocated_kes > 0;
  `);

  await run("6. Transaction/category type mismatch", `
    SELECT t.id AS tx_id, t.type AS tx_type, c.id AS cat_id, c.type AS cat_type, c.name AS cat_name
    FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE (t.type = 'income' AND c.type <> 'income')
       OR (t.type IN ('expense','refund') AND c.type <> 'expense');
  `);

  await run("7. Negative/zero amounts already present (gates Phase 4 CHECK constraints)", `
    SELECT 'transactions' AS src, id::text, amount_kes::numeric AS bad_value FROM transactions WHERE amount_kes <= 0
    UNION ALL SELECT 'wallets', id::text, balance FROM wallets WHERE balance < 0
    UNION ALL SELECT 'loan_repayments', id::text, total_kes FROM loan_repayments WHERE total_kes <= 0
    UNION ALL SELECT 'premium_payments', id::text, amount_kes FROM premium_payments WHERE amount_kes <= 0;
  `);

  await run("8. Possible CSV double-import (identical wallet/amount/date/merchant, no transfer_pair_id)", `
    SELECT wallet_id, amount_kes, tx_date, merchant, COUNT(*) AS dupe_count
    FROM transactions
    WHERE transfer_pair_id IS NULL
    GROUP BY wallet_id, amount_kes, tx_date, merchant
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC;
  `);

  console.log("\nDone — all queries are read-only, nothing was changed.");
  await pool.end();
})().catch(e => { console.error("Error:", e.message); process.exit(1); });
