"use strict";
require("dotenv").config();

const express     = require("express");
const helmet      = require("helmet");
const cors        = require("cors");
const compression = require("compression");
const rateLimit   = require("express-rate-limit");
const fs          = require("fs");
const path        = require("path");
const logger      = require("./services/logger");
const { pool }    = require("./models/db");

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
const adminRoutes       = require("./routes/admin");
const ticketRoutes      = require("./routes/tickets");
const walletRoutes      = require("./routes/wallets");
const transactionRoutes = require("./routes/transactions");
const pushRoutes        = require("./routes/push");
const { scheduleReminders } = require("./push-scheduler");
const { requireAuth, requireAdmin } = require("./middleware/auth");
const {
  categoryRouter:   categoryRoutes,
  budgetRouter:     budgetRoutes,
  incomePlanRouter: incomePlanRoutes,
  goalRouter:       goalRoutes,
  investmentRouter: investmentRoutes,
  loanRouter:       loanRoutes,
  recurringRouter:  recurringRoutes,
  fxRouter:         fxRoutes,
  aiRouter:         aiRoutes,
  billingRouter:    billingRoutes,
  reconcileRouter:  reconcileRoutes,
  insuranceRouter:  insuranceRoutes,
} = require("./routes/all-routes");

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Compression (gzip)
app.use(compression());

// ── Security headers (hardened helmet)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'"],
      styleSrc:    ["'self'", "'unsafe-inline'"],
      imgSrc:      ["'self'", "data:", "https:"],
      connectSrc:  ["'self'"],
      fontSrc:     ["'self'", "https://fonts.gstatic.com"],
      objectSrc:   ["'none'"],
      frameAncestors: ["'none'"],        // clickjacking protection
    },
  },
  hsts: {
    maxAge:            31536000,         // 1 year
    includeSubDomains: true,
    preload:           true,
  },
  frameguard:        { action: "deny" }, // X-Frame-Options: DENY
  noSniff:           true,               // X-Content-Type-Options: nosniff
  xssFilter:         true,
  referrerPolicy:    { policy: "strict-origin-when-cross-origin" },
}));
app.set("trust proxy", 1);

// ── CORS — explicit allowlist only, no .vercel.app wildcard
const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:5173")
  .split(",").map(o => o.trim());

// Accept specific Vercel preview URLs from env, not a blanket wildcard
const allowedVercelDomains = (process.env.ALLOWED_VERCEL_DOMAINS || "")
  .split(",").map(o => o.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);   // server-to-server / curl
    if (allowedOrigins.includes(origin)) return cb(null, true);
    if (allowedVercelDomains.some(d => origin === d || origin.endsWith(`.${d}`))) return cb(null, true);
    logger.warn({ msg: "CORS blocked", origin });
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  credentials: true,
}));

// ── Body parsing — keep small; financial JSON never needs 10 MB
app.use(express.json({ limit: "512kb" }));
app.use(express.urlencoded({ extended: true, limit: "512kb" }));

// ── Global rate limit (all API routes)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      parseInt(process.env.RATE_LIMIT_MAX || "300"),
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: "Too many requests — please slow down." },
});

// ── Strict rate limits on auth endpoints (brute-force protection)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 min window
  max:      20,                 // max 20 attempts per IP
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: "Too many attempts — please wait 15 minutes." },
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,   // 1 hour window
  max:      5,                  // max 5 reset requests per IP per hour
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: "Too many password reset requests — please wait an hour." },
});

app.use("/api/", globalLimiter);

// ── Instant ping — no DB, pre-warms Render before login
app.get("/ping", (_req, res) => res.json({ ok: true }));

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

// Auth routes with stricter per-endpoint limiters
v1.use("/auth/login",           authLimiter);
v1.use("/auth/register",        authLimiter);
v1.use("/auth/forgot-password", forgotPasswordLimiter);
v1.use("/auth",        authRoutes);

v1.use("/admin",       requireAuth, requireAdmin, adminRoutes);
v1.use("/tickets",     requireAuth, ticketRoutes);
v1.use("/fx-rates",    fxRoutes);

v1.use("/wallets",      requireAuth, walletRoutes);
v1.use("/transactions", requireAuth, transactionRoutes);
v1.use("/categories",   requireAuth, categoryRoutes);
v1.use("/budgets",      requireAuth, budgetRoutes);
v1.use("/income-plans", requireAuth, incomePlanRoutes);
v1.use("/goals",        requireAuth, goalRoutes);
v1.use("/investments",  requireAuth, investmentRoutes);
v1.use("/loans",        requireAuth, loanRoutes);
v1.use("/recurring",    requireAuth, recurringRoutes);
v1.use("/ai",           requireAuth, aiRoutes);
v1.use("/billing",      requireAuth, billingRoutes);
v1.use("/reconcile",    requireAuth, reconcileRoutes);
v1.use("/insurance",    requireAuth, insuranceRoutes);
v1.get("/push/vapid-public-key", (_req, res) => res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || "" }));
v1.use("/push",         requireAuth, pushRoutes);

app.use("/api/v1", v1);

// ── 404
app.use((_req, res) => res.status(404).json({ error: "Not found" }));

// ── Global error handler — never leak internals in production
app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  logger.error({ msg: err.message, status, stack: err.stack });
  // Only expose message for client errors (4xx); always hide 5xx internals
  res.status(status).json({
    error: status < 500
      ? err.message
      : "Something went wrong. Please try again.",
  });
});

runMigrations()
  .then(() => {
    scheduleReminders();
    app.listen(PORT, () =>
      logger.info(`Pesa Yangu API on :${PORT} [${process.env.NODE_ENV || "development"}]`)
    );
  })
  .catch(err => { logger.error(`Migration failed: ${err.message}`); process.exit(1); });

module.exports = app;
