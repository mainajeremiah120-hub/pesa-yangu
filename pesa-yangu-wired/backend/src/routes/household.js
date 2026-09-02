"use strict";
const express = require("express");
const crypto  = require("crypto");
const { z }   = require("zod");
const { query, withTransaction } = require("../models/db");
const { seed } = require("../services/defaultCategories");

const router = express.Router();

// Unambiguous alphabet — no 0/O, 1/I/L — so a code read aloud or typed on
// a phone keyboard can't be misheard/mistyped into a different valid code.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function generateCode() {
  const bytes = crypto.randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

// The 15 shared financial tables other than `categories` — every new user
// gets ~18 default categories at registration (see defaultCategories.js),
// so a brand-new account can never have zero rows there; categories are
// handled separately below (deleted, not counted) once this check proves
// nothing else references them yet.
const SHARED_TABLES = [
  "wallets", "transactions", "goals", "investments", "investment_returns",
  "loans", "loan_repayments", "loan_interest_accruals", "recurring_transactions",
  "insurance_policies", "premium_payments", "monthly_budgets", "income_plans",
  "goal_contributions", "import_batches",
];

async function countOwnedRows(client, userId) {
  const parts = SHARED_TABLES.map(t => `(SELECT COUNT(*) FROM ${t} WHERE user_id=$1)`);
  const { rows } = await client.query(`SELECT (${parts.join(" + ")}) AS n`, [userId]);
  return parseInt(rows[0].n, 10);
}

// Shared by POST /household/accept (an existing, already-registered user
// entering a code) and POST /auth/register's optional invite_code (a
// brand-new signup joining immediately). Must run inside the caller's own
// withTransaction — locks the user row first to serialize concurrent
// accept attempts, then validates the code, the household's member count,
// and that the joining account is genuinely empty, before linking it.
async function acceptInvite(client, userId, code) {
  const { rows: me } = await client.query("SELECT household_id FROM users WHERE id=$1 FOR UPDATE", [userId]);
  if (!me.length) throw Object.assign(new Error("User not found"), { status: 404 });
  if (me[0].household_id) throw Object.assign(new Error("You're already in a household — leave it first."), { status: 409 });

  const { rows: inv } = await client.query(
    "UPDATE household_invites SET used_at=NOW(), used_by_user_id=$1 WHERE code=$2 AND used_at IS NULL AND expires_at > NOW() RETURNING household_id",
    [userId, code]
  );
  if (!inv.length) throw Object.assign(new Error("That invite code is invalid or has expired."), { status: 400 });
  const householdId = inv[0].household_id;

  const { rows: memberCount } = await client.query("SELECT COUNT(*)::int AS n FROM users WHERE household_id=$1", [householdId]);
  if (memberCount[0].n >= 2) throw Object.assign(new Error("That household already has two members."), { status: 409 });

  const owned = await countOwnedRows(client, userId);
  if (owned > 0) throw Object.assign(new Error("This account already has data — only a brand-new account can join a household."), { status: 400 });

  // Nothing references this account's categories yet (proven by the count
  // above being zero) — discard the starter set in favor of the
  // household's own. A no-op if there are none (e.g. a fresh registration
  // that skipped seeding entirely because it joined via invite_code).
  await client.query("DELETE FROM categories WHERE user_id=$1", [userId]);

  await client.query("UPDATE users SET household_id=$1 WHERE id=$2", [householdId, userId]);
  return householdId;
}

router.get("/", async (req, res, next) => {
  try {
    if (!req.user.household_id) {
      return res.json({ household_id: null, is_owner: false, partner: null, pending_invite: null });
    }
    const { rows: hh } = await query("SELECT owner_user_id FROM households WHERE id=$1", [req.user.household_id]);
    if (!hh.length) return res.json({ household_id: null, is_owner: false, partner: null, pending_invite: null });
    const isOwner = hh[0].owner_user_id === req.user.id;

    const { rows: partnerRows } = await query(
      "SELECT id, full_name, email FROM users WHERE household_id=$1 AND id<>$2",
      [req.user.household_id, req.user.id]
    );

    let pendingInvite = null;
    if (isOwner && !partnerRows.length) {
      const { rows: inv } = await query(
        "SELECT code, expires_at FROM household_invites WHERE household_id=$1 AND used_at IS NULL AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1",
        [req.user.household_id]
      );
      pendingInvite = inv[0] || null;
    }

    res.json({
      household_id: req.user.household_id,
      is_owner: isOwner,
      partner: partnerRows[0] || null,
      pending_invite: pendingInvite,
    });
  } catch (e) { next(e); }
});

