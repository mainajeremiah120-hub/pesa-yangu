"use strict";
const axios  = require("axios");
const { query } = require("../models/db");
const logger = require("./logger");

const FALLBACK = { KES:1, USD:129.03, EUR:139.86, GBP:163.93, UGX:0.0351, TZS:0.0498, ZAR:6.99, NGN:0.0794 };
const HOURS    = parseInt(process.env.FX_REFRESH_INTERVAL_HOURS || "6");

const getRates = async () => {
  const { rows } = await query(
    `SELECT currency, rate_to_kes FROM fx_rates WHERE fetched_at > NOW() - INTERVAL '${HOURS} hours'`
  );
  if (rows.length >= 7)
    return Object.fromEntries(rows.map(r => [r.currency, parseFloat(r.rate_to_kes)]));

  try {
    const key = process.env.FX_API_KEY;
    const url = key
      ? `https://api.exchangerate.host/latest?base=KES&access_key=${key}`
      : `https://api.exchangerate.host/latest?base=KES`;
    const { data } = await axios.get(url, { timeout: 8000 });
    const rates = { KES: 1 };
    for (const [cur, rateFromKES] of Object.entries(data.rates || {})) {
      if (FALLBACK[cur] !== undefined) rates[cur] = 1 / rateFromKES;
    }
    for (const [cur, rate] of Object.entries(rates)) {
      await query(
        `INSERT INTO fx_rates (currency,rate_to_kes,fetched_at) VALUES ($1,$2,NOW())
         ON CONFLICT (currency) DO UPDATE SET rate_to_kes=$2, fetched_at=NOW()`,
        [cur, rate]
      );
    }
    logger.info({ msg: "FX rates refreshed" });
    return rates;
  } catch (err) {
    logger.warn({ msg: "FX fetch failed, using cache/fallback", err: err.message });
    if (rows.length) return Object.fromEntries(rows.map(r => [r.currency, parseFloat(r.rate_to_kes)]));
    return FALLBACK;
  }
};

module.exports = { getRates };
