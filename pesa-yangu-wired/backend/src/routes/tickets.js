"use strict";
const express = require("express");
const { query, withTransaction } = require("../models/db");
const router  = express.Router();

// GET /tickets — user's own tickets (list with counts)
router.get("/", async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, subject, category, status, priority, satisfaction_rating,
              created_at, updated_at, admin_reply,
              (SELECT COUNT(*)::int FROM ticket_messages WHERE ticket_id = t.id) AS message_count
       FROM support_tickets t WHERE user_id=$1 ORDER BY updated_at DESC`,
      [req.user.id]
    );
    res.json({ tickets: rows });
  } catch (err) { next(err); }
});

// POST /tickets — raise a new ticket
router.post("/", async (req, res, next) => {
  try {
    const { subject, message, category = "general", priority = "normal" } = req.body;
    if (!subject?.trim()) return res.status(400).json({ error: "Subject is required" });
    if (!message?.trim()) return res.status(400).json({ error: "Message is required" });

    let ticket;
    await withTransaction(async (client) => {
      const { rows: [t] } = await client.query(
        `INSERT INTO support_tickets (user_id, subject, message, category, priority)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [req.user.id, subject.trim(), message.trim(), category, priority]
      );
      ticket = t;
      await client.query(
        `INSERT INTO ticket_messages (ticket_id, sender_id, sender_role, message)
         VALUES ($1,$2,'user',$3)`,
        [t.id, req.user.id, message.trim()]
      );
    });
    res.status(201).json({ ticket });
  } catch (err) { next(err); }
});

// GET /tickets/:id — full ticket with message thread
router.get("/:id", async (req, res, next) => {
  try {
    const { rows: [ticket] } = await query(
      `SELECT * FROM support_tickets WHERE id=$1 AND user_id=$2`,
      [req.params.id, req.user.id]
    );
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });

    let { rows: messages } = await query(
      `SELECT m.id, m.message, m.sender_role, m.created_at,
              u.full_name, u.email
       FROM ticket_messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.ticket_id = $1
       ORDER BY m.created_at ASC`,
      [ticket.id]
    );

    // Synthesize thread for pre-migration tickets (no rows in ticket_messages yet)
    if (messages.length === 0) {
      const { rows: [u] } = await query(
        `SELECT full_name, email FROM users WHERE id=$1`, [ticket.user_id]
      );
      messages = [{
        id: ticket.id + "_init",
        message: ticket.message,
        sender_role: "user",
        created_at: ticket.created_at,
        full_name: u?.full_name || null,
        email: u?.email || null,
      }];
      if (ticket.admin_reply) {
        messages.push({
          id: ticket.id + "_admin_reply",
          message: ticket.admin_reply,
          sender_role: "admin",
          created_at: ticket.replied_at || ticket.updated_at,
          full_name: "Pesa Yangu Support",
          email: null,
        });
      }
    }

    res.json({ ticket, messages });
  } catch (err) { next(err); }
});

// POST /tickets/:id/messages — user adds a reply to an existing ticket
router.post("/:id/messages", async (req, res, next) => {
  try {
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: "Message is required" });

    const { rows: [ticket] } = await query(
      `SELECT id, status FROM support_tickets WHERE id=$1 AND user_id=$2`,
      [req.params.id, req.user.id]
    );
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });
    if (ticket.status === "closed")
      return res.status(400).json({ error: "Ticket is closed. Please reopen it first." });

    let msg;
    await withTransaction(async (client) => {
      const { rows: [m] } = await client.query(
        `INSERT INTO ticket_messages (ticket_id, sender_id, sender_role, message)
         VALUES ($1,$2,'user',$3)
         RETURNING id, message, sender_role, created_at`,
        [ticket.id, req.user.id, message.trim()]
      );
      msg = m;
      // If resolved, bump back to open so admin sees new activity
      await client.query(
        `UPDATE support_tickets
         SET status = CASE WHEN status='resolved' THEN 'open' ELSE status END,
             updated_at = NOW()
         WHERE id=$1`,
        [ticket.id]
      );
    });
    res.status(201).json({ message: msg });
  } catch (err) { next(err); }
});

// POST /tickets/:id/reopen — reopen a resolved or closed ticket
router.post("/:id/reopen", async (req, res, next) => {
  try {
    const { rows: [ticket] } = await query(
      `UPDATE support_tickets
       SET status='open', reopened_at=NOW(), updated_at=NOW()
       WHERE id=$1 AND user_id=$2 AND status IN ('resolved','closed')
       RETURNING *`,
      [req.params.id, req.user.id]
    );
    if (!ticket) return res.status(400).json({ error: "Only resolved or closed tickets can be reopened" });
    res.json({ ticket });
  } catch (err) { next(err); }
});

// POST /tickets/:id/rate — satisfaction rating 1–5 stars
router.post("/:id/rate", async (req, res, next) => {
  try {
    const rating = parseInt(req.body.rating, 10);
    if (!rating || rating < 1 || rating > 5)
      return res.status(400).json({ error: "Rating must be between 1 and 5" });

    const { rows: [ticket] } = await query(
      `UPDATE support_tickets
       SET satisfaction_rating=$1, updated_at=NOW()
       WHERE id=$2 AND user_id=$3 AND status IN ('resolved','closed')
       RETURNING *`,
      [rating, req.params.id, req.user.id]
    );
    if (!ticket) return res.status(400).json({ error: "Can only rate resolved or closed tickets" });
    res.json({ ticket });
  } catch (err) { next(err); }
});

module.exports = router;
