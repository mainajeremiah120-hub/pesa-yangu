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
const upload = multer({ storage: multer.memoryStorage(), limits:{ fileSize:20*1024*1024 } });

// ══════════════════════════════════════════════════════════════════════════════
// CATEGORIES
// ══════════════════════════════════════════════════════════════════════════════
const categoryRouter = express.Router();

categoryRouter.get("/", async (req,res,next)=>{
  try { const {rows}=await query("SELECT * FROM categories WHERE user_id=$1 ORDER BY type,sort_order",[req.user.id]); res.json({categories:rows}); } catch(e){next(e);}
});

categoryRouter.post("/", async (req,res,next)=>{
  try {
    const d=z.object({name:z.string().min(1),type:z.enum(["expense","income"]),icon:z.string().default("🏷️"),color:z.string().default("#4A90E2"),budget_kes:z.number().min(0).default(0),watch:z.boolean().default(false)}).parse(req.body);
    const {rows}=await query(
      `INSERT INTO categories (user_id,name,type,icon,color,budget_kes,watch) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (user_id,name,type) DO UPDATE SET icon=$4,color=$5,budget_kes=$6,watch=$7 RETURNING *`,
      [req.user.id,d.name,d.type,d.icon,d.color,d.budget_kes,d.watch]
    );
    res.status(201).json({category:rows[0]});
  } catch(e){if(e instanceof z.ZodError) return res.status(400).json({error:e.errors[0].message}); next(e);}
});

categoryRouter.patch("/:id", async (req,res,next)=>{
  try {
    const allowed=["name","icon","color","budget_kes","watch","sort_order"];
    const u=Object.fromEntries(Object.entries(req.body).filter(([k])=>allowed.includes(k)));
    if(!Object.keys(u).length) return res.status(400).json({error:"No valid fields"});
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
    await query("DELETE FROM categories WHERE id=$1",[req.params.id]);
    res.json({ok:true});
  } catch(e){next(e);}
});

// ══════════════════════════════════════════════════════════════════════════════
// BUDGETS
// ══════════════════════════════════════════════════════════════════════════════
const budgetRouter = express.Router();

budgetRouter.get("/", async (req,res,next)=>{
  try {
    const {rows}=await query(
      `SELECT c.*,COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount_kes ELSE 0 END),0) AS spent_kes
       FROM categories c LEFT JOIN transactions t ON t.category_id=c.id AND t.user_id=c.user_id AND date_trunc('month',t.tx_date)=date_trunc('month',CURRENT_DATE)
       WHERE c.user_id=$1 GROUP BY c.id ORDER BY c.type,c.sort_order`,
      [req.user.id]
    );
    res.json({budgets:rows});
  } catch(e){next(e);}
});

