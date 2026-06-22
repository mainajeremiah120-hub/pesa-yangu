"use strict";
const express = require("express");
const multer  = require("multer");
const { z }   = require("zod");
const { query, withTransaction } = require("../models/db");
const router  = express.Router();
const upload  = multer({ storage: multer.memoryStorage(), limits:{ fileSize:10*1024*1024 } });

router.get("/", async (req, res, next) => {
  try {
    const { wallet_id, type, from, to, limit=500, offset=0 } = req.query;
    const cond=["t.user_id=$1"]; const p=[req.user.id]; let n=2;
    if(wallet_id){cond.push(`t.wallet_id=$${n++}`);p.push(wallet_id);}
    if(type){cond.push(`t.type=$${n++}`);p.push(type);}
    if(from){cond.push(`t.tx_date>=$${n++}`);p.push(from);}
    if(to){cond.push(`t.tx_date<=$${n++}`);p.push(to);}
    const {rows}=await query(
      `SELECT t.*,c.name AS category_name,c.icon AS category_icon,c.color AS category_color,w.name AS wallet_name,w.currency AS wallet_currency
       FROM transactions t LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN wallets w ON w.id=t.wallet_id
       WHERE ${cond.join(" AND ")} ORDER BY t.tx_date DESC,t.created_at DESC LIMIT $${n++} OFFSET $${n}`,
      [...p,parseInt(limit),parseInt(offset)]
    );
    res.json({transactions:rows});
  } catch(e){next(e);}
});

router.post("/", async (req, res, next) => {
  try {
    const d = z.object({
      wallet_id:z.string().uuid(), category_id:z.string().uuid().optional(),
      type:z.enum(["expense","income","transfer_in","transfer_out"]),
      amount_kes:z.number().positive(), merchant:z.string().optional(), note:z.string().optional(),
      tx_date:z.string().optional(), loan_id:z.string().uuid().optional(),
      principal_paid:z.number().optional(), interest_paid:z.number().optional(),
      transfer_pair_id:z.string().uuid().optional(),
    }).parse(req.body);

    const tx = await withTransaction(async(client)=>{
      const {rows}=await client.query(
        `INSERT INTO transactions (user_id,wallet_id,category_id,type,amount_kes,merchant,note,tx_date,loan_id,principal_paid,interest_paid,transfer_pair_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [req.user.id,d.wallet_id,d.category_id||null,d.type,d.amount_kes,d.merchant||null,d.note||null,
         d.tx_date||new Date(),d.loan_id||null,d.principal_paid||null,d.interest_paid||null,d.transfer_pair_id||null]
      );
      const delta=(d.type==="income"||d.type==="transfer_in")?d.amount_kes:-d.amount_kes;
      await client.query("UPDATE wallets SET balance=balance+$1 WHERE id=$2 AND user_id=$3",[delta,d.wallet_id,req.user.id]);
      return rows[0];
    });
    res.status(201).json({transaction:tx});
  } catch(e){if(e instanceof z.ZodError) return res.status(400).json({error:e.errors[0].message}); next(e);}
});

router.delete("/:id", async (req, res, next) => {
  try {
    const {rows}=await query("SELECT * FROM transactions WHERE id=$1 AND user_id=$2",[req.params.id,req.user.id]);
    if(!rows.length) return res.status(404).json({error:"Not found"});
    const tx=rows[0];
    await withTransaction(async(client)=>{
      await client.query("DELETE FROM transactions WHERE id=$1",[tx.id]);
      const delta=(tx.type==="income"||tx.type==="transfer_in")?-parseFloat(tx.amount_kes):parseFloat(tx.amount_kes);
      await client.query("UPDATE wallets SET balance=balance+$1 WHERE id=$2",[delta,tx.wallet_id]);
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
    const lines=req.file.buffer.toString("utf-8").trim().split("\n").filter(l=>l.trim());
    if(lines.length<2) return res.status(400).json({error:"File appears empty"});
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
      return {
        tx_date:  v[idx("date")]||new Date().toISOString().slice(0,10),
        type:     ["expense","income","transfer_in","transfer_out"].includes(type)?type:"expense",
        cat_id:   catMap[`${cat}:${type}`]||null,
        amount:   parseFloat(v[idx("amount_kes")]||v[idx("amount")]||"0")||0,
        merchant: v[idx("merchant")]||null,
        note:     v[idx("note")]||null,
        wallet_id:walMap[v[idx("wallet")]?.toLowerCase()]||defWal,
      };
    }).filter(r=>r.amount!==0&&r.wallet_id);

    if(!toInsert.length) return res.status(400).json({error:"No valid rows found. Check the column names match the template."});

    let imported=0;
    await withTransaction(async(client)=>{
      for(const r of toInsert){
        await client.query(
          "INSERT INTO transactions (user_id,wallet_id,category_id,type,amount_kes,merchant,note,tx_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
          [req.user.id,r.wallet_id,r.cat_id,r.type,r.amount,r.merchant,r.note,r.tx_date]
        );
        const delta=(r.type==="income"||r.type==="transfer_in")?r.amount:-r.amount;
        await client.query("UPDATE wallets SET balance=balance+$1 WHERE id=$2",[delta,r.wallet_id]);
        imported++;
      }
    });
    res.json({ok:true,imported});
  } catch(e){next(e);}
});

module.exports = router;
