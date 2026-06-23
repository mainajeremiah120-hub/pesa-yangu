"use strict";
require("dotenv").config();

const express    = require("express");
const helmet     = require("helmet");
const cors       = require("cors");
const rateLimit  = require("express-rate-limit");
const fs         = require("fs");
const path       = require("path");
const logger     = require("./services/logger");
const { pool }   = require("./models/db");

async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS _migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const applied = new Set((await client.query("SELECT filename FROM _migrations")).rows.map(r => r.filename));
    const dir = path.join(__dirname, "../migrations");
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      logger.info(`Running migration: ${file}`);
      const sql = fs.readFileSync(path.join(dir, file), "utf-8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO _migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
        logger.info(`Migration applied: ${file}`);
      } catch (e) { await client.query("ROLLBACK"); throw e; }
    }
  } finally { client.release(); }
}

// ── Routes
const authRoutes        = require("./routes/auth");
const walletRoutes      = require("./routes/wallets");
const transactionRoutes = require("./routes/transactions");
const { requireAuth }   = require("./middleware/auth");
const {
  categoryRouter:   categoryRoutes,
  budgetRouter:     budgetRoutes,
  goalRouter:       goalRoutes,
  investmentRouter: investmentRoutes,
  loanRouter:       loanRoutes,
  recurringRouter:  recurringRoutes,
  fxRouter:         fxRoutes,
  aiRouter:         aiRoutes,
  billingRouter:    billingRoutes,
  reconcileRouter:  reconcileRoutes,
} = require("./routes/all-routes");

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Security
app.use(helmet());
app.set("trust proxy", 1); // Render sits behind a proxy

// ── CORS
const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:5173")
  .split(",").map(o => o.trim());

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);                     // server-to-server
    if (origin.endsWith(".vercel.app")) return cb(null, true); // Vercel previews
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  credentials: true,
}));

// ── Body parsing
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ── Rate limiting
app.use("/api/", rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      parseInt(process.env.RATE_LIMIT_MAX || "200"),
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: "Too many requests — please slow down." },
}));

// ── Health check (used by Render)
app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", ts: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: "degraded", error: "DB unreachable" });
  }
});

// ── API v1
const v1 = express.Router();
v1.use("/auth",        authRoutes);
v1.use("/fx-rates",    fxRoutes);

v1.use("/wallets",      requireAuth, walletRoutes);
v1.use("/transactions", requireAuth, transactionRoutes);
v1.use("/categories",   requireAuth, categoryRoutes);
v1.use("/budgets",      requireAuth, budgetRoutes);
v1.use("/goals",        requireAuth, goalRoutes);
v1.use("/investments",  requireAuth, investmentRoutes);
v1.use("/loans",        requireAuth, loanRoutes);
v1.use("/recurring",    requireAuth, recurringRoutes);
v1.use("/ai",           requireAuth, aiRoutes);
v1.use("/billing",      requireAuth, billingRoutes);
v1.use("/reconcile",    requireAuth, reconcileRoutes);

app.use("/api/v1", v1);

// ── 404
app.use((_req, res) => res.status(404).json({ error: "Not found" }));

// ── Global error handler
app.use((err, _req, res, _next) => {
  logger.error({ msg: err.message, stack: err.stack });
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: process.env.NODE_ENV === "production" && status === 500
      ? "Internal server error"
      : err.message,
  });
});

runMigrations()
  .then(() => app.listen(PORT, () =>
    logger.info(`Pesa Yangu API on :${PORT} [${process.env.NODE_ENV || "development"}]`)
  ))
  .catch(err => { logger.error(`Migration failed: ${err.message}`); process.exit(1); });

module.exports = app;
