"use strict";

const EXPENSE = [
  { name:"Rent / Mortgage", icon:"🏠", color:"#4A90E2", budget_kes:25000, watch:true  },
  { name:"Food & Dining",   icon:"🍔", color:"#F5A623", budget_kes:15000, watch:true  },
  { name:"Transport",       icon:"🚗", color:"#7ED321", budget_kes:8000,  watch:false },
  { name:"Utilities",       icon:"⚡", color:"#9B59B6", budget_kes:5000,  watch:false },
  { name:"Entertainment",   icon:"🎬", color:"#E74C3C", budget_kes:4000,  watch:false },
  { name:"Health",          icon:"💊", color:"#1ABC9C", budget_kes:5000,  watch:false },
  { name:"Shopping",        icon:"🛍️", color:"#E67E22", budget_kes:8000,  watch:false },
  { name:"Education",       icon:"📚", color:"#3498DB", budget_kes:3000,  watch:false },
  { name:"Subscriptions",   icon:"🔁", color:"#8E44AD", budget_kes:2000,  watch:false },
  { name:"Loan Repayment",  icon:"🏦", color:"#E74C3C", budget_kes:0,     watch:false, is_system:true },
];

const INCOME = [
  { name:"Salary",            icon:"💼", color:"#00D4AA", budget_kes:0 },
  { name:"Freelance",         icon:"💻", color:"#4A90E2", budget_kes:0 },
  { name:"Investment Return", icon:"📈", color:"#F5C842", budget_kes:0 },
  { name:"Interest",          icon:"🏦", color:"#2ECC71", budget_kes:0 },
  { name:"Dividend",          icon:"💹", color:"#E67E22", budget_kes:0 },
  { name:"Rental Income",     icon:"🏠", color:"#9B59B6", budget_kes:0 },
  { name:"Other Income",      icon:"💵", color:"#2ECC71", budget_kes:0 },
];

const seed = async (client, userId) => {
  let order = 0;
  for (const c of EXPENSE) {
    await client.query(
      `INSERT INTO categories (user_id,name,type,icon,color,budget_kes,watch,is_system,sort_order)
       VALUES ($1,$2,'expense',$3,$4,$5,$6,$7,$8)
       ON CONFLICT (user_id,name,type) DO NOTHING`,
      [userId, c.name, c.icon, c.color, c.budget_kes, c.watch||false, c.is_system||false, order++]
    );
  }
  for (const c of INCOME) {
    await client.query(
      `INSERT INTO categories (user_id,name,type,icon,color,budget_kes,sort_order)
       VALUES ($1,$2,'income',$3,$4,$5,$6)
       ON CONFLICT (user_id,name,type) DO NOTHING`,
      [userId, c.name, c.icon, c.color, c.budget_kes, order++]
    );
  }
};

module.exports = { seed };
