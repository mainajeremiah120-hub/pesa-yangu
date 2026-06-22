"use strict";
const { Pool } = require("pg");
const logger   = require("../services/logger");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }  // Render PostgreSQL requires this
    : false,
});

pool.on("error", (err) => logger.error({ msg: "PG pool error", err }));

const query = async (text, params) => {
  const start = Date.now();
  const res   = await pool.query(text, params);
  const ms    = Date.now() - start;
  if (ms > 1000) logger.warn({ msg: "Slow query", ms, text: text.slice(0, 80) });
  return res;
};

const withTransaction = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { pool, query, withTransaction };
