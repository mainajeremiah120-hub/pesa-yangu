/* ─────────────────────────────────────────────────────────────────────────────
   wallets.js
───────────────────────────────────────────────────────────────────────────── */
"use strict";
const express = require("express");
const { z }   = require("zod");
const { query, withTransaction } = require("../models/db");
const router  = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const { rows } = await query(
      "SELECT * FROM wallets WHERE user_id=$1 AND is_archived=FALSE ORDER BY sort_order,created_at",
      [req.user.id]
    );
    res.json({ wallets: rows });
  } catch(e){next(e);}
});

router.post("/", async (req, res, next) => {
  try {
    const d = z.object({ name:z.string().min(1).max(100).trim(), account_type:z.string().max(30).default("current"), currency:z.string().length(3).default("KES"), balance:z.number().min(-1e12).max(1e12).default(0), opening_balance:z.number().min(-1e12).max(1e12).optional(), color:z.string().max(20).default("#00D4AA"), icon:z.string().max(10).default("🏦") }).parse(req.body);
    const openingBal = d.opening_balance ?? d.balance;
    const {rows} = await query(
      "INSERT INTO wallets (user_id,name,account_type,currency,balance,opening_balance,color,icon) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [req.user.id,d.name,d.account_type,d.currency,d.balance,openingBal,d.color,d.icon]
    );
    res.status(201).json({wallet:rows[0]});
  } catch(e){if(e instanceof z.ZodError) return res.status(400).json({error:e.errors[0].message}); next(e);}
});

