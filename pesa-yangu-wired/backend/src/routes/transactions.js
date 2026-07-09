"use strict";
const express = require("express");
const multer  = require("multer");
const { z }   = require("zod");
const { query, withTransaction } = require("../models/db");
const router  = express.Router();
const upload  = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["text/csv","text/plain","application/vnd.ms-excel","application/octet-stream"];
    if (!allowed.includes(file.mimetype) && !file.originalname.toLowerCase().endsWith(".csv"))
      return cb(Object.assign(new Error("Only CSV files are allowed"), { status: 400 }));
    cb(null, true);
  },
});

router.get("/", async (req, res, next) => {
  try {
    const { wallet_id, type, from, to, limit=500, offset=0 } = req.query;
    const cond=["t.user_id=$1"]; const p=[req.user.id]; let n=2;
    if(wallet_id){cond.push(`t.wallet_id=$${n++}`);p.push(wallet_id);}
    if(type){cond.push(`t.type=$${n++}`);p.push(type);}
    if(from){cond.push(`t.tx_date>=$${n++}`);p.push(from);}
    if(to){cond.push(`t.tx_date<=$${n++}`);p.push(to);}
    const cappedLimit = Math.min(parseInt(limit)||500, 1000);
    const {rows}=await query(
      `SELECT t.*,c.name AS category_name,c.icon AS category_icon,c.color AS category_color,w.name AS wallet_name,w.currency AS wallet_currency
       FROM transactions t LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN wallets w ON w.id=t.wallet_id
       WHERE ${cond.join(" AND ")} ORDER BY t.tx_date DESC,t.created_at DESC LIMIT $${n++} OFFSET $${n}`,
      [...p,cappedLimit,parseInt(offset)||0]
    );
    res.json({transactions:rows});
  } catch(e){next(e);}
});

