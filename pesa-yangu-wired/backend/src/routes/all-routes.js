// ── This file is split by comment headers; each section is its own module ──
// The developer should split these into individual files in src/routes/
// OR use the single-file loader at the bottom of this file.
"use strict";

const express = require("express");
const multer  = require("multer");
const { z }   = require("zod");
const Anthropic = require("@anthropic-ai/sdk");
const { query, withTransaction } = require("../models/db");
const { requirePro } = require("../middleware/auth");
const { getRates }   = require("../services/fx");
const logger = require("../services/logger");
// 5 MB cap — CSV files never need more; protects against DoS via large uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["text/csv", "text/plain", "application/vnd.ms-excel", "application/octet-stream"];
    if (!allowed.includes(file.mimetype) && !file.originalname.toLowerCase().endsWith(".csv")) {
      return cb(Object.assign(new Error("Only CSV files are allowed"), { status: 400 }));
    }
    cb(null, true);
  },
});

// ══════════════════════════════════════════════════════════════════════════════
// CATEGORIES
// ══════════════════════════════════════════════════════════════════════════════
const categoryRouter = express.Router();

categoryRouter.get("/", async (req,res,next)=>{
  try { const {rows}=await query("SELECT * FROM categories WHERE user_id=$1 ORDER BY type,sort_order",[req.user.id]); res.json({categories:rows}); } catch(e){next(e);}
});

// Walks parent_id ancestors of `startId` and returns true if `targetId` is among them
// (i.e. making startId's parent = targetId would create a cycle).
async function wouldCreateCycle(userId, startId, targetId) {
  if (!targetId) return false;
  if (targetId === startId) return true;
  const {rows}=await query(`
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id FROM categories WHERE id=$1 AND user_id=$2
      UNION ALL
      SELECT c.id, c.parent_id FROM categories c JOIN ancestors a ON c.id=a.parent_id
    )
    SELECT 1 FROM ancestors WHERE id=$3`, [targetId, userId, startId]);
  return rows.length>0;
}

const allocationFields = z.object({
  parent_id:         z.string().uuid().nullable().optional(),
  allocation_type:   z.enum(["fixed","percent"]).default("fixed"),
  percent_of_parent: z.number().min(0).max(100).nullable().optional(),
  spend_kind:        z.enum(["fixed","variable"]).nullable().optional(),
  linked_wallet_id:  z.string().uuid().nullable().optional(),
}).refine(d => d.allocation_type!=="percent" || d.percent_of_parent!=null, {message:"percent_of_parent is required when allocation_type is 'percent'"});

categoryRouter.post("/", async (req,res,next)=>{
  try {
    const base=z.object({name:z.string().min(1).max(60).trim(),type:z.enum(["expense","income"]),icon:z.string().max(10).default("🏷️"),color:z.string().max(20).default("#4A90E2"),budget_kes:z.number().min(0).max(1e9).default(0),watch:z.boolean().default(false)}).parse(req.body);
    const alloc=allocationFields.parse(req.body);
    const percentOfParent = alloc.allocation_type==="percent" ? alloc.percent_of_parent : null;
    if (alloc.parent_id) {
      const {rows:pr}=await query("SELECT id FROM categories WHERE id=$1 AND user_id=$2 AND type=$3",[alloc.parent_id,req.user.id,base.type]);
      if(!pr.length) return res.status(400).json({error:"Parent category not found"});
    }
    if (alloc.linked_wallet_id) {
      const {rows:wr}=await query("SELECT id FROM wallets WHERE id=$1 AND user_id=$2",[alloc.linked_wallet_id,req.user.id]);
      if(!wr.length) return res.status(400).json({error:"Linked wallet not found"});
    }
    const {rows}=await query(
      `INSERT INTO categories (user_id,name,type,icon,color,budget_kes,watch,parent_id,allocation_type,percent_of_parent,spend_kind,linked_wallet_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (user_id,name,type) DO UPDATE SET icon=$4,color=$5,budget_kes=$6,watch=$7,parent_id=$8,allocation_type=$9,percent_of_parent=$10,spend_kind=$11,linked_wallet_id=$12 RETURNING *`,
      [req.user.id,base.name,base.type,base.icon,base.color,base.budget_kes,base.watch,alloc.parent_id||null,alloc.allocation_type,percentOfParent,alloc.spend_kind||null,alloc.linked_wallet_id||null]
    );
    res.status(201).json({category:rows[0]});
  } catch(e){if(e instanceof z.ZodError) return res.status(400).json({error:e.errors[0].message}); next(e);}
});

categoryRouter.patch("/:id", async (req,res,next)=>{
  try {
    const allowed=["name","icon","color","budget_kes","watch","sort_order","parent_id","allocation_type","percent_of_parent","spend_kind","linked_wallet_id"];
    const u=Object.fromEntries(Object.entries(req.body).filter(([k])=>allowed.includes(k)));
    if(!Object.keys(u).length) return res.status(400).json({error:"No valid fields"});
    if("allocation_type" in u && !["fixed","percent"].includes(u.allocation_type)) return res.status(400).json({error:"Invalid allocation_type"});
    if(u.allocation_type==="percent" && u.percent_of_parent==null) return res.status(400).json({error:"percent_of_parent is required when allocation_type is 'percent'"});
    if("parent_id" in u && u.parent_id) {
      if(await wouldCreateCycle(req.user.id, req.params.id, u.parent_id)) return res.status(400).json({error:"That would create a circular category hierarchy"});
    }
    if("linked_wallet_id" in u && u.linked_wallet_id) {
      const {rows:wr}=await query("SELECT id FROM wallets WHERE id=$1 AND user_id=$2",[u.linked_wallet_id,req.user.id]);
      if(!wr.length) return res.status(400).json({error:"Linked wallet not found"});
    }
    const sets=Object.keys(u).map((k,i)=>`${k}=$${i+3}`);
    const {rows}=await query(`UPDATE categories SET ${sets.join(",")} WHERE id=$1 AND user_id=$2 RETURNING *`,[req.params.id,req.user.id,...Object.values(u)]);
    if(!rows.length) return res.status(404).json({error:"Not found"});
    res.json({category:rows[0]});
  } catch(e){next(e);}
});

