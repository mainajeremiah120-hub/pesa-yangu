"use strict";
require("dotenv").config();
const fs   = require("fs");
const path = require("path");
const { pool } = require("./db");

const MIGRATIONS_DIR = path.join(__dirname, "../../migrations");

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const applied = new Set(
      (await client.query("SELECT filename FROM _migrations")).rows.map(r => r.filename)
    );
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith(".sql")).sort();

    for (const file of files) {
      if (applied.has(file)) { console.log(`  skip  ${file}`); continue; }
      console.log(`  run   ${file}`);
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO _migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`  done  ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
    console.log("\nAll migrations applied.\n");
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(err => { console.error("Migration failed:", err.message); process.exit(1); });
