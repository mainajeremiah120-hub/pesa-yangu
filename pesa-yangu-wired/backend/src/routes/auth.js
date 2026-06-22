"use strict";
const express  = require("express");
const bcrypt   = require("bcryptjs");
const jwt      = require("jsonwebtoken");
const crypto   = require("crypto");
const { z }    = require("zod");
const { query, withTransaction } = require("../models/db");
const { requireAuth } = require("../middleware/auth");
const { seed } = require("../services/defaultCategories");
const logger   = require("../services/logger");

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

module.exports = router;