categoryRouter.delete("/:id", async (req,res,next)=>{
  try {
    const {rows}=await query("SELECT is_system FROM categories WHERE id=$1 AND user_id=$2",[req.params.id,req.user.id]);
    if(!rows.length) return res.status(404).json({error:"Not found"});
    if(rows[0].is_system) return res.status(403).json({error:"System categories cannot be deleted"});
    const {rows:kids}=await query("SELECT COUNT(*)::int AS n FROM categories WHERE parent_id=$1 AND user_id=$2",[req.params.id,req.user.id]);
    if(kids[0].n>0) return res.status(409).json({error:`Category has ${kids[0].n} sub-categor${kids[0].n===1?"y":"ies"} — reparent or delete them first`});
    // Null out category_id on transactions referencing this category
    await query("UPDATE transactions SET category_id=NULL WHERE category_id=$1 AND user_id=$2",[req.params.id,req.user.id]);
    await query("DELETE FROM categories WHERE id=$1 AND user_id=$2",[req.params.id,req.user.id]);
    res.json({ok:true});
  } catch(e){next(e);}
});

// ══════════════════════════════════════════════════════════════════════════════
// BUDGETS
// ══════════════════════════════════════════════════════════════════════════════
const budgetRouter = express.Router();

// GET /budgets?year=2026&month=6
// Returns categories with actual spending for the given month.
// monthly_budgets row overrides the category's default budget_kes for that month.
budgetRouter.get("/", async (req,res,next)=>{
  try {
    const now   = new Date();
    const year  = parseInt(req.query.year  || now.getFullYear(),  10);
    const month = parseInt(req.query.month || now.getMonth() + 1, 10);
    const {rows}=await query(
      `SELECT c.*,
              COALESCE(mb.budget_kes, c.budget_kes) AS effective_budget,
              mb.budget_kes                          AS monthly_budget_kes,
              COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount_kes
                                WHEN t.type='income'  THEN t.amount_kes
                                ELSE 0 END
                           * CASE WHEN t.type='expense' THEN 1 ELSE 0 END
                         ),0)                        AS spent_kes,
              COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount_kes ELSE 0 END),0) AS earned_kes
       FROM categories c
       LEFT JOIN monthly_budgets mb
              ON mb.category_id=c.id AND mb.user_id=c.user_id
             AND mb.year=$2 AND mb.month=$3
       LEFT JOIN transactions t
              ON t.category_id=c.id AND t.user_id=c.user_id
             AND EXTRACT(YEAR  FROM t.tx_date)=$2
             AND EXTRACT(MONTH FROM t.tx_date)=$3
             AND t.type IN ('expense','income')
       WHERE c.user_id=$1
       GROUP BY c.id, mb.budget_kes
       ORDER BY c.type, c.sort_order`,
      [req.user.id, year, month]
    );
    res.json({budgets:rows, year, month});
  } catch(e){next(e);}
});

// POST /budgets — set default (non-month-specific) budget on category
budgetRouter.post("/", async (req,res,next)=>{
  try {
    const {category_id,budget_kes}=z.object({category_id:z.string().uuid(),budget_kes:z.number().min(0)}).parse(req.body);
    const {rows}=await query("UPDATE categories SET budget_kes=$1 WHERE id=$2 AND user_id=$3 RETURNING *",[budget_kes,category_id,req.user.id]);
    if(!rows.length) return res.status(404).json({error:"Category not found"});
    res.json({category:rows[0]});
  } catch(e){if(e instanceof z.ZodError) return res.status(400).json({error:e.errors[0].message}); next(e);}
});

// POST /budgets/monthly — upsert a budget for a specific month
budgetRouter.post("/monthly", async (req,res,next)=>{
  try {
    const {category_id,year,month,budget_kes}=z.object({
      category_id:z.string().uuid(),
      year:z.number().int().min(2000).max(2100),
      month:z.number().int().min(1).max(12),
      budget_kes:z.number().min(0),
    }).parse(req.body);
    const {rows}=await query(
      `INSERT INTO monthly_budgets (user_id,category_id,year,month,budget_kes)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id,category_id,year,month)
       DO UPDATE SET budget_kes=$5, updated_at=NOW()
       RETURNING *`,
      [req.user.id,category_id,year,month,budget_kes]
    );
    res.json({budget:rows[0]});
  } catch(e){if(e instanceof z.ZodError) return res.status(400).json({error:e.errors[0].message}); next(e);}
});

// GET /budgets/trend?months=6 — last N months: total budgeted vs total spent per month
budgetRouter.get("/trend", async (req,res,next)=>{
  try {
    const n = Math.min(parseInt(req.query.months||"6",10), 24);
    const {rows}=await query(
      `WITH months AS (
         SELECT generate_series(
           date_trunc('month', CURRENT_DATE) - ((${n}-1) * INTERVAL '1 month'),
           date_trunc('month', CURRENT_DATE),
           INTERVAL '1 month'
         ) AS m
       )
       SELECT
         EXTRACT(YEAR  FROM mo.m)::int AS year,
         EXTRACT(MONTH FROM mo.m)::int AS month,
         TO_CHAR(mo.m,'Mon YYYY')      AS label,
         COALESCE(SUM(COALESCE(mb.budget_kes, c.budget_kes)),0)::numeric(15,2) AS total_budget,
         COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount_kes ELSE 0 END),0)::numeric(15,2) AS total_spent,
         COALESCE(SUM(CASE WHEN t.type='income'  THEN t.amount_kes ELSE 0 END),0)::numeric(15,2) AS total_earned
       FROM months mo
       CROSS JOIN (SELECT id, budget_kes FROM categories WHERE user_id=$1) c
       LEFT JOIN monthly_budgets mb
              ON mb.category_id=c.id AND mb.user_id=$1
             AND mb.year =EXTRACT(YEAR  FROM mo.m)
             AND mb.month=EXTRACT(MONTH FROM mo.m)
       LEFT JOIN transactions t
              ON t.category_id=c.id AND t.user_id=$1
             AND date_trunc('month',t.tx_date)=mo.m
             AND t.type IN ('expense','income')
       GROUP BY mo.m
       ORDER BY mo.m`,
      [req.user.id]
    );
    res.json({trend:rows});
  } catch(e){next(e);}
});

// ══════════════════════════════════════════════════════════════════════════════
// INCOME PLANS  — monthly Gross Income input for percentage-based budgeting.
// A month with no row carries forward the most recent prior month's value.
// ══════════════════════════════════════════════════════════════════════════════
const incomePlanRouter = express.Router();

