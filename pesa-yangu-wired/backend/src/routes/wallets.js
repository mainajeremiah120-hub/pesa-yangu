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
    const d = z.object({ name:z.string().min(1), account_type:z.string().default("current"), currency:z.string().length(3).default("KES"), balance:z.number().default(0), color:z.string().default("#00D4AA"), icon:z.string().default("🏦") }).parse(req.body);
    const {rows} = await query(
      "INSERT INTO wallets (user_id,name,account_type,currency,balance,color,icon) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [req.user.id,d.name,d.account_type,d.currency,d.balance,d.color,d.icon]
    );
    res.status(201).json({wallet:rows[0]});
  } catch(e){if(e instanceof z.ZodError) return res.status(400).json({error:e.errors[0].message}); next(e);}
});

router.patch("/:id", async (req, res, next) => {
  try {
    const allowed = ["name","color","icon","sort_order","is_archived","account_type","currency","balance"];
    const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
    if (!Object.keys(updates).length) return res.status(400).json({ error: "No valid fields" });
    if (updates.balance !== undefined) updates.balance = parseFloat(updates.balance);
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
    // Delete all child rows that have NOT NULL wallet_id (FK ON DELETE RESTRICT),
    // in dependency order so no FK violation fires.
    await query("DELETE FROM loan_repayments WHERE wallet_id=$1", [req.params.id]);
    await query("DELETE FROM investment_returns WHERE wallet_id=$1", [req.params.id]);
    await query("DELETE FROM transactions WHERE wallet_id=$1", [req.params.id]);
    await query("DELETE FROM recurring_transactions WHERE wallet_id=$1", [req.params.id]);
    await query("DELETE FROM goals WHERE wallet_id=$1", [req.params.id]);
    await query("DELETE FROM investments WHERE wallet_id=$1", [req.params.id]);
    await query("DELETE FROM wallets WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch(e) { next(e); }
});

router.post("/transfer", async (req, res, next) => {
  try {
    const d = z.object({ from_wallet_id:z.string().uuid(), to_wallet_id:z.string().uuid(), amount_kes:z.number().positive(), note:z.string().optional() }).parse(req.body);
    if(d.from_wallet_id===d.to_wallet_id) return res.status(400).json({error:"Source and destination cannot be the same"});
    const pairId = require("crypto").randomUUID();
    await withTransaction(async(client)=>{
      const {rows}=await client.query("SELECT id,balance FROM wallets WHERE id=ANY($1) AND user_id=$2 FOR UPDATE",[[d.from_wallet_id,d.to_wallet_id],req.user.id]);
      if(rows.length!==2) throw Object.assign(new Error("Wallet not found"),{status:404});
      const from=rows.find(w=>w.id===d.from_wallet_id);
      if(parseFloat(from.balance)<d.amount_kes) throw Object.assign(new Error("Insufficient balance"),{status:400});
      await client.query("UPDATE wallets SET balance=balance-$1 WHERE id=$2",[d.amount_kes,d.from_wallet_id]);
      await client.query("UPDATE wallets SET balance=balance+$1 WHERE id=$2",[d.amount_kes,d.to_wallet_id]);
      await client.query(`INSERT INTO transactions (user_id,wallet_id,type,amount_kes,note,transfer_pair_id) VALUES ($1,$2,'transfer_out',$3,$4,$5),($1,$6,'transfer_in',$3,$4,$5)`,
        [req.user.id,d.from_wallet_id,d.amount_kes,d.note||null,pairId,d.to_wallet_id]);
    });
    res.json({ok:true});
  } catch(e){if(e instanceof z.ZodError) return res.status(400).json({error:e.errors[0].message}); next(e);}
});

module.exports = router;
