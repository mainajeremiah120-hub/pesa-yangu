"use strict";
/**
 * On the last day of each month, adds that month's interest to every
 * Compound-interest loan that isn't settled yet — remaining_kes grows by
 * remaining_kes * (interest_rate / 100 / 12), same reducing-balance method
 * real loans use. Simple-interest loans are untouched (their total is fixed
 * at creation, by design).
 *
 * Checked every few hours rather than at one exact minute (like the push
 * reminder scheduler) because a Render redeploy landing on that exact minute
 * would silently skip the month — the UNIQUE(loan_id, period) constraint in
 * migration 029 makes it safe to check (and no-op) as often as we like.
 */
const { query } = require("./models/db");

function isLastDayOfMonthUTC(d) {
  const tomorrow = new Date(d);
  tomorrow.setUTCDate(d.getUTCDate() + 1);
  return tomorrow.getUTCDate() === 1;
}

async function accrueMonthlyInterest() {
  const now = new Date();
  const period = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);

  const { rows: loans } = await query(
    "SELECT id, user_id, remaining_kes, interest_rate FROM loans WHERE interest_type='compound' AND is_settled=false AND remaining_kes>0"
  );

  let accrued = 0;
  for (const loan of loans) {
    const monthlyRate = parseFloat(loan.interest_rate || 0) / 100 / 12;
    const amount = Math.round(parseFloat(loan.remaining_kes) * monthlyRate * 100) / 100;
    if (amount <= 0) continue;

    const { rows: inserted } = await query(
      `INSERT INTO loan_interest_accruals (loan_id, user_id, amount_kes, period)
       VALUES ($1,$2,$3,$4) ON CONFLICT (loan_id, period) DO NOTHING RETURNING id`,
      [loan.id, loan.user_id, amount, period]
    );
    if (inserted.length) {
      await query("UPDATE loans SET remaining_kes=remaining_kes+$1 WHERE id=$2", [amount, loan.id]);
      accrued++;
    }
  }
  if (accrued) console.log(`[loan-interest] accrued interest for ${accrued} loan(s), period=${period}`);
  return accrued;
}

function scheduleLoanInterestAccrual() {
  const check = () => {
    if (!isLastDayOfMonthUTC(new Date())) return;
    accrueMonthlyInterest().catch(err => console.error("[loan-interest] accrual error:", err.message));
  };
  check(); // catch a boot that lands mid-window, e.g. right after a deploy
  setInterval(check, 6 * 60 * 60 * 1000); // every 6 hours
  console.log("[loan-interest] Monthly accrual scheduler started");
}

module.exports = { scheduleLoanInterestAccrual, accrueMonthlyInterest };
