"use strict";
/**
 * Executes every recurring transaction whose next_date has arrived (or
 * passed) — inserts the real transaction, moves the wallet balance, and
 * advances next_date to the following occurrence. Previously the Recurring
 * feature only ever stored the template (see all-routes.js's recurringRouter)
 * with no engine anywhere that turned a due one into an actual transaction —
 * this file is that engine.
 *
 * Catches up fully if the server was down across the due date: loops one
 * occurrence at a time per recurring item until next_date is in the future,
 * so a missed cycle is still recorded (not silently skipped) and a wallet
 * never receives two occurrences dated the same day.
 *
 * Checked every few hours, same reasoning as the loan-interest scheduler —
 * a redeploy landing on an exact check time shouldn't be able to skip a day.
 */
const { query, withTransaction } = require("./models/db");

function toDateStr(d) {
  return (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);
}

function advanceDate(dateStr, freq) {
  const d = new Date(dateStr + "T00:00:00Z");
  if (freq === "daily")        d.setUTCDate(d.getUTCDate() + 1);
  else if (freq === "weekly")  d.setUTCDate(d.getUTCDate() + 7);
  else if (freq === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  else if (freq === "yearly")  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return toDateStr(d);
}

async function executeDueRecurring() {
  const today = toDateStr(new Date());
  const { rows: due } = await query(
    "SELECT * FROM recurring_transactions WHERE is_active=TRUE AND next_date <= $1",
    [today]
  );

  let executed = 0;
  for (const r of due) {
    let nextDate = toDateStr(r.next_date);
    let guard = 0; // safety cap so a long-dead server can't loop forever catching up
    while (nextDate <= today && guard < 366) {
      const occurrenceDate = nextDate;
      const followingDate = advanceDate(occurrenceDate, r.freq);
      await withTransaction(async (client) => {
        const delta = r.type === "income" ? r.amount_kes : -r.amount_kes;
        await client.query(
          `INSERT INTO transactions (user_id,wallet_id,category_id,type,amount_kes,merchant,note,tx_date,recurring_id,loan_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [r.user_id, r.wallet_id, r.category_id, r.type, r.amount_kes, r.merchant, r.note, occurrenceDate, r.id, r.loan_id]
        );
        await client.query("UPDATE wallets SET balance=balance+$1 WHERE id=$2 AND user_id=$3", [delta, r.wallet_id, r.user_id]);
        await client.query("UPDATE recurring_transactions SET next_date=$1 WHERE id=$2", [followingDate, r.id]);
      });
      nextDate = followingDate;
      executed++;
      guard++;
    }
  }
  if (executed) console.log(`[recurring] executed ${executed} due occurrence(s)`);
  return executed;
}

function scheduleRecurringExecution() {
  const check = () => {
    executeDueRecurring().catch(err => console.error("[recurring] execution error:", err.message));
  };
  check(); // catch anything overdue immediately on boot, e.g. right after a deploy
  setInterval(check, 6 * 60 * 60 * 1000); // every 6 hours
  console.log("[recurring] Execution scheduler started");
}

module.exports = { scheduleRecurringExecution, executeDueRecurring };