incomePlanRouter.get("/", async (req,res,next)=>{
  try {
    const now = new Date();
    const year  = parseInt(req.query.year)  || now.getFullYear();
    const month = parseInt(req.query.month) || now.getMonth()+1;
    const {rows}=await query(
      `SELECT * FROM income_plans WHERE user_id=$1 AND (year,month) <= ($2,$3) ORDER BY year DESC, month DESC LIMIT 1`,
      [req.user.id, year, month]
    );
    if(!rows.length) return res.json({income:null});
    const row = rows[0];
    res.json({income:{...row, is_carried_forward: row.year!==year || row.month!==month}});
  } catch(e){next(e);}
});

incomePlanRouter.post("/", async (req,res,next)=>{
  try {
    const d=z.object({year:z.number().int(),month:z.number().int().min(1).max(12),gross_income_kes:z.number().min(0).max(1e9)}).parse(req.body);
    const {rows}=await query(
      `INSERT INTO income_plans (user_id,year,month,gross_income_kes) VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id,year,month) DO UPDATE SET gross_income_kes=$4,updated_at=NOW() RETURNING *`,
      [req.user.id,d.year,d.month,d.gross_income_kes]
    );
    res.status(201).json({income:rows[0]});
  } catch(e){if(e instanceof z.ZodError) return res.status(400).json({error:e.errors[0].message}); next(e);}
});

// ══════════════════════════════════════════════════════════════════════════════
// GOALS
// ══════════════════════════════════════════════════════════════════════════════
const goalRouter = express.Router();

goalRouter.get("/", async (req,res,next)=>{
  try {
    const {rows}=await query("SELECT g.*,w.name AS wallet_name,w.currency AS wallet_currency FROM goals g JOIN wallets w ON w.id=g.wallet_id WHERE g.user_id=$1 ORDER BY g.created_at",[req.user.id]);
    res.json({goals:rows});
  } catch(e){next(e);}
});

goalRouter.post("/", async (req,res,next)=>{
  try {
    const d=z.object({
      wallet_id:  z.string().uuid().optional(),
      name:       z.string().min(1).max(100).trim(),
      icon:       z.string().max(10).default("🎯"),
      color:      z.string().max(20).default("#00D4AA"),
      target_kes: z.number().positive().max(1e9),
      saved_kes:  z.number().min(0).max(1e9).default(0),
      deadline:   z.string().max(20).optional(),
    }).parse(req.body);
    const goal = await withTransaction(async(client)=>{
      // Deduct opening balance from wallet if provided
      if(d.saved_kes>0 && d.wallet_id) {
        const {rows:wr}=await client.query("SELECT balance FROM wallets WHERE id=$1 AND user_id=$2 FOR UPDATE",[d.wallet_id,req.user.id]);
        if(!wr.length) throw Object.assign(new Error("Wallet not found"),{status:404});
        if(parseFloat(wr[0].balance)<d.saved_kes) throw Object.assign(new Error("Insufficient balance for opening amount"),{status:400});
        await client.query("UPDATE wallets SET balance=balance-$1 WHERE id=$2",[d.saved_kes,d.wallet_id]);
      }
      const {rows}=await client.query(
        "INSERT INTO goals (user_id,wallet_id,name,icon,color,target_kes,saved_kes,deadline) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        [req.user.id,d.wallet_id||null,d.name,d.icon,d.color,d.target_kes,d.saved_kes,d.deadline||null]
      );
      return rows[0];
    });
    res.status(201).json({goal});
  } catch(e){if(e instanceof z.ZodError) return res.status(400).json({error:e.errors[0].message}); next(e);}
});

goalRouter.post("/:id/fund", async (req,res,next)=>{
  try {
    const {amount, wallet_id}=z.object({
      amount:    z.number().positive(),
      wallet_id: z.string().uuid().optional(),
    }).parse(req.body);
    const {rows:gr}=await query("SELECT * FROM goals WHERE id=$1 AND user_id=$2",[req.params.id,req.user.id]);
    if(!gr.length) return res.status(404).json({error:"Goal not found"});
    const g=gr[0];
    const toAdd=Math.min(amount,parseFloat(g.target_kes)-parseFloat(g.saved_kes));
    if(toAdd<=0) return res.status(400).json({error:"Goal already reached"});
    // Use provided wallet_id or fall back to goal's linked wallet
    const sourceWalletId = wallet_id || g.wallet_id;
    if(!sourceWalletId) return res.status(400).json({error:"No source wallet specified"});
    const result=await withTransaction(async(client)=>{
      const {rows:wr}=await client.query("SELECT balance FROM wallets WHERE id=$1 AND user_id=$2 FOR UPDATE",[sourceWalletId,req.user.id]);
      if(!wr.length) throw Object.assign(new Error("Source wallet not found"),{status:404});
      if(parseFloat(wr[0].balance)<toAdd) throw Object.assign(new Error("Insufficient balance in selected account"),{status:400});
      await client.query("UPDATE wallets SET balance=balance-$1 WHERE id=$2",[toAdd,sourceWalletId]);
      const {rows}=await client.query("UPDATE goals SET saved_kes=saved_kes+$1,is_achieved=(saved_kes+$1>=target_kes) WHERE id=$2 RETURNING *",[toAdd,g.id]);
      return rows[0];
    });
    res.json({goal:result});
  } catch(e){if(e instanceof z.ZodError) return res.status(400).json({error:e.errors[0].message}); next(e);}
});

goalRouter.patch("/:id", async (req,res,next)=>{
  try {
    const d=z.object({
      name:       z.string().min(1).optional(),
      icon:       z.string().optional(),
      color:      z.string().optional(),
      target_kes: z.number().positive().optional(),
      deadline:   z.string().nullable().optional(),
      wallet_id:  z.string().uuid().optional(),
    }).parse(req.body);
    const { rows:gr } = await query("SELECT * FROM goals WHERE id=$1 AND user_id=$2",[req.params.id,req.user.id]);
    if(!gr.length) return res.status(404).json({error:"Not found"});
    const allowed=["name","icon","color","target_kes","deadline","wallet_id"];
    const updates=Object.fromEntries(Object.entries(d).filter(([k,v])=>v!==undefined&&allowed.includes(k)));
    if(!Object.keys(updates).length) return res.status(400).json({error:"No valid fields"});
    const sets=Object.keys(updates).map((k,i)=>`${k}=$${i+3}`);
    const {rows}=await query(`UPDATE goals SET ${sets.join(",")} WHERE id=$1 AND user_id=$2 RETURNING *`,[req.params.id,req.user.id,...Object.values(updates)]);
    res.json({goal:rows[0]});
  } catch(e){if(e instanceof z.ZodError) return res.status(400).json({error:e.errors[0].message}); next(e);}
});

