"use strict";
const express = require("express");
const { query } = require("../models/db");
const router  = express.Router();

// GET /admin/stats
router.get("/stats", async (req, res, next) => {
  try {
    const { rows: [stats] } = await query(`
      SELECT
        COUNT(*)::int                                                            AS total_users,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int  AS this_month,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int   AS this_week,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS today,
        COUNT(*) FILTER (WHERE is_active = TRUE)::int                          AS active_users,
        COUNT(*) FILTER (WHERE plan = 'pro')::int                              AS pro_users,
        COUNT(*) FILTER (WHERE role = 'admin')::int                            AS admin_count
      FROM users
    `);
    res.json(stats);
  } catch (err) { next(err); }
});

// GET /admin/users?search=&page=1
router.get("/users", async (req, res, next) => {
  try {
    const search = (req.query.search || "").trim();
    const { rows } = await query(`
      SELECT
        u.id, u.email, u.full_name, u.plan, u.role, u.is_active,
        u.created_at,
        (SELECT COUNT(*)::int FROM transactions  WHERE user_id = u.id) AS tx_count,
        (SELECT COUNT(*)::int FROM wallets       WHERE user_id = u.id) AS wallet_count
      FROM users u
      WHERE ($1 = '' OR u.email ILIKE $2 OR u.full_name ILIKE $2)
      ORDER BY u.created_at DESC
      LIMIT 200
    `, [search, `%${search}%`]);
    res.json({ users: rows });
  } catch (err) { next(err); }
});

// PATCH /admin/users/:id — update is_active, plan, role
router.patch("/users/:id", async (req, res, next) => {
  try {
    const allowed = ["is_active", "plan", "role"];
    const sets = [], vals = [];
    let i = 1;
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        sets.push(`${key}=$${i++}`);
        vals.push(req.body[key]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: "Nothing to update" });
    vals.push(req.params.id);
    const { rows: [user] } = await query(
      `UPDATE users SET ${sets.join(",")} WHERE id=$${i}
       RETURNING id, email, full_name, plan, role, is_active`,
      vals
    );
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ user });
  } catch (err) { next(err); }
});

module.exports = router;