router.post("/", async (req, res, next) => {
  try {
    const d = z.object({
      wallet_id:z.string().uuid(), category_id:z.string().uuid().optional(),
      type:z.enum(["expense","income","transfer_in","transfer_out","refund"]),
      amount_kes:z.number().positive().max(1e10),
      merchant:z.string().max(200).optional(),
      note:z.string().max(1000).optional(),
      tx_date:z.string().max(30).optional(), loan_id:z.string().uuid().optional(),
      principal_paid:z.number().max(1e10).optional(), interest_paid:z.number().max(1e10).optional(),
      refund_of:z.string().uuid().optional(),
    }).parse(req.body);
    // transfer_pair_id is intentionally not accepted from the client — it must
    // always be server-generated (see wallets.js POST /transfer), otherwise a
    // client could tag an unrelated transaction with another user's pair id.

    const {rows:wr}=await query("SELECT id FROM wallets WHERE id=$1 AND user_id=$2",[d.wallet_id,req.user.id]);
    if(!wr.length) return res.status(400).json({error:"Wallet not found"});
    if(d.category_id) {
      const {rows:cr}=await query("SELECT id FROM categories WHERE id=$1 AND user_id=$2",[d.category_id,req.user.id]);
      if(!cr.length) return res.status(400).json({error:"Category not found"});
    }
    if(d.loan_id) {
      const {rows:lr}=await query("SELECT id FROM loans WHERE id=$1 AND user_id=$2",[d.loan_id,req.user.id]);
      if(!lr.length) return res.status(400).json({error:"Loan not found"});
    }
    if(d.refund_of) {
      const {rows:rr}=await query("SELECT id FROM transactions WHERE id=$1 AND user_id=$2",[d.refund_of,req.user.id]);
      if(!rr.length) return res.status(400).json({error:"Original transaction not found"});
    }

    const tx = await withTransaction(async(client)=>{
      const {rows}=await client.query(
        `INSERT INTO transactions (user_id,wallet_id,category_id,type,amount_kes,merchant,note,tx_date,loan_id,principal_paid,interest_paid,refund_of)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [req.user.id,d.wallet_id,d.category_id||null,d.type,d.amount_kes,d.merchant||null,d.note||null,
         d.tx_date||new Date(),d.loan_id||null,d.principal_paid||null,d.interest_paid||null,d.refund_of||null]
      );
      const delta=(d.type==="income"||d.type==="transfer_in"||d.type==="refund")?d.amount_kes:-d.amount_kes;
      await client.query("UPDATE wallets SET balance=balance+$1 WHERE id=$2 AND user_id=$3",[delta,d.wallet_id,req.user.id]);
      return rows[0];
    });
    res.status(201).json({transaction:tx});
  } catch(e){if(e instanceof z.ZodError) return res.status(400).json({error:e.errors[0].message}); next(e);}
});

router.patch("/:id", async (req, res, next) => {
  try {
    const { rows: existing } = await query(
      "SELECT * FROM transactions WHERE id=$1 AND user_id=$2",
      [req.params.id, req.user.id]
    );
    if (!existing.length) return res.status(404).json({ error: "Not found" });
    const old = existing[0];

    const d = z.object({
      wallet_id:   z.string().uuid().optional(),
      category_id: z.string().uuid().nullable().optional(),
      type:        z.enum(["expense","income","transfer_in","transfer_out","refund"]).optional(),
      amount_kes:  z.number().positive().optional(),
      merchant:    z.string().optional(),
      note:        z.string().nullable().optional(),
      tx_date:     z.string().optional(),
    }).parse(req.body);

    const newWalletId   = d.wallet_id   ?? old.wallet_id;
    const newType       = d.type        ?? old.type;
    const newAmount     = d.amount_kes  ?? parseFloat(old.amount_kes);
    const newCategoryId = Object.prototype.hasOwnProperty.call(d, "category_id") ? d.category_id : old.category_id;
    const newMerchant   = d.merchant    ?? old.merchant;
    const newNote       = Object.prototype.hasOwnProperty.call(d, "note") ? d.note : old.note;
    const newDate       = d.tx_date     ?? old.tx_date;

    if (d.wallet_id) {
      const { rows: wr } = await query("SELECT id FROM wallets WHERE id=$1 AND user_id=$2", [d.wallet_id, req.user.id]);
      if (!wr.length) return res.status(400).json({ error: "Wallet not found" });
    }
    if (newCategoryId) {
      const { rows: cr } = await query("SELECT id FROM categories WHERE id=$1 AND user_id=$2", [newCategoryId, req.user.id]);
      if (!cr.length) return res.status(400).json({ error: "Category not found" });
    }

    const tx = await withTransaction(async (client) => {
      const isCredit = (t) => t === "income" || t === "transfer_in" || t === "refund";
      const oldDelta = isCredit(old.type) ? -parseFloat(old.amount_kes) : parseFloat(old.amount_kes);
      await client.query("UPDATE wallets SET balance=balance+$1 WHERE id=$2 AND user_id=$3", [oldDelta, old.wallet_id, req.user.id]);

      const newDelta = isCredit(newType) ? newAmount : -newAmount;
      await client.query("UPDATE wallets SET balance=balance+$1 WHERE id=$2 AND user_id=$3", [newDelta, newWalletId, req.user.id]);

      const { rows } = await client.query(
        `UPDATE transactions SET
           wallet_id=$1, category_id=$2, type=$3, amount_kes=$4,
           merchant=$5, note=$6, tx_date=$7
         WHERE id=$8 RETURNING *`,
        [newWalletId, newCategoryId, newType, newAmount, newMerchant, newNote, newDate, old.id]
      );
      return rows[0];
    });
    res.json({ transaction: tx });
  } catch(e) { if (e instanceof z.ZodError) return res.status(400).json({ error: e.errors[0].message }); next(e); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const {rows}=await query("SELECT * FROM transactions WHERE id=$1 AND user_id=$2",[req.params.id,req.user.id]);
    if(!rows.length) return res.status(404).json({error:"Not found"});
    const tx=rows[0];
    await withTransaction(async(client)=>{
      if(tx.transfer_pair_id) {
        // Delete both legs of the transfer and reverse both wallet balances.
        // Scoped to this user — a transfer's two legs always belong to the
        // same user (see wallets.js POST /transfer), so this also guards
        // against a crafted transfer_pair_id collision touching someone else's rows.
        const {rows:pair}=await client.query("SELECT * FROM transactions WHERE transfer_pair_id=$1 AND user_id=$2",[tx.transfer_pair_id,req.user.id]);
        for(const leg of pair) {
          const delta=(leg.type==="income"||leg.type==="transfer_in")?-parseFloat(leg.amount_kes):parseFloat(leg.amount_kes);
          await client.query("UPDATE wallets SET balance=balance+$1 WHERE id=$2 AND user_id=$3",[delta,leg.wallet_id,req.user.id]);
        }
        await client.query("DELETE FROM transactions WHERE transfer_pair_id=$1 AND user_id=$2",[tx.transfer_pair_id,req.user.id]);
      } else {
        await client.query("DELETE FROM transactions WHERE id=$1 AND user_id=$2",[tx.id,req.user.id]);
        const delta=(tx.type==="income"||tx.type==="transfer_in"||tx.type==="refund")?-parseFloat(tx.amount_kes):parseFloat(tx.amount_kes);
        await client.query("UPDATE wallets SET balance=balance+$1 WHERE id=$2 AND user_id=$3",[delta,tx.wallet_id,req.user.id]);
      }
    });
    res.json({ok:true});
  } catch(e){next(e);}
});

// GET /transactions/export
router.get("/export", async (req, res, next) => {
  try {
    const {rows}=await query(
      `SELECT t.tx_date AS date,t.type,c.name AS category,t.amount_kes,t.merchant,t.note,w.name AS wallet,w.currency
       FROM transactions t LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN wallets w ON w.id=t.wallet_id
       WHERE t.user_id=$1 ORDER BY t.tx_date DESC`,
      [req.user.id]
    );
    const hdrs=["date","type","category","amount_kes","merchant","note","wallet","currency"];
    const csv=[hdrs.join(","),...rows.map(r=>hdrs.map(h=>`"${(r[h]||"").toString().replace(/"/g,'""')}"`).join(","))].join("\n");
    res.setHeader("Content-Type","text/csv");
    res.setHeader("Content-Disposition",`attachment; filename="pesa-yangu-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(csv);
  } catch(e){next(e);}
});

// POST /transactions/import
router.post("/import", upload.single("file"), async (req, res, next) => {
  try {
    if(!req.file) return res.status(400).json({error:"No file uploaded"});
    // Reject non-CSV by MIME type and extension
    const allowed=["text/csv","text/plain","application/vnd.ms-excel","application/octet-stream"];
    if(!allowed.includes(req.file.mimetype)&&!req.file.originalname.toLowerCase().endsWith(".csv"))
      return res.status(400).json({error:"Only CSV files are accepted"});
    const raw=req.file.buffer.toString("utf-8").replace(/\r/g,"");
    const lines=raw.trim().split("\n").filter(l=>l.trim());
    if(lines.length<2) return res.status(400).json({error:"File appears empty"});
    if(lines.length>5001) return res.status(400).json({error:"File too large — maximum 5000 rows per import"});
    const hdrs=lines[0].split(",").map(h=>h.trim().toLowerCase().replace(/["']/g,""));
    const idx=(n)=>hdrs.indexOf(n);
    const {rows:cats}=await query("SELECT id,name,type FROM categories WHERE user_id=$1",[req.user.id]);
    const {rows:wals}=await query("SELECT id,name FROM wallets WHERE user_id=$1",[req.user.id]);
    const catMap=Object.fromEntries(cats.map(c=>[`${c.name.toLowerCase()}:${c.type}`,c.id]));
    const walMap=Object.fromEntries(wals.map(w=>[w.name.toLowerCase(),w.id]));
    const defWal=wals[0]?.id;

    const toInsert=lines.slice(1).map(line=>{
      const v=line.split(",").map(x=>x.trim().replace(/^"|"$/g,""));
      const type=(v[idx("type")]||"expense").toLowerCase();
      const cat=(v[idx("category")]||"").toLowerCase();
      const dateStr = v[idx("date")] || new Date().toISOString().slice(0,10);
      const timeStr = (v[idx("time")] || "").trim() || "00:00";
      const tx_date = dateStr.includes("T") ? dateStr : `${dateStr}T${timeStr}:00`;
      return {
        tx_date,
        type:     ["expense","income","transfer_in","transfer_out"].includes(type)?type:"expense",
        cat_id:   catMap[`${cat}:${type}`]||null,
        amount:   parseFloat(v[idx("amount_kes")]||v[idx("amount")]||"0")||0,
        merchant: v[idx("merchant")]||null,
        note:     v[idx("note")]||null,
        wallet_id:walMap[v[idx("wallet")]?.toLowerCase()]||defWal,
      };
    }).filter(r=>r.amount!==0&&r.wallet_id);

    if(!toInsert.length) return res.status(400).json({error:"No valid rows found. Check the column names match the template."});

    // Single multi-row INSERT instead of one round trip per row (up to 5000
    // rows), plus one UPDATE per distinct wallet instead of per row.
    let imported=0;
    await withTransaction(async(client)=>{
      const values=[];
      const placeholders=toInsert.map((r,i)=>{
        const b=i*8;
        values.push(req.user.id,r.wallet_id,r.cat_id,r.type,r.amount,r.merchant,r.note,r.tx_date);
        return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8})`;
      });
      await client.query(
        `INSERT INTO transactions (user_id,wallet_id,category_id,type,amount_kes,merchant,note,tx_date) VALUES ${placeholders.join(",")}`,
        values
      );
      const deltaByWallet={};
      for(const r of toInsert){
        const delta=(r.type==="income"||r.type==="transfer_in")?r.amount:-r.amount;
        deltaByWallet[r.wallet_id]=(deltaByWallet[r.wallet_id]||0)+delta;
      }
      for(const [walletId,delta] of Object.entries(deltaByWallet)){
        await client.query("UPDATE wallets SET balance=balance+$1 WHERE id=$2 AND user_id=$3",[delta,walletId,req.user.id]);
      }
      imported=toInsert.length;
    });
    res.json({ok:true,imported});
  } catch(e){next(e);}
});

module.exports = router;
