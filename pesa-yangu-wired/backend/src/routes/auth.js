"use strict";
const express      = require("express");
const bcrypt       = require("bcryptjs");
const jwt          = require("jsonwebtoken");
const crypto       = require("crypto");
const nodemailer   = require("nodemailer");
const { z }        = require("zod");
const { query, withTransaction } = require("../models/db");
const { requireAuth } = require("../middleware/auth");
const { seed }     = require("../services/defaultCategories");
const logger       = require("../services/logger");

const mailer = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   parseInt(process.env.SMTP_PORT || "587"),
  secure: process.env.SMTP_SECURE === "true",
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

async function sendResetEmail(to, resetUrl) {
  await mailer.sendMail({
    from:    process.env.SMTP_FROM || "Pesa Yangu <noreply@pesayangu.africa>",
    to,
    subject: "Reset your Pesa Yangu password",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0B1120;color:#E2E8F0;border-radius:16px">
        <div style="text-align:center;margin-bottom:24px">
          <div style="display:inline-block;width:48px;height:48px;background:linear-gradient(135deg,#00D4AA,#3B82F6);border-radius:12px;font-size:22px;line-height:48px;text-align:center">◈</div>
          <h2 style="margin:12px 0 4px;font-size:20px;color:#fff">Reset your password</h2>
          <p style="margin:0;color:#94A3B8;font-size:13px">Pesa Yangu · Smart personal finance for Kenya</p>
        </div>
        <p style="color:#CBD5E1;font-size:14px;line-height:1.6">We received a request to reset the password for your account. Click the button below to set a new password. This link expires in <strong>1 hour</strong>.</p>
        <div style="text-align:center;margin:28px 0">
          <a href="${resetUrl}" style="display:inline-block;background:#00D4AA;color:#0B1120;padding:14px 32px;border-radius:12px;font-weight:700;font-size:15px;text-decoration:none">Reset Password</a>
        </div>
        <p style="color:#64748B;font-size:12px;text-align:center">If you didn't request this, you can ignore this email — your password won't change.<br>Link expires at ${new Date(Date.now()+3600000).toUTCString()}</p>
      </div>`,
  });
}

const router = express.Router();

const signAccess  = (id) => jwt.sign({ sub:id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_ACCESS_EXPIRES  || "15m" });
const signRefresh = (id) => jwt.sign({ sub:id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES || "30d" });
const hashTok     = (t)  => crypto.createHash("sha256").update(t).digest("hex");

// POST /auth/register
router.post("/register", async (req, res, next) => {
  try {
    const { email, password, full_name } = z.object({
      email:     z.string().email(),
      password:  z.string().min(8, "Password must be at least 8 characters"),
      full_name: z.string().min(1).max(100),
    }).parse(req.body);

    const existing = await query("SELECT id FROM users WHERE email=$1", [email.toLowerCase()]);
    if (existing.rows.length)
      return res.status(409).json({ error: "An account with that email already exists." });

    const password_hash = await bcrypt.hash(password, 12);

    const user = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO users (email, password_hash, full_name)
         VALUES ($1,$2,$3) RETURNING id, email, full_name, plan`,
        [email.toLowerCase(), password_hash, full_name]
      );
      await seed(client, rows[0].id);
      return rows[0];
    });

    const accessToken  = signAccess(user.id);
    const refreshToken = signRefresh(user.id);
    await query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1,$2, NOW() + INTERVAL '30 days')`,
      [user.id, hashTok(refreshToken)]
    );

    logger.info({ msg: "User registered", userId: user.id });
    res.status(201).json({ user, accessToken, refreshToken });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    next(err);
  }
});

// POST /auth/login
router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = z.object({
      email:    z.string().email(),
      password: z.string().min(1),
    }).parse(req.body);

    const { rows } = await query(
      "SELECT id,email,full_name,plan,password_hash FROM users WHERE email=$1",
      [email.toLowerCase()]
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ error: "Invalid email or password." });

    const accessToken  = signAccess(user.id);
    const refreshToken = signRefresh(user.id);
    await query(
      `INSERT INTO refresh_tokens (user_id,token_hash,expires_at)
       VALUES ($1,$2, NOW() + INTERVAL '30 days')`,
      [user.id, hashTok(refreshToken)]
    );

    const { password_hash: _, ...safe } = user;
    res.json({ user: safe, accessToken, refreshToken });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    next(err);
  }
});

// POST /auth/refresh
router.post("/refresh", async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: "refreshToken required" });
    const payload = jwt.verify(refreshToken, process.env.JWT_SECRET);
    const { rows } = await query(
      "SELECT id FROM refresh_tokens WHERE token_hash=$1 AND expires_at > NOW()",
      [hashTok(refreshToken)]
    );
    if (!rows.length) return res.status(401).json({ error: "Invalid or expired refresh token" });
    res.json({ accessToken: signAccess(payload.sub) });
  } catch (err) { next(err); }
});

// POST /auth/logout
router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) await query("DELETE FROM refresh_tokens WHERE token_hash=$1", [hashTok(refreshToken)]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /auth/me
router.get("/me", requireAuth, (req, res) => res.json({ user: req.user }));

// DELETE /auth/account — deactivate (soft delete) the user account
router.delete("/account", async (req, res, next) => {
  try {
    await query("UPDATE users SET is_active=FALSE WHERE id=$1", [req.user.id]);
    await query("DELETE FROM refresh_tokens WHERE user_id=$1", [req.user.id]);
    res.json({ ok: true });
  } catch(err) { next(err); }
});

// POST /auth/forgot-password
router.post("/forgot-password", async (req, res, next) => {
  try {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      return res.status(503).json({ error: "Email service is not configured yet. Please contact support." });
    }
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    // Always respond 200 to prevent email enumeration
    const { rows } = await query(
      "SELECT id FROM users WHERE email=$1 AND is_active=TRUE",
      [email.toLowerCase()]
    );
    if (!rows.length) return res.json({ ok: true });

    // Invalidate any existing unused tokens for this user
    await query(
      "DELETE FROM password_reset_tokens WHERE user_id=$1 AND used_at IS NULL",
      [rows[0].id]
    );

    const token     = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashTok(token);
    await query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
      [rows[0].id, tokenHash]
    );

    const frontendUrl = process.env.FRONTEND_URL || "https://pesayangu.africa";
    const resetUrl    = `${frontendUrl}?reset=${token}`;
    try {
      await sendResetEmail(email.toLowerCase(), resetUrl);
    } catch (mailErr) {
      logger.error({ msg: "Failed to send reset email", error: mailErr.message });
      return res.status(503).json({ error: "Could not send reset email. Check your SMTP settings." });
    }

    logger.info({ msg: "Password reset requested", userId: rows[0].id });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    // Table not found — migration hasn't run yet
    if (err.code === "42P01") return res.status(503).json({ error: "Database not ready. Please try again in a moment." });
    logger.error({ msg: "forgot-password error", detail: err.message, code: err.code });
    return res.status(500).json({ error: err.message });
  }
});

// POST /auth/reset-password
router.post("/reset-password", async (req, res, next) => {
  try {
    const { token, password } = z.object({
      token:    z.string().min(1),
      password: z.string().min(8, "Password must be at least 8 characters"),
    }).parse(req.body);

    const { rows } = await query(
      `SELECT id, user_id FROM password_reset_tokens
       WHERE token_hash=$1 AND expires_at > NOW() AND used_at IS NULL`,
      [hashTok(token)]
    );
    if (!rows.length)
      return res.status(400).json({ error: "This reset link is invalid or has expired." });

    const password_hash = await bcrypt.hash(password, 12);
    await withTransaction(async (client) => {
      await client.query("UPDATE users SET password_hash=$1 WHERE id=$2", [password_hash, rows[0].user_id]);
      await client.query("UPDATE password_reset_tokens SET used_at=NOW() WHERE id=$1", [rows[0].id]);
      await client.query("DELETE FROM refresh_tokens WHERE user_id=$1", [rows[0].user_id]);
    });

    logger.info({ msg: "Password reset completed", userId: rows[0].user_id });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    next(err);
  }
});

module.exports = router;
