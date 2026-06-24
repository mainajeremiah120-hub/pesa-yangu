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
    const { rows } = await query(
      "SELECT id, email, full_name, plan, role FROM users WHERE id = $1",
      [payload.sub]
    );
    if (!rows.length) return res.status(401).json({ error: "User not found" });
    req.user = rows[0];
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