router.post("/invite", async (req, res, next) => {
  try {
    const result = await withTransaction(async (client) => {
      let householdId = req.user.household_id;

      if (!householdId) {
        const { rows } = await client.query(
          "INSERT INTO households (owner_user_id) VALUES ($1) RETURNING id",
          [req.user.id]
        );
        householdId = rows[0].id;
        await client.query("UPDATE users SET household_id=$1 WHERE id=$2", [householdId, req.user.id]);
      } else {
        const { rows: hh } = await client.query("SELECT owner_user_id FROM households WHERE id=$1 FOR UPDATE", [householdId]);
        if (!hh.length || hh[0].owner_user_id !== req.user.id) {
          throw Object.assign(new Error("Only the household owner can invite a partner."), { status: 403 });
        }
        const { rows: memberCount } = await client.query("SELECT COUNT(*)::int AS n FROM users WHERE household_id=$1", [householdId]);
        if (memberCount[0].n >= 2) {
          throw Object.assign(new Error("Your household already has two members."), { status: 409 });
        }
      }

      // Only one live invite per household at a time.
      await client.query(
        "UPDATE household_invites SET expires_at=NOW() WHERE household_id=$1 AND used_at IS NULL",
        [householdId]
      );

      let code, inserted = false;
      for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
        code = generateCode();
        try {
          await client.query(
            "INSERT INTO household_invites (household_id, code, created_by_user_id, expires_at) VALUES ($1,$2,$3, NOW() + INTERVAL '7 days')",
            [householdId, code, req.user.id]
          );
          inserted = true;
        } catch (e) {
          if (e.code !== "23505") throw e; // unique_violation on code — retry
        }
      }
      if (!inserted) throw Object.assign(new Error("Couldn't generate an invite code — try again."), { status: 500 });

      const { rows: expRows } = await client.query(
        "SELECT expires_at FROM household_invites WHERE household_id=$1 AND code=$2",
        [householdId, code]
      );
      return { code, expires_at: expRows[0].expires_at };
    });
    res.json(result);
  } catch (e) { next(e); }
});

router.post("/accept", async (req, res, next) => {
  try {
    const { code } = z.object({ code: z.string().trim().min(1).max(20) }).parse(req.body);
    const householdId = await withTransaction(client => acceptInvite(client, req.user.id, code.toUpperCase()));
    res.json({ ok: true, household_id: householdId });
  } catch (e) { if (e instanceof z.ZodError) return res.status(400).json({ error: e.errors[0].message }); next(e); }
});

router.post("/leave", async (req, res, next) => {
  try {
    if (!req.user.household_id) return res.status(400).json({ error: "You're not in a household." });

    await withTransaction(async (client) => {
      const { rows: hh } = await client.query("SELECT owner_user_id FROM households WHERE id=$1 FOR UPDATE", [req.user.household_id]);
      if (!hh.length) { await client.query("UPDATE users SET household_id=NULL WHERE id=$1", [req.user.id]); return; }

      const isOwner = hh[0].owner_user_id === req.user.id;
      const { rows: members } = await client.query("SELECT id FROM users WHERE household_id=$1", [req.user.household_id]);

      if (isOwner) {
        if (members.length > 1) {
          throw Object.assign(new Error("Dissolve the household first, or ask your partner to leave."), { status: 409 });
        }
        await client.query("UPDATE users SET household_id=NULL WHERE id=$1", [req.user.id]);
        await client.query("DELETE FROM households WHERE id=$1", [req.user.household_id]);
      } else {
        await client.query("UPDATE users SET household_id=NULL WHERE id=$1", [req.user.id]);
        await seed(client, req.user.id);
      }
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post("/dissolve", async (req, res, next) => {
  try {
    if (!req.user.household_id) return res.status(400).json({ error: "You're not in a household." });

    await withTransaction(async (client) => {
      const { rows: hh } = await client.query("SELECT owner_user_id FROM households WHERE id=$1 FOR UPDATE", [req.user.household_id]);
      if (!hh.length || hh[0].owner_user_id !== req.user.id) {
        throw Object.assign(new Error("Only the household owner can dissolve it."), { status: 403 });
      }
      const { rows: partner } = await client.query(
        "SELECT id FROM users WHERE household_id=$1 AND id<>$2",
        [req.user.household_id, req.user.id]
      );
      if (partner.length) {
        await client.query("UPDATE users SET household_id=NULL WHERE id=$1", [partner[0].id]);
        await seed(client, partner[0].id);
      }
      await client.query("UPDATE users SET household_id=NULL WHERE id=$1", [req.user.id]);
      await client.query("DELETE FROM households WHERE id=$1", [req.user.household_id]);
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = { householdRouter: router, acceptInvite };
