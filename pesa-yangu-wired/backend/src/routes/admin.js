"use strict";
const express = require("express");
const { query, withTransaction } = require("../models/db");
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

// DELETE /admin/users/:id — permanently delete a user account
router.delete("/users/:id", async (req, res, next) => {
  try {
    if (req.params.id === req.user.id)
      return res.status(400).json({ error: "You cannot delete your own admin account." });
    const { rows: [user] } = await query(
      `DELETE FROM users WHERE id=$1 RETURNING id, email, full_name`,
      [req.params.id]
    );
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ deleted: user });
  } catch (err) { next(err); }
});

// GET /admin/tickets?status=open
router.get("/tickets", async (req, res, next) => {
  try {
    const status = req.query.status || "";
    const { rows } = await query(`
      SELECT t.*, u.email, u.full_name
      FROM support_tickets t
      JOIN users u ON u.id = t.user_id
      ${status ? "WHERE t.status=$1" : ""}
      ORDER BY
        CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
        t.created_at DESC
      LIMIT 200
    `, status ? [status] : []);
    res.json({ tickets: rows });
  } catch (err) { next(err); }
});

// PATCH /admin/tickets/:id — reply and/or update status
router.patch("/tickets/:id", async (req, res, next) => {
  try {
    const { status, admin_reply, priority } = req.body;
    let ticket;

    if (admin_reply?.trim()) {
      // Atomic: update ticket + seed into conversation thread
      await withTransaction(async (client) => {
        const { rows: [t] } = await client.query(`
          UPDATE support_tickets SET
            status      = COALESCE($1, status),
            priority    = COALESCE($2, priority),
            admin_reply = $3,
            replied_by  = $4,
            replied_at  = NOW(),
            updated_at  = NOW()
          WHERE id=$5
          RETURNING *
        `, [status||null, priority||null, admin_reply.trim(), req.user.id, req.params.id]);
        if (!t) throw Object.assign(new Error("Ticket not found"), { status: 404 });
        ticket = t;
        await client.query(
          `INSERT INTO ticket_messages (ticket_id, sender_id, sender_role, message)
           VALUES ($1,$2,'admin',$3)`,
          [t.id, req.user.id, admin_reply.trim()]
        );
      });
    } else {
      const { rows: [t] } = await query(`
        UPDATE support_tickets SET
          status     = COALESCE($1, status),
          priority   = COALESCE($2, priority),
          updated_at = NOW()
        WHERE id=$3
        RETURNING *
      `, [status||null, priority||null, req.params.id]);
      if (!t) return res.status(404).json({ error: "Ticket not found" });
      ticket = t;
    }

    res.json({ ticket });
  } catch (err) { next(err); }
});

module.exports = router;