goalRouter.delete("/:id", async (req,res,next)=>{
  try {
    const {rows}=await query("SELECT * FROM goals WHERE id=$1 AND user_id=$2",[req.params.id,req.user.id]);
    if(!rows.length) return res.status(404).json({error:"Not found"});
    const g=rows[0];
    await withTransaction(async(client)=>{
      // Return saved amount to the linked wallet
      if(g.wallet_id && parseFloat(g.saved_kes)>0) {
        await client.query("UPDATE wallets SET balance=balance+$1 WHERE id=$2 AND user_id=$3",[g.saved_kes,g.wallet_id,req.user.id]);
      }
      await client.query("DELETE FROM goals WHERE id=$1",[g.id]);
    });
    res.json({ok:true, returned_kes: parseFloat(g.saved_kes)||0});
  } catch(e){next(e);}
});

// ══════════════════════════════════════════════════════════════════════════════
// INVESTMENTS
// ══════════════════════════════════════════════════════════════════════════════
const investmentRouter = express.Router();

investmentRouter.get("/", async (req,res,next)=>{
  try {
    const {rows:invs}=await query("SELECT * FROM investments WHERE user_id=$1 ORDER BY created_at",[req.user.id]);
    for(const inv of invs){
      const {rows}=await query("SELECT * FROM investment_returns WHERE investment_id=$1 ORDER BY return_date DESC",[inv.id]);
      inv.returns=rows;
    }
    res.json({investments:invs});
  } catch(e){next(e);}
});

investmentRouter.post("/", async (req,res,next)=>{
  try {
    const d=z.object({wallet_id:z.string().uuid(),name:z.string().min(1).max(100).trim(),ticker:z.string().max(20).optional(),type:z.string().max(50).default("Stock"),currency:z.string().length(3).default("KES"),units:z.number().positive().max(1e9),buy_price_kes:z.number().positive().max(1e12),current_price_kes:z.number().positive().max(1e12).optional()}).parse(req.body);
    const {rows}=await query("INSERT INTO investments (user_id,wallet_id,name,ticker,type,currency,units,buy_price_kes,current_price_kes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
      [req.user.id,d.wallet_id,d.name,d.ticker||null,d.type,d.currency,d.units,d.buy_price_kes,d.current_price_kes||d.buy_price_kes]);
    res.status(201).json({investment:{...rows[0],returns:[]}});
  } catch(e){if(e instanceof z.ZodError) return res.status(400).json({error:e.errors[0].message}); next(e);}
});

investmentRouter.patch("/:id", async (req,res,next)=>{
  try {
    const d=z.object({
      name:              z.string().min(1).optional(),
      ticker:            z.string().nullable().optional(),
      type:              z.string().optional(),
      currency:          z.string().length(3).optional(),
      units:             z.number().positive().optional(),
      buy_price_kes:     z.number().positive().optional(),
      current_price_kes: z.number().positive().optional(),
      wallet_id:         z.string().uuid().optional(),
    }).parse(req.body);
    const allowed=["name","ticker","type","currency","units","buy_price_kes","current_price_kes","wallet_id"];
    const updates=Object.fromEntries(Object.entries(d).filter(([k,v])=>v!==undefined&&allowed.includes(k)));
    if(!Object.keys(updates).length) return res.status(400).json({error:"No valid fields"});
    const sets=Object.keys(updates).map((k,i)=>`${k}=$${i+3}`);
    const {rows}=await query(`UPDATE investments SET ${sets.join(",")} WHERE id=$1 AND user_id=$2 RETURNING *`,[req.params.id,req.user.id,...Object.values(updates)]);
    if(!rows.length) return res.status(404).json({error:"Not found"});
    res.json({investment:rows[0]});
  } catch(e){if(e instanceof z.ZodError) return res.status(400).json({error:e.errors[0].message}); next(e);}
});

investmentRouter.delete("/:id/returns/:rid", async (req,res,next)=>{
  try {
    const {rows}=await query(
      "SELECT r.*,i.user_id FROM investment_returns r JOIN investments i ON i.id=r.investment_id WHERE r.id=$1 AND i.id=$2 AND i.user_id=$3",
      [req.params.rid,req.params.id,req.user.id]
    );
    if(!rows.length) return res.status(404).json({error:"Return not found"});
    const r=rows[0];
    await withTransaction(async(client)=>{
      // Reverse wallet credit
      if(r.wallet_id) await client.query("UPDATE wallets SET balance=balance-$1 WHERE id=$2",[parseFloat(r.amount_kes),r.wallet_id]);
      await client.query("DELETE FROM investment_returns WHERE id=$1",[r.id]);
    });
    res.json({ok:true});
  } catch(e){next(e);}
});

investmentRouter.delete("/:id", async (req,res,next)=>{
  try {
    const {rows}=await query("SELECT id FROM investments WHERE id=$1 AND user_id=$2",[req.params.id,req.user.id]);
    if(!rows.length) return res.status(404).json({error:"Not found"});
    // Reverse any return credits before deleting
    const {rows:rets}=await query("SELECT * FROM investment_returns WHERE investment_id=$1",[req.params.id]);
    await withTransaction(async(client)=>{
      for(const r of rets) {
        if(r.wallet_id) await client.query("UPDATE wallets SET balance=balance-$1 WHERE id=$2",[parseFloat(r.amount_kes),r.wallet_id]);
      }
      await client.query("DELETE FROM investment_returns WHERE investment_id=$1",[req.params.id]);
      await client.query("DELETE FROM investments WHERE id=$1 AND user_id=$2",[req.params.id,req.user.id]);
    });
    res.json({ok:true});
  } catch(e){next(e);}
});

