"use strict";
const express   = require("express");
const { query } = require("../models/db");
const router   = express.Router();

// POST /push/subscribe
router.post("/subscribe", async (req, res, next) => {
  try {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth)
      return res.status(400).json({ error: "Missing subscription fields" });

    await query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, endpoint) DO UPDATE SET p256dh=$3, auth=$4`,
      [req.user.id, endpoint, keys.p256dh, keys.auth]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// DELETE /push/subscribe
router.delete("/subscribe", async (req, res, next) => {
  try {
    const { endpoint } = req.body;
    if (endpoint) {
      await query(
        "DELETE FROM push_subscriptions WHERE user_id=$1 AND endpoint=$2",
        [req.user.id, endpoint]
      );
    } else {
      await query("DELETE FROM push_subscriptions WHERE user_id=$1", [req.user.id]);
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