budgetRouter.post("/", async (req,res,next)=>{
  try {
    const {category_id,budget_kes}=z.object({category_id:z.string().uuid(),budget_kes:z.number().min(0)}).parse(req.body);
    const {rows}=await query("UPDATE categories SET budget_kes=$1 WHERE id=$2 AND user_id=$3 RETURNING *",[budget_kes,category_id,req.user.id]);
    if(!rows.length) return res.status(404).json({error:"Category not found"});
    res.json({category:rows[0]});
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
      name:       z.string().min(1),
      icon:       z.string().default("🎯"),
      color:      z.string().default("#00D4AA"),
      target_kes: z.number().positive(),
      saved_kes:  z.number().min(0).default(0),
      deadline:   z.string().optional(),
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
  try { await query("DELETE FROM goals WHERE id=$1 AND user_id=$2",[req.params.id,req.user.id]); res.json({ok:true}); } catch(e){next(e);}
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
    if(req.user.plan==="free"){const {rows}=await query("SELECT COUNT(*) FROM investments WHERE user_id=$1",[req.user.id]);if(parseInt(rows[0].count)>=3) return res.status(403).json({error:"Free plan allows 3 investments.",code:"PLAN_LIMIT"});}
    const d=z.object({wallet_id:z.string().uuid(),name:z.string().min(1),ticker:z.string().optional(),type:z.string().default("Stock"),currency:z.string().length(3).default("KES"),units:z.number().positive(),buy_price_kes:z.number().positive(),current_price_kes:z.number().positive().optional()}).parse(req.body);
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
    if(req.user.plan==="free"){const {rows}=await query("SELECT COUNT(*) FROM loans WHERE user_id=$1",[req.user.id]);if(parseInt(rows[0].count)>=2) return res.status(403).json({error:"Free plan allows 2 loans.",code:"PLAN_LIMIT"});}
    const d=z.object({name:z.string().min(1),lender:z.string().optional(),currency:z.string().length(3).default("KES"),principal_kes:z.number().positive(),interest_rate:z.number().min(0).default(0),monthly_payment_kes:z.number().min(0).default(0),next_due_date:z.string().optional(),note:z.string().optional()}).parse(req.body);
    const {rows}=await query("INSERT INTO loans (user_id,name,lender,currency,principal_kes,remaining_kes,interest_rate,monthly_payment_kes,next_due_date,note) VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9) RETURNING *",
      [req.user.id,d.name,d.lender||null,d.currency,d.principal_kes,d.interest_rate,d.monthly_payment_kes,d.next_due_date||null,d.note||null]);
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
      await client.query("UPDATE loans SET remaining_kes=GREATEST(0,remaining_kes-$1),is_settled=(remaining_kes-$1<=0) WHERE id=$2",[d.principal_kes,loan.id]);
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
      name:                z.string().min(1).optional(),
      lender:              z.string().nullable().optional(),
      currency:            z.string().length(3).optional(),
      principal_kes:       z.number().positive().optional(),
      remaining_kes:       z.number().min(0).optional(),
      interest_rate:       z.number().min(0).optional(),
      monthly_payment_kes: z.number().min(0).optional(),
      next_due_date:       z.string().nullable().optional(),
      note:                z.string().nullable().optional(),
    }).parse(req.body);
    const allowed=["name","lender","currency","principal_kes","remaining_kes","interest_rate","monthly_payment_kes","next_due_date","note"];
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
    const {rows:rr}=await query("SELECT r.*,l.user_id FROM loan_repayments r JOIN loans l ON l.id=r.loan_id WHERE r.id=$1 AND l.id=$2 AND l.user_id=$3",[req.params.rid,req.params.id,req.user.id]);
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

    const repayment = await withTransaction(async(client)=>{
      // Reverse old wallet debit and loan principal effect
      await client.query("UPDATE wallets SET balance=balance+$1 WHERE id=$2",[parseFloat(old.total_kes),old.wallet_id]);
      await client.query("UPDATE loans SET remaining_kes=remaining_kes+$1 WHERE id=$2",[parseFloat(old.principal_kes),req.params.id]);

      // Apply new
      await client.query("UPDATE wallets SET balance=balance-$1 WHERE id=$2",[newTotal,newWallet]);
      await client.query("UPDATE loans SET remaining_kes=GREATEST(0,remaining_kes-$1) WHERE id=$2",[newPrincipal,req.params.id]);

      const {rows}=await client.query(
        `UPDATE loan_repayments SET wallet_id=$1,total_kes=$2,principal_kes=$3,interest_kes=$4,payment_date=$5,note=$6 WHERE id=$7 RETURNING *`,
        [newWallet,newTotal,newPrincipal,newInterest,newDate,newNote,req.params.rid]
      );
      return rows[0];
    });
    res.json({repayment});
  } catch(e){if(e instanceof z.ZodError) return res.status(400).json({error:e.errors[0].message}); next(e);}
});

loanRouter.delete("/:id", async (req,res,next)=>{
  try { await query("DELETE FROM loans WHERE id=$1 AND user_id=$2",[req.params.id,req.user.id]); res.json({ok:true}); } catch(e){next(e);}
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

aiRouter.post("/advice", requirePro, async (req,res,next)=>{
  try {
    const {context}=req.body;
    if(!context) return res.status(400).json({error:"context required"});
    const msg=await anthropic.messages.create({
      model:"claude-sonnet-4-6", max_tokens:1000,
      messages:[{role:"user",content:`You are a sharp, warm personal finance advisor for a user in Kenya managing finances in ${context.baseCurrency||"KES"}. Based on their data below, give 5 specific, numbered, actionable insights covering: spending vs budget, watched categories, goals progress, loan strategy, and one forward-looking prediction. Be direct and data-led. Data: ${JSON.stringify(context)}`}],
    });
    res.json({advice:msg.content[0]?.text||""});
  } catch(e){next(e);}
});

// ══════════════════════════════════════════════════════════════════════════════
// BILLING
// ══════════════════════════════════════════════════════════════════════════════
const billingRouter = express.Router();

billingRouter.get("/plans", (req,res)=>{
  res.json({
    current: req.user.plan,
    plans: {
      free: { name:"Free",  price_kes:0,   features:["3 accounts","2 goals","2 loans","3 investments","100 transactions","CSV export/import","App sharing"] },
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

reconcileRouter.post("/parse", requirePro, upload.single("file"), async (req,res,next)=>{
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

reconcileRouter.post("/confirm", requirePro, async (req,res,next)=>{
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
// EXPORTS — each router exported for use in src/index.js
// ══════════════════════════════════════════════════════════════════════════════
module.exports = {
  categoryRouter,
  budgetRouter,
  goalRouter,
  investmentRouter,
  loanRouter,
  recurringRouter,
  fxRouter,
  aiRouter,
  billingRouter,
  reconcileRouter,
};