investmentRouter.post("/:id/returns", async (req,res,next)=>{
  try {
    const {rows:ir}=await query("SELECT * FROM investments WHERE id=$1 AND user_id=$2",[req.params.id,req.user.id]);
    if(!ir.length) return res.status(404).json({error:"Investment not found"});
    const inv=ir[0];
    const d=z.object({wallet_id:z.string().uuid(),return_type:z.enum(["interest","dividend","capital_gain","coupon","other"]),amount_kes:z.number().positive(),return_date:z.string().optional(),note:z.string().optional()}).parse(req.body);
    const ret=await withTransaction(async(client)=>{
      const {rows}=await client.query("INSERT INTO investment_returns (investment_id,user_id,wallet_id,return_type,amount_kes,return_date,note) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [inv.id,req.user.id,d.wallet_id,d.return_type,d.amount_kes,d.return_date||new Date(),d.note||null]);
      await client.query("UPDATE wallets SET balance=balance+$1 WHERE id=$2",[d.amount_kes,d.wallet_id]);
      const catMap={interest:"Interest",dividend:"Dividend",capital_gain:"Investment Return",coupon:"Interest",other:"Other Income"};
      const {rows:cats}=await client.query("SELECT id FROM categories WHERE user_id=$1 AND name=$2 AND type='income' LIMIT 1",[req.user.id,catMap[d.return_type]||"Investment Return"]);
      await client.query("INSERT INTO transactions (user_id,wallet_id,category_id,type,amount_kes,merchant,note,tx_date) VALUES ($1,$2,$3,'income',$4,$5,$6,$7)",
        [req.user.id,d.wallet_id,cats[0]?.id||null,d.amount_kes,inv.name,d.note||null,d.return_date||new Date()]);
      return rows[0];
    });
    res.status(201).json({return:ret});
  } catch(e){if(e instanceof z.ZodError) return res.status(400).json({error:e.errors[0].message}); next(e);}
});

// ══════════════════════════════════════════════════════════════════════════════
// LOANS
// ══════════════════════════════════════════════════════════════════════════════
const loanRouter = express.Router();

loanRouter.get("/", async (req,res,next)=>{
  try {
    const {rows:loans}=await query("SELECT * FROM loans WHERE user_id=$1 ORDER BY created_at",[req.user.id]);
    for(const l of loans){
      const {rows}=await query("SELECT r.*,array_agg(a.filename) FILTER(WHERE a.id IS NOT NULL) AS attachments FROM loan_repayments r LEFT JOIN loan_attachments a ON a.repayment_id=r.id WHERE r.loan_id=$1 GROUP BY r.id ORDER BY r.payment_date DESC",[l.id]);
      l.repayments=rows;
    }
    res.json({loans});
  } catch(e){next(e);}
});

loanRouter.post("/", async (req,res,next)=>{
  try {
    const d=z.object({
      name:z.string().min(1).max(100).trim(), lender:z.string().max(100).optional(), currency:z.string().length(3).default("KES"),
      principal_kes:z.number().positive().max(1e12), remaining_kes:z.number().min(0).max(1e12).optional(),
      interest_rate:z.number().min(0).max(100).default(0),
      interest_type:z.enum(["simple","compound"]).default("compound"),
      term_months:z.number().int().min(1).max(600).optional(),
      monthly_payment_kes:z.number().min(0).max(1e12).default(0), next_due_date:z.string().max(20).optional(), note:z.string().max(500).optional(),
    }).parse(req.body);
    // Simple interest: fix total = principal × (1 + rate/100) at creation time
    const defaultRemaining = d.interest_type === "simple"
      ? d.principal_kes * (1 + d.interest_rate / 100)
      : d.principal_kes;
    const remaining_kes = d.remaining_kes ?? defaultRemaining;
    const {rows}=await query(
      "INSERT INTO loans (user_id,name,lender,currency,principal_kes,remaining_kes,interest_rate,interest_type,term_months,monthly_payment_kes,next_due_date,note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *",
      [req.user.id,d.name,d.lender||null,d.currency,d.principal_kes,remaining_kes,d.interest_rate,d.interest_type,d.term_months||null,d.monthly_payment_kes,d.next_due_date||null,d.note||null]);
    res.status(201).json({loan:{...rows[0],repayments:[]}});
  } catch(e){if(e instanceof z.ZodError) return res.status(400).json({error:e.errors[0].message}); next(e);}
});

loanRouter.post("/:id/repayments", upload.array("files",5), async (req,res,next)=>{
  try {
    const {rows:lr}=await query("SELECT * FROM loans WHERE id=$1 AND user_id=$2",[req.params.id,req.user.id]);
    if(!lr.length) return res.status(404).json({error:"Loan not found"});
    const loan=lr[0];
    const d=z.object({wallet_id:z.string().uuid(),total_kes:z.number().positive(),principal_kes:z.number().min(0).default(0),interest_kes:z.number().min(0).default(0),payment_date:z.string().optional(),note:z.string().optional()}).parse({
      ...req.body, total_kes:parseFloat(req.body.total_kes), principal_kes:parseFloat(req.body.principal_kes||0), interest_kes:parseFloat(req.body.interest_kes||0)
    });
    const rep=await withTransaction(async(client)=>{
      await client.query("UPDATE wallets SET balance=balance-$1 WHERE id=$2 AND user_id=$3",[d.total_kes,d.wallet_id,req.user.id]);
      // Simple interest: reduce remaining by total paid (interest baked in at creation)
      // Compound: reduce remaining by principal portion only
      const reduction = loan.interest_type === "simple" ? d.total_kes : d.principal_kes;
      await client.query("UPDATE loans SET remaining_kes=GREATEST(0,remaining_kes-$1),is_settled=(remaining_kes-$1<=0) WHERE id=$2",[reduction,loan.id]);
      const {rows}=await client.query("INSERT INTO loan_repayments (loan_id,user_id,wallet_id,total_kes,principal_kes,interest_kes,payment_date,note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        [loan.id,req.user.id,d.wallet_id,d.total_kes,d.principal_kes,d.interest_kes,d.payment_date||new Date(),d.note||null]);
      const {rows:cats}=await client.query("SELECT id FROM categories WHERE user_id=$1 AND name='Loan Repayment' AND type='expense' LIMIT 1",[req.user.id]);
      await client.query("INSERT INTO transactions (user_id,wallet_id,category_id,type,amount_kes,merchant,note,tx_date,loan_id,principal_paid,interest_paid) VALUES ($1,$2,$3,'expense',$4,$5,$6,$7,$8,$9,$10)",
        [req.user.id,d.wallet_id,cats[0]?.id||null,d.total_kes,loan.lender||loan.name,d.note||null,d.payment_date||new Date(),loan.id,d.principal_kes,d.interest_kes]);
      return rows[0];
    });
    res.status(201).json({repayment:rep});
  } catch(e){if(e instanceof z.ZodError) return res.status(400).json({error:e.errors[0].message}); next(e);}
});

loanRouter.patch("/:id", async (req,res,next)=>{
  try {
    const d=z.object({
      name:                z.string().min(1).max(100).optional(),
      lender:              z.string().max(100).nullable().optional(),
      currency:            z.string().length(3).optional(),
      principal_kes:       z.number().positive().optional(),
      remaining_kes:       z.number().min(0).optional(),
      interest_rate:       z.number().min(0).max(100).optional(),
      interest_type:       z.enum(["simple","compound"]).optional(),
      term_months:         z.number().int().min(1).max(600).nullable().optional(),
      monthly_payment_kes: z.number().min(0).optional(),
      next_due_date:       z.string().max(20).nullable().optional(),
      note:                z.string().max(500).nullable().optional(),
    }).parse(req.body);
    const allowed=["name","lender","currency","principal_kes","remaining_kes","interest_rate","interest_type","term_months","monthly_payment_kes","next_due_date","note"];
    const updates=Object.fromEntries(Object.entries(d).filter(([k,v])=>v!==undefined&&allowed.includes(k)));
    if(!Object.keys(updates).length) return res.status(400).json({error:"No valid fields"});
    const sets=Object.keys(updates).map((k,i)=>`${k}=$${i+3}`);
    const {rows}=await query(`UPDATE loans SET ${sets.join(",")} WHERE id=$1 AND user_id=$2 RETURNING *`,[req.params.id,req.user.id,...Object.values(updates)]);
    if(!rows.length) return res.status(404).json({error:"Not found"});
    res.json({loan:rows[0]});
  } catch(e){if(e instanceof z.ZodError) return res.status(400).json({error:e.errors[0].message}); next(e);}
});

loanRouter.patch("/:id/repayments/:rid", async (req,res,next)=>{
  try {
    const {rows:rr}=await query("SELECT r.*,l.user_id,l.interest_type FROM loan_repayments r JOIN loans l ON l.id=r.loan_id WHERE r.id=$1 AND l.id=$2 AND l.user_id=$3",[req.params.rid,req.params.id,req.user.id]);
    if(!rr.length) return res.status(404).json({error:"Repayment not found"});
    const old=rr[0];
    const d=z.object({
      wallet_id:    z.string().uuid().optional(),
      total_kes:    z.number().positive().optional(),
      principal_kes:z.number().min(0).optional(),
      interest_kes: z.number().min(0).optional(),
      payment_date: z.string().optional(),
      note:         z.string().nullable().optional(),
    }).parse(req.body);

    const newTotal    = d.total_kes     ?? parseFloat(old.total_kes);
    const newPrincipal= d.principal_kes ?? parseFloat(old.principal_kes);
    const newInterest = d.interest_kes  ?? parseFloat(old.interest_kes);
    const newWallet   = d.wallet_id     ?? old.wallet_id;
    const newDate     = d.payment_date  ?? old.payment_date;
    const newNote     = Object.prototype.hasOwnProperty.call(d,"note") ? d.note : old.note;
    const isSimple    = old.interest_type === "simple";

    const repayment = await withTransaction(async(client)=>{
      // Reverse old wallet debit and loan remaining effect
      await client.query("UPDATE wallets SET balance=balance+$1 WHERE id=$2",[parseFloat(old.total_kes),old.wallet_id]);
      const oldReduction = isSimple ? parseFloat(old.total_kes) : parseFloat(old.principal_kes);
      await client.query("UPDATE loans SET remaining_kes=remaining_kes+$1 WHERE id=$2",[oldReduction,req.params.id]);

      // Apply new
      await client.query("UPDATE wallets SET balance=balance-$1 WHERE id=$2",[newTotal,newWallet]);
      const newReduction = isSimple ? newTotal : newPrincipal;
      await client.query("UPDATE loans SET remaining_kes=GREATEST(0,remaining_kes-$1) WHERE id=$2",[newReduction,req.params.id]);

      const {rows}=await client.query(
        `UPDATE loan_repayments SET wallet_id=$1,total_kes=$2,principal_kes=$3,interest_kes=$4,payment_date=$5,note=$6 WHERE id=$7 RETURNING *`,
        [newWallet,newTotal,newPrincipal,newInterest,newDate,newNote,req.params.rid]
      );
      return rows[0];
    });
    res.json({repayment});
  } catch(e){if(e instanceof z.ZodError) return res.status(400).json({error:e.errors[0].message}); next(e);}
});

loanRouter.delete("/:id/repayments/:rid", async (req,res,next)=>{
  try {
    const {rows}=await query(
      "SELECT r.*,l.user_id,l.interest_type FROM loan_repayments r JOIN loans l ON l.id=r.loan_id WHERE r.id=$1 AND l.id=$2 AND l.user_id=$3",
      [req.params.rid,req.params.id,req.user.id]
    );
    if(!rows.length) return res.status(404).json({error:"Repayment not found"});
    const r=rows[0];
    await withTransaction(async(client)=>{
      // Reverse wallet deduction
      if(r.wallet_id) await client.query("UPDATE wallets SET balance=balance+$1 WHERE id=$2",[parseFloat(r.total_kes),r.wallet_id]);
      // Restore loan remaining — simple loans track total, compound loans track principal
      const restore = r.interest_type === "simple" ? parseFloat(r.total_kes) : parseFloat(r.principal_kes);
      await client.query("UPDATE loans SET remaining_kes=remaining_kes+$1 WHERE id=$2",[restore,req.params.id]);
      await client.query("DELETE FROM loan_repayments WHERE id=$1",[r.id]);
    });
    res.json({ok:true});
  } catch(e){next(e);}
});

loanRouter.delete("/:id", async (req,res,next)=>{
  try {
    const {rows}=await query("SELECT * FROM loans WHERE id=$1 AND user_id=$2",[req.params.id,req.user.id]);
    if(!rows.length) return res.status(404).json({error:"Not found"});
    await withTransaction(async(client)=>{
      // Reverse all repayment deductions from wallets
      const {rows:reps}=await client.query("SELECT * FROM loan_repayments WHERE loan_id=$1",[req.params.id]);
      for(const r of reps) {
        if(r.wallet_id) await client.query("UPDATE wallets SET balance=balance+$1 WHERE id=$2",[parseFloat(r.total_kes),r.wallet_id]);
      }
      await client.query("DELETE FROM loan_repayments WHERE loan_id=$1",[req.params.id]);
      await client.query("DELETE FROM loans WHERE id=$1",[req.params.id]);
    });
    res.json({ok:true});
  } catch(e){next(e);}
});

// ══════════════════════════════════════════════════════════════════════════════
// RECURRING
// ══════════════════════════════════════════════════════════════════════════════
const recurringRouter = express.Router();

recurringRouter.get("/", async (req,res,next)=>{
  try {
    const {rows}=await query("SELECT r.*,c.name AS category_name,c.icon AS category_icon,w.name AS wallet_name FROM recurring_transactions r LEFT JOIN categories c ON c.id=r.category_id LEFT JOIN wallets w ON w.id=r.wallet_id WHERE r.user_id=$1 ORDER BY r.next_date",[req.user.id]);
    res.json({recurring:rows});
  } catch(e){next(e);}
});

recurringRouter.post("/", async (req,res,next)=>{
  try {
    const d=z.object({wallet_id:z.string().uuid(),category_id:z.string().uuid().optional(),type:z.enum(["expense","income"]),amount_kes:z.number().positive(),merchant:z.string().optional(),note:z.string().optional(),freq:z.enum(["daily","weekly","monthly","yearly"]).default("monthly"),next_date:z.string(),loan_id:z.string().uuid().optional()}).parse(req.body);
    const {rows}=await query("INSERT INTO recurring_transactions (user_id,wallet_id,category_id,type,amount_kes,merchant,note,freq,next_date,loan_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
      [req.user.id,d.wallet_id,d.category_id||null,d.type,d.amount_kes,d.merchant||null,d.note||null,d.freq,d.next_date,d.loan_id||null]);
    res.status(201).json({recurring:rows[0]});
  } catch(e){if(e instanceof z.ZodError) return res.status(400).json({error:e.errors[0].message}); next(e);}
});

recurringRouter.patch("/:id/toggle", async (req,res,next)=>{
  try {
    const {rows}=await query("UPDATE recurring_transactions SET is_active=NOT is_active WHERE id=$1 AND user_id=$2 RETURNING *",[req.params.id,req.user.id]);
    if(!rows.length) return res.status(404).json({error:"Not found"});
    res.json({recurring:rows[0]});
  } catch(e){next(e);}
});

recurringRouter.delete("/:id", async (req,res,next)=>{
  try { await query("DELETE FROM recurring_transactions WHERE id=$1 AND user_id=$2",[req.params.id,req.user.id]); res.json({ok:true}); } catch(e){next(e);}
});

// ══════════════════════════════════════════════════════════════════════════════
// FX RATES
// ══════════════════════════════════════════════════════════════════════════════
const fxRouter = express.Router();
fxRouter.get("/", async (req,res,next)=>{
  try { const rates=await getRates(); res.json({rates,base:"KES",ts:new Date().toISOString()}); } catch(e){next(e);}
});

// ══════════════════════════════════════════════════════════════════════════════
// AI ADVICE
// ══════════════════════════════════════════════════════════════════════════════
const aiRouter  = express.Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const aiContextSchema = z.object({
  baseCurrency:   z.string().length(3).default("KES"),
  totalBalance:   z.number().optional(),
  totalIncome:    z.number().optional(),
  totalExpenses:  z.number().optional(),
  topCategories:  z.array(z.object({ name:z.string().max(60), spent:z.number(), budget:z.number() })).max(20).optional(),
  goals:          z.array(z.object({ name:z.string().max(100), saved:z.number(), target:z.number() })).max(20).optional(),
  loans:          z.array(z.object({ name:z.string().max(100), remaining:z.number(), rate:z.number() })).max(20).optional(),
  watchedAlerts:  z.array(z.string().max(60)).max(10).optional(),
});

aiRouter.post("/advice", async (req,res,next)=>{
  try {
    if(!process.env.ANTHROPIC_API_KEY){
      return res.status(503).json({error:"AI advisor is not configured. Please contact support."});
    }
    // Validate and sanitize context — reject arbitrary keys/values
    const context = aiContextSchema.parse(req.body.context ?? req.body);
    const aiClient = new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY});
    const msg=await aiClient.messages.create({
      model:"claude-haiku-4-5-20251001", max_tokens:1000,
      messages:[{role:"user",content:`You are a sharp, warm personal finance advisor for a user in Kenya managing finances in ${context.baseCurrency}. Based on their data below, give 5 specific, numbered, actionable insights covering: spending vs budget, watched categories, goals progress, loan strategy, and one forward-looking prediction. Be direct and data-led. Data: ${JSON.stringify(context)}`}],
    });
    res.json({advice:msg.content[0]?.text||""});
  } catch(e){
    if(e instanceof z.ZodError) return res.status(400).json({error:"Invalid context: "+e.errors[0].message});
    if(e?.status===401||e?.message?.includes("apiKey")||e?.message?.includes("authentication")){
      return res.status(503).json({error:"AI advisor is not configured correctly. Check the API key."});
    }
    next(e);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// BILLING
// ══════════════════════════════════════════════════════════════════════════════
const billingRouter = express.Router();

billingRouter.get("/plans", (req,res)=>{
  res.json({
    current: req.user.plan,
    plans: {
      free: { name:"Free",  price_kes:0,   features:["Unlimited accounts","Unlimited goals","Unlimited loans","Unlimited investments","CSV export/import","App sharing"] },
      pro:  { name:"Pro ✦", price_kes:499, features:["Unlimited everything","Multi-currency","Reconciliation","AI advisor","Priority support"] },
    },
  });
});

billingRouter.post("/subscribe", async (req,res,next)=>{
  try {
    // TODO: integrate M-Pesa Daraja or Stripe
    // For now, directly upgrade the user (replace with real payment flow)
    const {provider="mpesa"}=req.body;
    await query("UPDATE users SET plan='pro', plan_expires_at=NOW()+INTERVAL '30 days' WHERE id=$1",[req.user.id]);
    logger.info({msg:"User upgraded",userId:req.user.id,provider});
    res.json({ok:true,plan:"pro"});
  } catch(e){next(e);}
});

billingRouter.post("/cancel", async (req,res,next)=>{
  try {
    await query("UPDATE users SET plan='free', plan_expires_at=NULL WHERE id=$1",[req.user.id]);
    res.json({ok:true,plan:"free"});
  } catch(e){next(e);}
});

// ══════════════════════════════════════════════════════════════════════════════
// RECONCILE
// ══════════════════════════════════════════════════════════════════════════════
const reconcileRouter = express.Router();

reconcileRouter.post("/parse", upload.single("file"), async (req,res,next)=>{
  try {
    if(!req.file) return res.status(400).json({error:"No file uploaded"});
    const {walletId}=z.object({walletId:z.string().uuid()}).parse(req.body);
    const lines=req.file.buffer.toString("utf-8").trim().split("\n").filter(l=>l.trim());
    if(lines.length<2) return res.status(400).json({error:"File appears empty"});
    const hdrs=lines[0].split(",").map(h=>h.trim().toLowerCase().replace(/["']/g,""));
    const get=(v,keys)=>{for(const k of keys){const i=hdrs.indexOf(k);if(i>=0&&v[i])return v[i];}return "";};
    const parsed=lines.slice(1).map(line=>{
      const v=line.split(",").map(x=>x.trim().replace(/^"|"$/g,""));
      const date=get(v,["date","transaction date","value date","txn date"]);
      const desc=get(v,["description","narration","details","merchant","reference","particulars"]);
      const debit=parseFloat(get(v,["debit","withdrawal","dr"])||"0")||0;
      const credit=parseFloat(get(v,["credit","deposit","cr"])||"0")||0;
      return {date,desc,amount:credit>0?credit:(debit>0?-debit:0)};
    }).filter(r=>r.date&&r.amount!==0);

    const {rows:existing}=await query("SELECT amount_kes,tx_date FROM transactions WHERE wallet_id=$1 AND user_id=$2",[walletId,req.user.id]);
    const rows=parsed.map(row=>{
      const match=existing.find(t=>t.tx_date===row.date&&Math.abs(parseFloat(t.amount_kes)-Math.abs(row.amount))<1);
      return {...row,status:match?"matched":"unmatched"};
    });
    res.json({rows,total:rows.length,matched:rows.filter(r=>r.status==="matched").length});
  } catch(e){if(e instanceof z.ZodError) return res.status(400).json({error:e.errors[0].message}); next(e);}
});

reconcileRouter.post("/confirm", async (req,res,next)=>{
  try {
    const {rows:inputRows,walletId}=z.object({rows:z.array(z.any()),walletId:z.string().uuid()}).parse(req.body);
    const toImport=inputRows.filter(r=>r.amount!==0);
    let imported=0;
    await withTransaction(async(client)=>{
      for(const row of toImport){
        const type=row.amount>0?"income":"expense";
        const amount=Math.abs(row.amount);
        await client.query("INSERT INTO transactions (user_id,wallet_id,type,amount_kes,merchant,tx_date) VALUES ($1,$2,$3,$4,$5,$6)",
          [req.user.id,walletId,type,amount,row.desc||row.description,row.date]);
        const delta=type==="income"?amount:-amount;
        await client.query("UPDATE wallets SET balance=balance+$1 WHERE id=$2",[delta,walletId]);
        imported++;
      }
    });
    res.json({ok:true,imported});
  } catch(e){if(e instanceof z.ZodError) return res.status(400).json({error:e.errors[0].message}); next(e);}
});

// ══════════════════════════════════════════════════════════════════════════════
// INSURANCE POLICIES
// ══════════════════════════════════════════════════════════════════════════════
const insuranceRouter = express.Router();

const insuranceSchema = z.object({
  name:               z.string().min(1).max(200).trim(),
  provider:           z.string().max(100).default(""),
  policy_type:        z.enum(["life","education","medical","motor","property","last_expense","investment_linked"]).default("life"),
  policy_number:      z.string().max(100).optional(),
  premium_amount:     z.number().min(0).max(1e10).default(0),
  premium_frequency:  z.enum(["monthly","quarterly","annually"]).default("monthly"),
  start_date:         z.string().optional(),
  end_date:           z.string().optional(),
  sum_assured:        z.number().min(0).max(1e12).optional(),
  surrender_value:    z.number().min(0).max(1e12).optional(),
  amount_paid:        z.number().min(0).max(1e12).optional(),
  beneficiary:        z.string().max(200).optional(),
  wallet_id:          z.string().uuid().optional(),
  currency:           z.string().length(3).default("KES"),
  notes:              z.string().max(2000).optional(),
  is_active:          z.boolean().default(true),
});

insuranceRouter.get("/", async (req,res,next) => {
  try {
    const {rows} = await query("SELECT * FROM insurance_policies WHERE user_id=$1 ORDER BY created_at DESC", [req.user.id]);
    res.json({policies:rows});
  } catch(e){next(e);}
});

insuranceRouter.post("/", async (req,res,next) => {
  try {
    const d = insuranceSchema.parse(req.body);
    const {rows} = await query(
      `INSERT INTO insurance_policies (user_id,name,provider,policy_type,policy_number,premium_amount,premium_frequency,start_date,end_date,sum_assured,surrender_value,amount_paid,beneficiary,wallet_id,currency,notes,is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [req.user.id,d.name,d.provider,d.policy_type,d.policy_number||null,d.premium_amount,d.premium_frequency,d.start_date||null,d.end_date||null,d.sum_assured??null,d.surrender_value??null,d.amount_paid??null,d.beneficiary||null,d.wallet_id||null,d.currency,d.notes||null,d.is_active]
    );
    res.status(201).json({policy:rows[0]});
  } catch(e){if(e instanceof z.ZodError) return res.status(400).json({error:e.errors[0].message}); next(e);}
});

insuranceRouter.patch("/:id", async (req,res,next) => {
  try {
    const d = insuranceSchema.partial().parse(req.body);
    const allowed=["name","provider","policy_type","policy_number","premium_amount","premium_frequency","start_date","end_date","sum_assured","surrender_value","amount_paid","beneficiary","wallet_id","currency","notes","is_active"];
    const updates=Object.fromEntries(Object.entries(d).filter(([k])=>allowed.includes(k)));
    if(!Object.keys(updates).length) return res.status(400).json({error:"No valid fields"});
    const sets=Object.keys(updates).map((k,i)=>`${k}=$${i+3}`);
    const {rows}=await query(
      `UPDATE insurance_policies SET ${sets.join(",")},updated_at=NOW() WHERE id=$1 AND user_id=$2 RETURNING *`,
      [req.params.id,req.user.id,...Object.values(updates)]
    );
    if(!rows.length) return res.status(404).json({error:"Not found"});
    res.json({policy:rows[0]});
  } catch(e){if(e instanceof z.ZodError) return res.status(400).json({error:e.errors[0].message}); next(e);}
});

insuranceRouter.delete("/:id", async (req,res,next) => {
  try {
    const {rows}=await query("DELETE FROM insurance_policies WHERE id=$1 AND user_id=$2 RETURNING id",[req.params.id,req.user.id]);
    if(!rows.length) return res.status(404).json({error:"Not found"});
    res.json({ok:true});
  } catch(e){next(e);}
});

// ══════════════════════════════════════════════════════════════════════════════
// EXPORTS — each router exported for use in src/index.js
// ══════════════════════════════════════════════════════════════════════════════
module.exports = {
  categoryRouter,
  budgetRouter,
  incomePlanRouter,
  goalRouter,
  investmentRouter,
  loanRouter,
  recurringRouter,
  fxRouter,
  aiRouter,
  billingRouter,
  reconcileRouter,
  insuranceRouter,
};