router.patch("/:id", async (req, res, next) => {
  try {
    const allowed = ["name","color","icon","sort_order","is_archived","account_type","currency","balance","opening_balance"];
    const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
    if (!Object.keys(updates).length) return res.status(400).json({ error: "No valid fields" });
    if (updates.balance !== undefined) updates.balance = parseFloat(updates.balance);
    if (updates.opening_balance !== undefined) updates.opening_balance = parseFloat(updates.opening_balance);
    const sets = Object.keys(updates).map((k, i) => `${k}=$${i + 3}`);
    const { rows } = await query(
      `UPDATE wallets SET ${sets.join(",")} WHERE id=$1 AND user_id=$2 RETURNING *`,
      [req.params.id, req.user.id, ...Object.values(updates)]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json({ wallet: rows[0] });
  } catch(e) { next(e); }
});

// DELETE /wallets/:id — delete wallet (hard delete, transactions kept)
router.delete("/:id", async (req, res, next) => {
  try {
    // Verify ownership first
    const { rows: check } = await query(
      "SELECT id FROM wallets WHERE id=$1 AND user_id=$2",
      [req.params.id, req.user.id]
    );
    if (!check.length) return res.status(404).json({ error: "Wallet not found" });

    // Check for linked records before allowing delete
    const { rows: counts } = await query(
      `SELECT
        (SELECT COUNT(*) FROM transactions        WHERE wallet_id=$1)::int AS transactions,
        (SELECT COUNT(*) FROM recurring_transactions WHERE wallet_id=$1)::int AS recurring,
        (SELECT COUNT(*) FROM goals               WHERE wallet_id=$1)::int AS goals,
        (SELECT COUNT(*) FROM investments         WHERE wallet_id=$1)::int AS investments,
        (SELECT COUNT(*) FROM loan_repayments     WHERE wallet_id=$1)::int AS loan_repayments,
        (SELECT COUNT(*) FROM investment_returns  WHERE wallet_id=$1)::int AS investment_returns`,
      [req.params.id]
    );
    const c = counts[0];
    const total = c.transactions + c.recurring + c.goals + c.investments + c.loan_repayments + c.investment_returns;
    if (total > 0) {
      return res.status(409).json({
        error: "Wallet has linked records and cannot be deleted.",
        counts: c,
      });
    }

    await query("DELETE FROM wallets WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch(e) {
    if (e.code === "23503") {
      return res.status(409).json({ error: "Wallet has linked records and cannot be deleted." });
    }
    next(e);
  }
});

router.post("/transfer", async (req, res, next) => {
  try {
    const d = z.object({ from_wallet_id:z.string().uuid(), to_wallet_id:z.string().uuid(), amount_kes:z.number().positive(), note:z.string().optional(), category_id:z.string().uuid().optional() }).parse(req.body);
    if(d.from_wallet_id===d.to_wallet_id) return res.status(400).json({error:"Source and destination cannot be the same"});
    if (d.category_id) {
      const {rows:cr}=await query("SELECT id FROM categories WHERE id=$1 AND user_id=$2",[d.category_id,req.user.id]);
      if(!cr.length) return res.status(400).json({error:"Category not found"});
    }
    const pairId = require("crypto").randomUUID();
    await withTransaction(async(client)=>{
      const {rows}=await client.query("SELECT id,balance FROM wallets WHERE id=ANY($1) AND user_id=$2 FOR UPDATE",[[d.from_wallet_id,d.to_wallet_id],req.user.id]);
      if(rows.length!==2) throw Object.assign(new Error("Wallet not found"),{status:404});
      const from=rows.find(w=>w.id===d.from_wallet_id);
      if(parseFloat(from.balance)<d.amount_kes) throw Object.assign(new Error("Insufficient balance"),{status:400});
      await client.query("UPDATE wallets SET balance=balance-$1 WHERE id=$2",[d.amount_kes,d.from_wallet_id]);
      await client.query("UPDATE wallets SET balance=balance+$1 WHERE id=$2",[d.amount_kes,d.to_wallet_id]);
      await client.query(`INSERT INTO transactions (user_id,wallet_id,type,amount_kes,note,transfer_pair_id,category_id) VALUES ($1,$2,'transfer_out',$3,$4,$5,$7),($1,$6,'transfer_in',$3,$4,$5,NULL)`,
        [req.user.id,d.from_wallet_id,d.amount_kes,d.note||null,pairId,d.to_wallet_id,d.category_id||null]);
    });
    res.json({ok:true});
  } catch(e){if(e instanceof z.ZodError) return res.status(400).json({error:e.errors[0].message}); next(e);}
});

// POST /wallets/split-windfall — one-off income split across multiple
// Primary categories per their windfall_percent rules, executed as one
// atomic batch of transfers (all-or-nothing) instead of N separate calls.
router.post("/split-windfall", async (req, res, next) => {
  try {
    const d = z.object({
      from_wallet_id: z.string().uuid(),
      amount_kes: z.number().positive(),
      allocations: z.array(z.object({
        category_id: z.string().uuid(),
        wallet_id:   z.string().uuid(),
        amount_kes:  z.number().positive(),
      })).min(1).max(50),
    }).parse(req.body);

    const totalAlloc = d.allocations.reduce((s,a)=>s+a.amount_kes,0);
    if (totalAlloc > d.amount_kes + 0.01) return res.status(400).json({error:"Allocations exceed the windfall amount"});

    const destWalletIds = [...new Set(d.allocations.map(a=>a.wallet_id))];
    if (destWalletIds.includes(d.from_wallet_id)) return res.status(400).json({error:"Source and destination cannot be the same"});

    const catIds = [...new Set(d.allocations.map(a=>a.category_id))];
    const {rows:cr} = await query("SELECT id FROM categories WHERE id=ANY($1) AND user_id=$2", [catIds, req.user.id]);
    if (cr.length !== catIds.length) return res.status(400).json({error:"One or more categories not found"});

    const allWalletIds = [d.from_wallet_id, ...destWalletIds];
    await withTransaction(async(client)=>{
      const {rows} = await client.query("SELECT id,balance FROM wallets WHERE id=ANY($1) AND user_id=$2 FOR UPDATE",[allWalletIds, req.user.id]);
      if (rows.length !== allWalletIds.length) throw Object.assign(new Error("Wallet not found"),{status:404});
      const fromRow = rows.find(w=>w.id===d.from_wallet_id);
      if (parseFloat(fromRow.balance) < totalAlloc) throw Object.assign(new Error("Insufficient balance"),{status:400});

      await client.query("UPDATE wallets SET balance=balance-$1 WHERE id=$2", [totalAlloc, d.from_wallet_id]);
      for (const a of d.allocations) {
        const pairId = require("crypto").randomUUID();
        await client.query("UPDATE wallets SET balance=balance+$1 WHERE id=$2", [a.amount_kes, a.wallet_id]);
        await client.query(
          `INSERT INTO transactions (user_id,wallet_id,type,amount_kes,note,transfer_pair_id,category_id) VALUES ($1,$2,'transfer_out',$3,$4,$5,$7),($1,$6,'transfer_in',$3,$4,$5,NULL)`,
          [req.user.id, d.from_wallet_id, a.amount_kes, "Windfall split", pairId, a.wallet_id, a.category_id]
        );
      }
    });
    res.json({ok:true});
  } catch(e){if(e instanceof z.ZodError) return res.status(400).json({error:e.errors[0].message}); next(e);}
});

module.exports = router;
