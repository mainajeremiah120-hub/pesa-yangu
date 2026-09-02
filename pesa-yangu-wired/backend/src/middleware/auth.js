"use strict";
const jwt = require("jsonwebtoken");
const { query } = require("../models/db");

const requireAuth = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer "))
    return res.status(401).json({ error: "Missing Authorization header" });

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // Linked household accounts: if this user has joined a partner's
    // household, every financial query should resolve to the household's
    // canonical owner id (req.dataOwnerId) instead of this user's own —
    // that's what makes both partners see and edit the same shared data.
    // Solo users (household_id IS NULL) get no match from the LEFT JOIN,
    // so COALESCE falls back to their own id and nothing changes for them.
    const { rows } = await query(
      `SELECT u.id, u.email, u.full_name, u.plan, u.role, u.budget_mode, u.household_id,
              (u.pin_hash IS NOT NULL) AS has_pin,
              COALESCE(h.owner_user_id, u.id) AS data_owner_id
       FROM users u
       LEFT JOIN households h ON h.id = u.household_id
       WHERE u.id = $1`,
      [payload.sub]
    );
    if (!rows.length) return res.status(401).json({ error: "User not found" });
    const { data_owner_id, ...user } = rows[0];
    req.user = user;
    req.dataOwnerId = data_owner_id;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError")
      return res.status(401).json({ error: "Token expired", code: "TOKEN_EXPIRED" });
    return res.status(401).json({ error: "Invalid token" });
  }
};

const requirePro = (req, res, next) => {
  if (req.user?.plan !== "pro")
    return res.status(403).json({ error: "Pesa Yangu Pro required.", code: "PLAN_REQUIRED" });
  next();
};

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== "admin")
    return res.status(403).json({ error: "Admin access required." });
  next();
};

module.exports = { requireAuth, requirePro, requireAdmin };
