/**
 * Pesa Yangu – App.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Fully wired to backend API. All data loaded from server on mount.
 * All mutations (add/update/delete) call the API then update local state
 * optimistically for a fast, responsive feel.
 *
 * Stack: React 18 + Vite → Vercel
 * API:   Express on Render  (VITE_API_URL env var)
 * Auth:  JWT (stored in localStorage, auto-refreshed by api.js interceptor)
 */

import { useState, useEffect, useMemo, useRef, useCallback, createContext, useContext, lazy, Suspense } from "react";
import AuthPage from "./pages/AuthPage.jsx";
import { useAuth } from "./hooks/useAuth.js";
import {
  walletsApi, txApi, catsApi, goalsApi, invsApi,
  loansApi, recurApi, fxApi, aiApi, billingApi, reconcileApi, authApi, ticketsApi, insuranceApi, pushApi,
  budgetsApi,
} from "./lib/api.js";
import { tokens, getTheme, setTheme as persistTheme } from "./theme.js";
import { ChatWidget } from "./components/ChatWidget.jsx";

// Lazy-loaded: only admins ever render AdminApp/AdminPanel, and Support
// Tickets is a rarely-visited screen — no reason every regular user
// downloads this code in their initial bundle.
const AdminApp   = lazy(() => import("./AdminDashboard.jsx").then(m => ({ default: m.AdminApp })));
const AdminPanel = lazy(() => import("./AdminDashboard.jsx").then(m => ({ default: m.AdminPanel })));
const SupportTickets = lazy(() => import("./components/SupportTickets.jsx").then(m => ({ default: m.SupportTickets })));

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS  — resolved dynamically from theme; see App() for C usage
// ─────────────────────────────────────────────────────────────────────────────
// Static accent colours shared by both themes (used outside component scope)
const ACCENT = {
  teal:"#00D4AA", gold:"#F5C842", coral:"#FF6B6B",
  blue:"#4A90E2", purple:"#9B59B6", green:"#2ECC71", orange:"#E67E22",
};

// ─────────────────────────────────────────────────────────────────────────────
// PLAN LIMITS
// ─────────────────────────────────────────────────────────────────────────────
// All features unlocked — billing restrictions removed
const PLAN_LIMITS = {
  free: { wallets:Infinity, txHistory:Infinity, goals:Infinity,
          investments:Infinity, loans:Infinity, aiAdvice:true,
          reconcile:true, multiCurrency:true },
  pro:  { wallets:Infinity, txHistory:Infinity, goals:Infinity,
          investments:Infinity, loans:Infinity, aiAdvice:true,
          reconcile:true, multiCurrency:true },
};

// ─────────────────────────────────────────────────────────────────────────────
// CURRENCY HELPERS  (rates overwritten from /fx-rates on mount)
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_CURRENCIES = [
  { code:"KES", symbol:"KSh", name:"Kenyan Shilling",    rate:1       },
  { code:"USD", symbol:"$",   name:"US Dollar",           rate:0.00775 },
  { code:"EUR", symbol:"€",   name:"Euro",                rate:0.00715 },
  { code:"GBP", symbol:"£",   name:"British Pound",       rate:0.00610 },
  { code:"UGX", symbol:"USh", name:"Ugandan Shilling",    rate:28.5    },
  { code:"TZS", symbol:"TSh", name:"Tanzanian Shilling",  rate:20.1    },
  { code:"ZAR", symbol:"R",   name:"South African Rand",  rate:0.143   },
  { code:"NGN", symbol:"₦",   name:"Nigerian Naira",      rate:12.6    },
];

const getCur  = (currencies, code) => currencies.find(c => c.code === code) || currencies[0];
const toKES   = (amt, code, currencies) => amt / getCur(currencies, code).rate;
const fromKES = (amt, code, currencies) => amt * getCur(currencies, code).rate;
const fmtC = (amtKES, dispCode, currencies, compact=false) => {
  const cur = getCur(currencies, dispCode);
  const val = fromKES(amtKES, dispCode, currencies);
  const opts = compact && Math.abs(val) >= 10000
    ? { notation:"compact", maximumFractionDigits:1 }
    : { minimumFractionDigits: dispCode==="KES"?0:2, maximumFractionDigits: dispCode==="KES"?0:2 };
  return cur.symbol + new Intl.NumberFormat("en-KE", opts).format(val);
};
const fmtPct = (n) => `${n>=0?"+":""}${n.toFixed(1)}%`;
const todayStr  = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const nowTimeStr = () => { const d = new Date(); return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0"); };
// Builds an unambiguous UTC instant from a local "YYYY-MM-DD" + "HH:mm" pair,
// instead of sending a naive/offset-less string to the backend — a
// timezone-less timestamp is interpreted using the DB session's timezone,
// which can silently shift the stored time by hours from what was intended.
const localDateTimeToISO = (dateStr, timeStr) => {
  const [y, mo, da] = (dateStr || todayStr()).split("-").map(Number);
  const [h, mi] = (timeStr || nowTimeStr()).split(":").map(Number);
  return new Date(y, mo - 1, da, h, mi, 0).toISOString();
};
const txTime = (tx) => {
  const ts = tx.tx_date;
  if (!ts || !String(ts).includes("T")) return "";
  const d = new Date(ts); if (isNaN(d)) return "";
  const h = d.getHours(), m = d.getMinutes();
  return (h === 0 && m === 0) ? "" : String(h).padStart(2,"0")+":"+String(m).padStart(2,"0");
};
const _MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtDate = (d) => {
  if (!d) return "—";
  const s = String(d).slice(0,10).split("-");
  if (s.length !== 3) return String(d);
  return `${parseInt(s[2])}-${_MONTHS[parseInt(s[1])-1]}-${s[0]}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// MIDNIGHT TICK — forces "today"-based state/memos to refresh on day change
// without needing a page reload or user interaction.
// ─────────────────────────────────────────────────────────────────────────────
function useMidnightTick() {
  const [tick, setTick] = useState(() => new Date().toDateString());
  useEffect(() => {
    let timeoutId;
    const scheduleNext = () => {
      const now = new Date();
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
      timeoutId = setTimeout(() => {
        setTick(new Date().toDateString());
        scheduleNext();
      }, nextMidnight.getTime() - now.getTime());
    };
    scheduleNext();
    return () => clearTimeout(timeoutId);
  }, []);
  return tick;
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV UTILITIES
// ─────────────────────────────────────────────────────────────────────────────
// ─── CSV / Export helpers ───────────────────────────────────────────────────
const TX_TEMPLATE_ROWS = [
  ["date","time","type","category","amount_kes","merchant","note","wallet","from_wallet","to_wallet"],
  ["2025-06-01","09:30","income","Salary","95000","Employer Ltd","June salary","Equity Bank","",""],
  ["2025-06-01","14:00","expense","Rent / Mortgage","25000","Landlord","June rent","Equity Bank","",""],
  ["2025-06-01","10:00","transfer","","10000","","Move to savings","","Equity Bank","KCB Savings"],
];
const TX_TEMPLATE = TX_TEMPLATE_ROWS.map(r=>r.join(",")).join("\n");

const WALLETS_TEMPLATE = [
  ["name","account_type","currency","opening_balance"],
  ["Equity Bank","current","KES","50000"],
  ["KCB Savings","savings","KES","20000"],
  ["MPESA","digital","KES","5000"],
].map(r=>r.join(",")).join("\n");

// Parse a CSV string into array of objects
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(",").map(h => h.trim().replace(/^["']|["']$/g,"").toLowerCase());
  const rows = lines.slice(1).map((line, idx) => {
    // Handle quoted fields
    const fields = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && !inQ) { inQ = true; continue; }
      if (ch === '"' && inQ && line[i+1] === '"') { cur += '"'; i++; continue; }
      if (ch === '"' && inQ) { inQ = false; continue; }
      if (ch === "," && !inQ) { fields.push(cur); cur = ""; continue; }
      cur += ch;
    }
    fields.push(cur);
    const obj = { _row: idx + 2 };
    headers.forEach((h, i) => { obj[h] = (fields[i] || "").trim(); });
    return obj;
  });
  return { headers, rows };
}

// Validate and classify rows
function validateImportRows(rows, wallets, expCats, incCats) {
  const walletByName = {};
  wallets.forEach(w => { walletByName[w.name.toLowerCase()] = w; });
  const catByName = {};
  expCats.forEach(c => { catByName[c.name.toLowerCase() + ":expense"] = c; });
  incCats.forEach(c => { catByName[c.name.toLowerCase() + ":income"] = c; });

  return rows.map(r => {
    const errors = [];
    const type = (r.type || "expense").toLowerCase();

    // Date + time
    const dateVal = r.date || r.tx_date || "";
    if (!dateVal || isNaN(Date.parse(dateVal))) errors.push("Invalid date");
    const timeVal = (r.time || "").trim() || "00:00";

    // Amount
    const amount = parseFloat(r.amount_kes || r.amount || 0);
    if (!amount || amount <= 0) errors.push("Invalid amount");

    // Type
    const validTypes = ["expense","income","transfer","transfer_in","transfer_out","refund"];
    if (!validTypes.includes(type)) errors.push(`Unknown type "${type}"`);

    // Wallet resolution
    let walletId = null, fromWalletId = null, toWalletId = null;
    if (type === "transfer") {
      const fw = walletByName[(r.from_wallet || "").toLowerCase()];
      const tw = walletByName[(r.to_wallet || "").toLowerCase()];
      if (!fw) errors.push(`from_wallet "${r.from_wallet}" not found`);
      if (!tw) errors.push(`to_wallet "${r.to_wallet}" not found`);
      fromWalletId = fw?.id || null;
      toWalletId   = tw?.id || null;
    } else {
      const w = walletByName[(r.wallet || "").toLowerCase()];
      if (!w) errors.push(`wallet "${r.wallet}" not found`);
      walletId = w?.id || null;
    }

    // Category (optional but warn if unrecognised)
    let catId = null;
    if (r.category && type !== "transfer") {
      const key = r.category.toLowerCase() + ":" + (type === "income" ? "income" : "expense");
      const cat = catByName[key];
      if (cat) catId = cat.id;
      // Not an error, just unmatched — we'll show it as a warning
    }

    return {
      ...r,
      _type:         type,
      _date:         dateVal,
      _time:         timeVal,
      _amount:       amount,
      _walletId:     walletId,
      _fromWalletId: fromWalletId,
      _toWalletId:   toWalletId,
      _catId:        catId,
      _errors:       errors,
      _valid:        errors.length === 0,
    };
  });
}

// Build export CSV for any array of objects
function toCSV(headers, rows) {
  const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [headers.join(","), ...rows.map(r => headers.map(h => esc(r[h])).join(","))].join("\n");
}

const downloadBlob = (blob, name) => {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
};

// ─────────────────────────────────────────────────────────────────────────────
// PRIMITIVE COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// THEME CONTEXT — lets primitive components read current C without prop drilling
// ─────────────────────────────────────────────────────────────────────────────
const ThemeCtx = createContext(null);
const useC = () => useContext(ThemeCtx);

const Badge = ({ children, color }) => {
  const C = useC();
  const col = color || C.teal;
  return (
    <span style={{ background:col+"22", color:col, border:`1px solid ${col}44`, borderRadius:20, padding:"2px 10px", fontSize:11, fontWeight:600, letterSpacing:"0.04em", whiteSpace:"nowrap" }}>
      {children}
    </span>
  );
};

const Card = ({ children, style={}, onClick, className="" }) => {
  const C = useC();
  return (
    <div
      onClick={onClick}
      className={`${onClick ? "interactive-card" : ""} ${className}`}
      style={{
        background:C.navyMid,
        borderRadius:16,
        padding:20,
        border:`1px solid ${C.navyLight}`,
        cursor:onClick?"pointer":"default",
        transition:"all 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)",
        ...style
      }}
    >
      {children}
    </div>
  );
};

const Chip = ({ label, value, color, sub }) => {
  const C = useC();
  return (
    <div style={{ background:C.navyLight, borderRadius:12, padding:"10px 14px" }}>
      <div style={{ color:C.textMuted, fontSize:10, marginBottom:4, textTransform:"uppercase", letterSpacing:"0.06em" }}>{label}</div>
      <div style={{ color:color||C.teal, fontSize:16, fontWeight:700, lineHeight:1.2 }}>{value}</div>
      {sub && <div style={{ color:C.textFaint, fontSize:10, marginTop:3 }}>{sub}</div>}
    </div>
  );
};

const Bar = ({ value, max, color }) => {
  const C = useC();
  const pct = Math.min((value/Math.max(max,1))*100, 100);
  const col = value>max?C.coral:pct>80?C.gold:(color||C.teal);
  return <div style={{ background:C.navyLight, borderRadius:8, height:6, overflow:"hidden" }}>
    <div style={{ width:`${pct}%`, height:"100%", background:col, borderRadius:8, transition:"width 0.6s ease" }}/>
  </div>;
};

const Sparkline = ({ values, color, width=100, height=40 }) => {
  const C = useC();
  if (!values||values.length<2) return null;
  const min=Math.min(...values), max=Math.max(...values), range=max-min||1;
  const pts = values.map((v,i)=>`${(i/(values.length-1))*width},${height-((v-min)/range)*height}`).join(" ");
  return <svg width={width} height={height} style={{ overflow:"visible", flexShrink:0 }}>
    <polyline points={pts} fill="none" stroke={color||C.teal} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
  </svg>;
};

const MiniBar = ({ data, height=90 }) => {
  const C = useC();
  const max = Math.max(...data.map(d=>d.value),1);
  return <div style={{ display:"flex", alignItems:"flex-end", gap:6, height }}>
    {data.map((d,i)=>(
      <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
        <div style={{ width:"100%", background:d.highlight?C.teal:C.navyLight, height:`${Math.max((d.value/max)*(height-18),3)}px`, borderRadius:"4px 4px 0 0", transition:"height 0.6s ease" }}/>
        <span style={{ color:C.textFaint, fontSize:9, whiteSpace:"nowrap" }}>{d.label}</span>
      </div>
    ))}
  </div>;
};

const HealthRing = ({ score }) => {
  const C = useC();
  const r=52,cx=64,cy=64,circ=2*Math.PI*r;
  const color = score>=75?C.teal:score>=50?C.gold:C.coral;
  return <div style={{ position:"relative", width:128, height:128, flexShrink:0 }}>
    <svg width={128} height={128} style={{ transform:"rotate(-90deg)" }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.navyLight} strokeWidth={10}/>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={10}
        strokeDasharray={`${(score/100)*circ} ${circ}`} strokeLinecap="round"
        style={{ transition:"stroke-dasharray 1s ease" }}/>
    </svg>
    <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
      <div style={{ color, fontSize:26, fontWeight:800, lineHeight:1 }}>{score}</div>
      <div style={{ color:C.textMuted, fontSize:9, letterSpacing:"0.08em", marginTop:2 }}>SCORE</div>
    </div>
  </div>;
};

const Modal = ({ open, onClose, title, children, wide=false }) => {
  const C = useC();
  if (!open) return null;
  return <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={onClose}>
    <div className="modal-container" style={{ background:C.navyMid, borderRadius:20, padding:28, width:"100%", maxWidth:wide?740:480, border:`1px solid ${C.navyLight}`, maxHeight:"94vh", overflowY:"auto", boxShadow:`0 20px 60px ${C.shadow}` }} onClick={e=>e.stopPropagation()}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:22 }}>
        <div style={{ color:C.textPrimary, fontSize:17, fontWeight:700 }}>{title}</div>
        <button onClick={onClose} style={{ background:C.navyLight, border:"none", color:C.textMuted, borderRadius:8, width:32, height:32, cursor:"pointer", fontSize:15 }}>✕</button>
      </div>
      {children}
    </div>
  </div>;
};

const Field = ({ label, type="text", value, onChange, placeholder, options, note }) => {
  const C = useC();
  const base = { background:C.navyLight, border:`1px solid ${C.inputBorder||C.navyLight}`, borderRadius:10, padding:"10px 14px", color:C.textPrimary, width:"100%", fontSize:13, outline:"none", boxSizing:"border-box" };
  return <div style={{ marginBottom:12 }}>
    {label&&<div style={{ color:C.textMuted, fontSize:11, marginBottom:5, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.05em" }}>{label}</div>}
    {options
      ? <select value={value} onChange={e=>onChange(e.target.value)} style={{...base,cursor:"pointer"}}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>
      : <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={base}
          onFocus={e=>e.target.style.borderColor=C.teal} onBlur={e=>e.target.style.borderColor=C.inputBorder||C.navyLight}/>}
    {note&&<div style={{ color:C.textFaint, fontSize:11, marginTop:4 }}>{note}</div>}
  </div>;
};


// ── Color Picker — swatch grid replacing the raw hex dropdown ────────────────
const ColorPicker = ({ label, value, onChange, colors }) => {
  const C = useC();
  return (
    <div style={{ marginBottom: 12 }}>
      {label && (
        <div style={{ color: C.textMuted, fontSize: 11, marginBottom: 7, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {label}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        {/* Live preview swatch */}
        <div style={{
          width: 26, height: 26, borderRadius: 7, flexShrink: 0,
          background: value,
          border: `2px solid ${value}`,
          boxShadow: `0 0 0 3px ${value}44`,
          transition: "background 0.2s, box-shadow 0.2s",
        }}/>
        {/* Swatch grid */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxWidth: 260 }}>
          {colors.map(col => (
            <button
              key={col}
              title={col}
              onClick={() => onChange(col)}
              style={{
                width: 16, height: 16, borderRadius: 5,
                background: col, border: "none",
                cursor: "pointer", flexShrink: 0,
                outline: value === col ? `2px solid white` : "2px solid transparent",
                outlineOffset: 1.5,
                boxShadow: value === col ? `0 0 0 1px ${col}` : "none",
                transform: value === col ? "scale(1.18)" : "scale(1)",
                transition: "transform 0.15s, outline 0.15s, box-shadow 0.15s",
              }}
              onMouseEnter={e => { if (col !== value) e.currentTarget.style.transform = "scale(1.1)"; }}
              onMouseLeave={e => { if (col !== value) e.currentTarget.style.transform = "scale(1)"; }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

const Btn = ({ children, onClick, color, outline=false, style={}, disabled=false, small=false, className="" }) => {
  const C = useC();
  const col = color || C.teal;
  return (
    <button onClick={onClick} disabled={disabled}
      className={`app-btn ${small ? "app-btn-small" : ""} ${className}`}
      style={{ background:outline?"transparent":col, color:outline?col:C.navy, border:`1.5px solid ${col}`, borderRadius:10, padding:small?"6px 12px":"9px 16px", cursor:disabled?"not-allowed":"pointer", fontWeight:700, fontSize:small?11:13, transition:"opacity 0.15s", opacity:disabled?0.45:1, ...style }}
      onMouseEnter={e=>{ if(!disabled) e.currentTarget.style.opacity="0.82"; }}
      onMouseLeave={e=>{ e.currentTarget.style.opacity=disabled?"0.45":"1"; }}>
      {children}
    </button>
  );
};

// Searchable category picker — replaces plain <select> for categories
const CatPicker = ({ value, onChange, categories, label, groupByParent=false }) => {
  const C = useC();
  const [query,  setQuery]  = useState("");
  const [open,   setOpen]   = useState(false);
  const ref = useRef(null);
  const selected = categories.find(c => c.id === value);
  const sorted = useMemo(() => {
    if (!groupByParent) return [...categories].sort((a,b) => a.name.localeCompare(b.name));
    const byId = {}; categories.forEach(c => byId[c.id] = c);
    const out = [];
    const addWithChildren = (c, depth) => {
      out.push({ ...c, __depth: depth });
      categories.filter(k => k.parentId === c.id).sort((a,b)=>a.name.localeCompare(b.name)).forEach(k => addWithChildren(k, depth+1));
    };
    categories.filter(c => !c.parentId || !byId[c.parentId]).sort((a,b)=>a.name.localeCompare(b.name)).forEach(c => addWithChildren(c, 0));
    return out;
  }, [categories, groupByParent]);
  const filtered = query.trim() ? sorted.filter(c => c.name.toLowerCase().includes(query.toLowerCase()) || c.icon.includes(query)) : sorted;

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setQuery(""); } };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div ref={ref} style={{ marginBottom: 12 }}>
      {label && <div style={{ fontSize:11, color:C.textMuted, marginBottom:5, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.05em" }}>{label}</div>}
      <div onClick={() => setOpen(o => !o)}
        style={{ background:C.navyLight, border:`1px solid ${open ? C.teal : (C.inputBorder||C.navyLight)}`, borderRadius: open ? "10px 10px 0 0" : 10, padding:"10px 14px", cursor:"pointer", fontSize:13, display:"flex", alignItems:"center", gap:8, transition:"border-color 0.15s" }}>
        {selected
          ? <><span style={{fontSize:16}}>{selected.icon}</span><span style={{fontWeight:600,color:C.textPrimary}}>{selected.name}</span></>
          : <span style={{color:C.textMuted}}>Select category…</span>}
        <span style={{marginLeft:"auto",color:C.textMuted,fontSize:10}}>{open?"▴":"▾"}</span>
      </div>
      {open && (
        <div style={{background:C.navyLight,borderRadius:"0 0 10px 10px",border:`1px solid ${C.teal}`,borderTop:"none",overflow:"hidden"}}>
          <div style={{padding:"8px 10px",borderBottom:`1px solid ${C.navyMid}`}}>
            <input autoFocus value={query} onChange={e=>setQuery(e.target.value)}
              placeholder="Search categories…"
              style={{background:C.navyMid,border:"none",borderRadius:7,padding:"7px 11px",color:C.textPrimary,width:"100%",fontSize:13,outline:"none",boxSizing:"border-box"}}/>
          </div>
          <div style={{maxHeight:200,overflowY:"auto"}}>
            {filtered.length===0 && <div style={{padding:"14px",color:C.textMuted,fontSize:13,textAlign:"center"}}>No categories match</div>}
            {filtered.map(c=>(
              <div key={c.id} onClick={()=>{onChange(c.id);setOpen(false);setQuery("");}}
                onMouseEnter={e=>e.currentTarget.style.background=c.id===value?c.color+"33":C.navyMid}
                onMouseLeave={e=>e.currentTarget.style.background=c.id===value?c.color+"22":"transparent"}
                style={{display:"flex",alignItems:"center",gap:10,padding:"9px 14px 9px "+(14+(c.__depth||0)*16)+"px",cursor:"pointer",background:c.id===value?c.color+"22":"transparent",borderLeft:`3px solid ${c.id===value?c.color:"transparent"}`}}>
                <span style={{fontSize:16,width:22,textAlign:"center",flexShrink:0}}>{c.icon}</span>
                <span style={{fontSize:13,fontWeight:c.id===value?700:500,color:c.id===value?c.color:C.textPrimary}}>{c.name}</span>
                {c.id===value&&<span style={{marginLeft:"auto",color:c.color,fontWeight:800,fontSize:12}}>✓</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const Divider = ({ label }) => {
  const C = useC();
  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, margin:"6px 0 14px" }}>
      <div style={{ flex:1, height:1, background:C.navyLight }}/>
      <span style={{ color:C.textFaint, fontSize:10, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em" }}>{label}</span>
      <div style={{ flex:1, height:1, background:C.navyLight }}/>
    </div>
  );
};

// Recursive node for percentage-mode budgeting: shows this category's cascaded
// Cap (top-down from Gross Income), actual Used (bottom-up from transactions),
// and Remaining, then recurses into its children — grouping them into Fixed /
// Variable sections when the children carry that tag.
const CategoryTree = ({ node, depth=0, childrenByParent, capById, usedById, disp, onEdit, onDelete, onAddChild, wallets, onAllocate, onViewHistory }) => {
  const C = useC();
  const [expanded, setExpanded] = useState(true);
  const [allocFrom, setAllocFrom] = useState("");
  const [allocAmt,  setAllocAmt]  = useState("");
  const kids = childrenByParent[node.id] || [];
  const cap = capById[node.id]||0, used = usedById[node.id]||0, remaining = cap-used;
  // A linked-wallet category's "used" is money allocated into its own
  // wallet, not money actually spent — allocating more than planned isn't
  // overspending, so it never gets the red over-budget treatment.
  const over = cap>0 && used>cap && !node.linkedWalletId;
  const fixedKids    = [...kids.filter(k=>k.spendKind==="fixed")].sort((a,b)=>a.name.localeCompare(b.name));
  const variableKids = [...kids.filter(k=>k.spendKind==="variable")].sort((a,b)=>a.name.localeCompare(b.name));
  const otherKids     = [...kids.filter(k=>!k.spendKind)].sort((a,b)=>a.name.localeCompare(b.name));
  const btnStyle = (color) => ({background:"none",border:`1px solid ${color}44`,borderRadius:7,color,padding:"5px 9px",cursor:"pointer",fontSize:10,fontWeight:600,minWidth:64,textAlign:"center"});
  const linkedWallet = node.linkedWalletId ? wallets.find(w=>w.id===node.linkedWalletId) : null;

  const renderKids = (list) => list.map(k=>(
    <CategoryTree key={k.id} node={k} depth={depth+1} childrenByParent={childrenByParent} capById={capById} usedById={usedById} disp={disp} onEdit={onEdit} onDelete={onDelete} onAddChild={onAddChild} wallets={wallets} onAllocate={onAllocate} onViewHistory={onViewHistory}/>
  ));

  return (
    <div style={{marginLeft: depth*14, marginBottom:8}}>
      <Card style={{borderLeft:over?`3px solid ${C.coral}`:node.watch?`3px solid ${C.gold}`:"3px solid transparent"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0,flex:1,cursor:"pointer"}}
            onClick={()=>{
              if (!kids.length) { onViewHistory?.(node); return; }
              if (!expanded) setExpanded(true); else onViewHistory?.(node);
            }}
            title={kids.length?(expanded?"View transactions in this category":"Expand"):"View transactions in this category"}>
            {kids.length>0 && <span onClick={e=>{e.stopPropagation();setExpanded(x=>!x);}} style={{color:C.textMuted,fontSize:11,width:12,flexShrink:0}}>{expanded?"▾":"▸"}</span>}
            <span style={{fontSize:18,flexShrink:0}}>{node.icon}</span>
            <div style={{minWidth:0}}>
              <div style={{fontWeight:600,fontSize:13,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                <span>{node.name}</span>
                {node.allocationType==="percent" && <Badge color={C.blue}>{node.percentOfParent}%</Badge>}
                {linkedWallet && <Badge color={C.purple}>💰 {linkedWallet.icon} {linkedWallet.name}</Badge>}
                {node.watch && <Badge color={C.gold}>👁</Badge>}
              </div>
              <div style={{fontSize:10,color:C.textMuted}}>
                Cap: {disp(cap)} · {node.linkedWalletId?"Allocated":"Used"}: {disp(used)} · {over
                  ? <span style={{color:C.coral}}>Over by {disp(used-cap)}</span>
                  : (node.linkedWalletId && used>cap)
                    ? <span style={{color:C.teal}}>✓ {disp(used-cap)} more than planned</span>
                    : <span>Remaining: {disp(remaining)}</span>}
              </div>
            </div>
          </div>
          <div style={{display:"flex",gap:6,flexShrink:0}}>
            <button onClick={()=>onAddChild(node.id)} style={btnStyle(C.teal)}>+ Sub</button>
            <button onClick={()=>onEdit(node)} style={btnStyle(C.textMuted)}>✏️ Edit</button>
            <button onClick={()=>onDelete(node)} style={btnStyle(C.coral)}>🗑</button>
          </div>
        </div>
        {cap>0 && <div style={{marginTop:10}}><Bar value={used} max={cap} color={node.color}/></div>}
        {node.goalTargetKes>0 && linkedWallet && (()=>{
          const saved = parseFloat(linkedWallet.balance||0);
          const days = node.goalDeadline ? Math.max(0, Math.ceil((new Date(node.goalDeadline)-new Date())/86400000)) : null;
          const months = days!=null ? Math.ceil(days/30) : null;
          return (
            <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.navyLight}`}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:C.textMuted,marginBottom:4}}>
                <span>🎯 Goal: {disp(saved)} / {disp(node.goalTargetKes)}</span>
                <span>{Math.min((saved/node.goalTargetKes)*100,100).toFixed(0)}%{months!=null?` · ${months}mo left`:""}</span>
              </div>
              <Bar value={saved} max={node.goalTargetKes} color={C.gold}/>
            </div>
          );
        })()}
        {linkedWallet && (
          <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.navyLight}`,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
            <select value={allocFrom} onChange={e=>setAllocFrom(e.target.value)} style={{background:C.navyLight,border:"none",borderRadius:8,color:C.textPrimary,padding:"7px 10px",fontSize:11,cursor:"pointer",flex:1,minWidth:140}}>
              <option value="">— Source account —</option>
              {wallets.filter(w=>w.id!==node.linkedWalletId).map(w=><option key={w.id} value={w.id}>{w.icon} {w.name} · {disp(parseFloat(w.balance||0))}</option>)}
            </select>
            <input type="number" value={allocAmt} onChange={e=>setAllocAmt(e.target.value)} placeholder="Amount"
              style={{background:C.navyLight,border:"none",borderRadius:8,color:C.textPrimary,padding:"7px 10px",fontSize:11,width:100}}/>
            <button onClick={()=>{ onAllocate(node.id, allocFrom, allocAmt); setAllocAmt(""); }} disabled={!allocFrom||!parseFloat(allocAmt)}
              style={{background:C.purple,border:"none",borderRadius:8,color:"#fff",padding:"7px 14px",cursor:allocFrom&&parseFloat(allocAmt)?"pointer":"not-allowed",fontSize:11,fontWeight:600,opacity:allocFrom&&parseFloat(allocAmt)?1:0.5}}>Allocate</button>
          </div>
        )}
      </Card>
      {expanded && kids.length>0 && (
        <div style={{marginTop:6}}>
          {renderKids(otherKids)}
          {fixedKids.length>0 && <Divider label="Fixed"/>}
          {renderKids(fixedKids)}
          {variableKids.length>0 && <Divider label="Variable"/>}
          {renderKids(variableKids)}
        </div>
      )}
    </div>
  );
};

const FileUpload = ({ label, accept, onFile, files=[] }) => {
  const C = useC();
  const ref = useRef();
  return <div style={{ marginBottom:14 }}>
    {label&&<div style={{ color:C.textMuted, fontSize:11, marginBottom:5, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.05em" }}>{label}</div>}
    <div onClick={()=>ref.current.click()} onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)onFile(f);}} onDragOver={e=>e.preventDefault()}
      style={{ border:`2px dashed ${C.navyLight}`, borderRadius:12, padding:16, textAlign:"center", cursor:"pointer" }}
      onMouseEnter={e=>e.currentTarget.style.borderColor=C.teal+"88"} onMouseLeave={e=>e.currentTarget.style.borderColor=C.navyLight}>
      <div style={{ fontSize:22, marginBottom:5 }}>📎</div>
      <div style={{ color:C.textMuted, fontSize:12 }}>Drop or <span style={{color:C.teal,fontWeight:600}}>browse</span></div>
      <div style={{ color:C.textFaint, fontSize:10, marginTop:3 }}>{accept||"PDF, CSV"}</div>
      <input ref={ref} type="file" accept={accept} style={{display:"none"}} onChange={e=>{if(e.target.files[0])onFile(e.target.files[0]);e.target.value="";}}/>
    </div>
    {files.map((f,i)=><div key={i} style={{ display:"flex", alignItems:"center", gap:8, marginTop:6, background:C.navyLight, borderRadius:8, padding:"7px 12px" }}>
      <span style={{fontSize:13}}>📄</span>
      <span style={{ color:C.textMuted, fontSize:12, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{f.name}</span>
      <Badge color={C.teal}>Attached</Badge>
    </div>)}
  </div>;
};


// ── Confirm Delete Dialog ────────────────────────────────────────────────────
const ConfirmModal = ({ open, onClose, onConfirm, title, message, danger=true }) => {
  const C = useC();
  if (!open) return null;
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={onClose}>
      <div style={{ background:C.navyMid, borderRadius:16, padding:24, width:"100%", maxWidth:380, border:`1px solid ${danger?C.coral+"44":C.navyLight}`, boxShadow:`0 20px 60px ${C.shadow}` }} onClick={e=>e.stopPropagation()}>
        <div style={{ fontSize:32, textAlign:"center", marginBottom:12 }}>{danger ? "⚠️" : "💡"}</div>
        <div style={{ fontWeight:700, fontSize:16, textAlign:"center", marginBottom:8, color:C.textPrimary }}>{title}</div>
        <div style={{ color:C.textMuted, fontSize:13, textAlign:"center", marginBottom:20, lineHeight:1.6 }}>{message}</div>
        <div style={{ display:"flex", gap:10 }}>
          <button onClick={onClose} style={{ flex:1, padding:"10px 0", background:C.navyLight, border:"none", borderRadius:10, color:C.textMuted, cursor:"pointer", fontWeight:600, fontSize:13 }}>Cancel</button>
          <button onClick={()=>{onConfirm();onClose();}} style={{ flex:1, padding:"10px 0", background:danger?C.coral:"transparent", border:`1.5px solid ${danger?C.coral:C.teal}`, borderRadius:10, color:danger?"#fff":C.teal, cursor:"pointer", fontWeight:700, fontSize:13 }}>
            {danger ? "Delete" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// GOAL CARD  — own component so useState doesn't break inside .map()
// ─────────────────────────────────────────────────────────────────────────────
function GoalCard({ g, wallets, disp, fmtDate, onFund, onEdit, onDelete, onEditContribution, onDeleteContribution }) {
  const C = useC();
  const [amt,      setAmt]      = useState("");
  const [fromWal,  setFromWal]  = useState(() => wallets.find(w=>w.id!==g.wallet_id)?.id || "");
  const [note,     setNote]     = useState("");
  const [date,     setDate]     = useState(() => todayStr());
  const [busy,     setBusy]     = useState(false);
  const [editingId,setEditingId]= useState(null);
  const [showHistory,setShowHistory] = useState(false);

  // If wallets loaded after first render, pick the first one that isn't the receiving account
  useEffect(() => {
    if (!fromWal && wallets.length > 0) setFromWal(wallets.find(w=>w.id!==g.wallet_id)?.id || wallets[0].id);
  }, [wallets]);

  const pct    = Math.min((g.saved_kes/g.target_kes)*100, 100);
  const rem    = g.target_kes - g.saved_kes;
  const w      = wallets.find(w=>w.id===g.wallet_id);
  const days   = g.deadline ? Math.max(0, Math.ceil((new Date(g.deadline)-new Date())/86400000)) : null;
  const months = days ? Math.ceil(days/30) : null;
  const needed = months&&months>0 ? rem/months : null;

  const canAdd = !!amt && parseFloat(amt) > 0 && !!fromWal && fromWal !== g.wallet_id && !!g.wallet_id;

  const resetForm = () => { setAmt(""); setNote(""); setDate(todayStr()); setEditingId(null); };

  const handle = async () => {
    if (!canAdd) return;
    setBusy(true);
    try {
      if (editingId) {
        await onEditContribution(g.id, editingId, { amount: parseFloat(amt), from_wallet_id: fromWal, contributed_date: date, note: note||null });
      } else {
        await onFund(g.id, parseFloat(amt), fromWal, { note, date });
      }
      resetForm();
    } finally { setBusy(false); }
  };

  const startEdit = (c) => {
    setEditingId(c.id); setAmt(String(c.amount)); setFromWal(c.fromWallet); setNote(c.note||""); setDate(c.date||todayStr());
    setShowHistory(true);
  };

  const inputStyle = { background:C.navyLight, border:`1px solid ${C.navyLight}`, borderRadius:8, padding:"8px 10px", color:C.textPrimary, fontSize:12, outline:"none", width:"100%", boxSizing:"border-box" };

  return (
    <div style={{ background:C.navyMid, borderRadius:16, padding:20, border:`1px solid ${C.navyLight}`, borderTop:`3px solid ${g.color}` }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
        <div>
          <div style={{ fontSize:26, marginBottom:3 }}>{g.icon}</div>
          <div style={{ fontWeight:700, fontSize:14 }}>{g.name}</div>
          <div style={{ color:C.textMuted, fontSize:10 }}>Receiving account: {w?.name||"— not set —"}</div>
        </div>
        <div style={{ textAlign:"right" }}>
          <div style={{ fontFamily:"'DM Serif Display',serif", fontSize:22, color:g.color }}>{pct.toFixed(0)}%</div>
          <div style={{ color:C.textMuted, fontSize:10 }}>of {disp(g.target_kes)}</div>
          {(onEdit||onDelete)&&<div style={{display:"flex",gap:5,marginTop:4}}>
            {onEdit&&<button onClick={()=>onEdit(g)} style={{background:"none",border:`1px solid ${C.navyLight}`,borderRadius:6,color:C.textMuted,padding:"3px 8px",cursor:"pointer",fontSize:10}}>✏️ Edit</button>}
            {onDelete&&<button onClick={()=>onDelete(g.id,g.name)} style={{background:"none",border:`1px solid ${C.coral}44`,borderRadius:6,color:C.coral,padding:"3px 8px",cursor:"pointer",fontSize:10}}>🗑 Delete</button>}
          </div>}
        </div>
      </div>
      {!g.wallet_id&&<div style={{background:C.coral+"18",border:`1px solid ${C.coral}44`,borderRadius:8,padding:"7px 10px",fontSize:11,color:C.coral,marginBottom:10}}>
        ⚠ No receiving account set — edit this goal to pick one before topping up.
      </div>}
      <Bar value={g.saved_kes} max={g.target_kes} color={g.color}/>
      <div style={{ display:"flex", justifyContent:"space-between", marginTop:6, fontSize:11 }}>
        <span style={{ color:C.textMuted }}>Saved: <strong style={{color:C.textPrimary}}>{disp(g.saved_kes)}</strong></span>
        <span style={{ color:C.textMuted }}>Left: <strong style={{color:C.textPrimary}}>{disp(rem)}</strong></span>
      </div>
      {needed&&<div style={{ marginTop:8, background:C.navyLight, borderRadius:8, padding:"7px 10px", fontSize:11, color:C.textMuted }}>
        💡 <strong style={{color:g.color}}>{disp(needed)}/mo</strong> needed · {months} months to {(g.deadline||"").slice(0,10)}
      </div>}

      {g.contributions?.length>0&&<div style={{marginTop:12}}>
        <button onClick={()=>setShowHistory(s=>!s)} style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:10,textTransform:"uppercase",letterSpacing:"0.05em",padding:0}}>
          {showHistory?"▾":"▸"} {g.contributions.length} contribution{g.contributions.length!==1?"s":""}
        </button>
        {showHistory&&<div style={{marginTop:6,display:"flex",flexDirection:"column",gap:4}}>
          {g.contributions.map(c=>{
            const fromW=wallets.find(x=>x.id===c.fromWallet);
            return <div key={c.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:C.navyLight,borderRadius:8,padding:"7px 10px"}}>
              <div>
                <div style={{fontSize:12,fontWeight:600}}>{fmtDate?fmtDate(c.date):c.date} — {disp(c.amount)}</div>
                <div style={{fontSize:10,color:C.textMuted}}>from {fromW?.name||"—"}{c.note?` · ${c.note}`:""}</div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <button onClick={()=>startEdit(c)} style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:11,padding:"2px 4px"}} title="Edit contribution">✏️</button>
                <button onClick={()=>onDeleteContribution(g.id,c.id,c.amount)} style={{background:"none",border:"none",color:C.coral,cursor:"pointer",fontSize:11,padding:"2px 4px"}} title="Delete contribution">🗑</button>
              </div>
            </div>;
          })}
        </div>}
      </div>}

      {pct>=100&&!editingId
        ? <div style={{ marginTop:10, background:C.teal+"22", borderRadius:8, padding:"9px 14px", textAlign:"center", color:C.teal, fontWeight:700, fontSize:13 }}>🎉 Goal reached!</div>
        : <div style={{ marginTop:12, display:"flex", flexDirection:"column", gap:8 }}>
            <div style={{ color:C.textFaint, fontSize:10, textTransform:"uppercase", letterSpacing:"0.05em" }}>{editingId?"Edit contribution":"Top up this goal"}</div>
            {/* From wallet picker */}
            <select value={fromWal} onChange={e=>setFromWal(e.target.value)}
              style={{...inputStyle, cursor:"pointer"}}>
              <option value="">— Select account to pay from —</option>
              {wallets.filter(w=>w.id!==g.wallet_id).map(w=>(
                <option key={w.id} value={w.id}>{w.icon} {w.name} · {disp(parseFloat(w.balance||0))} available</option>
              ))}
            </select>
            <div className="grid-2" style={{gap:8}}>
              <input type="number" value={amt} onChange={e=>setAmt(e.target.value)} placeholder="Amount" style={inputStyle}/>
              <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={inputStyle}/>
            </div>
            <input value={note} onChange={e=>setNote(e.target.value)} placeholder="Note (optional)" style={inputStyle}/>
            <div style={{ display:"flex", gap:8, alignItems:"center" }}>
              <Btn onClick={handle} disabled={!canAdd||busy} style={{padding:"8px 16px",fontSize:12,flex:1}}>
                {busy?"…":editingId?"Save Changes":"Add"}
              </Btn>
              {editingId&&<button onClick={resetForm} style={{background:"none",border:`1px solid ${C.navyLight}`,borderRadius:8,color:C.textMuted,padding:"8px 14px",cursor:"pointer",fontSize:12}}>Cancel</button>}
            </div>
            {!g.wallet_id&&<div style={{fontSize:10,color:C.coral}}>Set a receiving account (via Edit) before topping up</div>}
            {g.wallet_id&&!fromWal&&<div style={{fontSize:10,color:C.coral}}>Select an account above to enable top-up</div>}
          </div>
      }
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOADING SCREEN
// ─────────────────────────────────────────────────────────────────────────────
const LoadingScreen = ({ message="Loading…" }) => {
  const C = useC();
  return (
    <div style={{ minHeight:"100vh", background:C.navy, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", fontFamily:"'Inter',sans-serif" }}>
      <div style={{ fontSize:36, marginBottom:16, color:C.teal, animation:"spin 1.2s linear infinite" }}>◈</div>
      <div style={{ color:C.textMuted, fontSize:14 }}>{message}</div>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS TAB
// ─────────────────────────────────────────────────────────────────────────────
const NOTIF_KEY = "py_notif_prefs";
const loadNotif = () => { try { return JSON.parse(localStorage.getItem(NOTIF_KEY)||"{}"); } catch { return {}; } };
const saveNotif = (k,v) => { const p={...loadNotif(),[k]:v}; localStorage.setItem(NOTIF_KEY,JSON.stringify(p)); };

function NotifRow({ label, desc, id, C }) {
  const [on, setOn] = useState(() => loadNotif()[id] !== false);
  return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 0",borderBottom:`1px solid ${C.navyLight}`}}>
      <div>
        <div style={{fontSize:13,fontWeight:600,color:C.textPrimary}}>{label}</div>
        <div style={{fontSize:11,color:C.textMuted,marginTop:2}}>{desc}</div>
      </div>
      <div onClick={()=>{const n=!on;setOn(n);saveNotif(id,n);}}
        style={{width:42,height:24,borderRadius:12,background:on?C.teal:C.navyLight,cursor:"pointer",position:"relative",transition:"background 0.2s",flexShrink:0}}>
        <div style={{position:"absolute",top:3,left:on?20:3,width:18,height:18,borderRadius:"50%",background:"#fff",transition:"left 0.2s"}}/>
      </div>
    </div>
  );
}

// AdminApp, AdminPanel, and SupportTickets are lazy-loaded near the top of this file.

function SettingsTab({ user, C, theme, toggleTheme, baseCurrency, setBase, currencies, updateUser, showToast, logout, exportTransactions, openM, askConfirm, deactivateAccount, loadData }) {
  const [editName,   setEditName]   = useState(user?.full_name || "");
  const [savingName, setSavingName] = useState(false);
  const [notifPerm,  setNotifPerm]  = useState(() => (typeof Notification !== "undefined" ? Notification.permission : "default"));
  const [pinForm,    setPinForm]    = useState(false); // showing the set/change PIN form
  const [pin1,       setPin1]       = useState("");
  const [pin2,       setPin2]       = useState("");
  const [pinPassword,setPinPassword]= useState("");
  const [savingPin,  setSavingPin]  = useState(false);

  const savePin = async (newPin) => {
    if (!pinPassword) { showToast("Enter your account password to confirm", C.coral); return; }
    if (newPin && !/^\d{4,6}$/.test(newPin)) { showToast("PIN must be 4-6 digits", C.coral); return; }
    if (newPin && newPin !== pin2) { showToast("PINs don't match", C.coral); return; }
    setSavingPin(true);
    try {
      const { has_pin } = await authApi.setPin(newPin || null, pinPassword);
      updateUser({ has_pin });
      if (has_pin) sessionStorage.setItem("py_unlocked", "1"); // don't lock yourself out mid-session
      setPinForm(false); setPin1(""); setPin2(""); setPinPassword("");
      showToast(newPin ? "PIN set" : "PIN removed", C.teal);
    } catch(err) { showToast(err?.response?.data?.error||"Failed", C.coral); }
    finally { setSavingPin(false); }
  };

  const toggleNotifications = async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      showToast("Push notifications not supported in this browser", C.coral); return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        await existing.unsubscribe();
        await pushApi.unsubscribe(existing.endpoint).catch(() => {});
        setNotifPerm("default");
        showToast("Notifications turned off", C.textMuted);
      } else {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") { showToast("Permission denied — enable in browser settings", C.coral); return; }
        const { publicKey } = await pushApi.getVapidKey();
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
        await pushApi.subscribe(sub.toJSON());
        setNotifPerm("granted");
        showToast("Notifications enabled — you'll be reminded twice daily", C.teal, 4000);
      }
    } catch { showToast("Could not update notification settings", C.coral); }
  };

  const saveName = async () => {
    if (!editName.trim()) return;
    setSavingName(true);
    try {
      const { user: u } = await authApi.updateProfile({ full_name: editName.trim() });
      updateUser({ full_name: u.full_name });
      showToast("Name updated", C.teal);
    } catch { showToast("Failed to update name", C.coral); }
    finally { setSavingName(false); }
  };

  const rowBtn = (icon, label, desc, onClick, danger=false) => (
    <button onClick={onClick} style={{background:danger?"#E74C3C11":C.navyLight,border:`1px solid ${danger?"#E74C3C44":C.navyLight}`,borderRadius:10,padding:"12px 16px",color:danger?C.coral:C.textPrimary,cursor:"pointer",fontWeight:600,fontSize:13,textAlign:"left",display:"flex",alignItems:"center",gap:10,width:"100%"}}>
      <span style={{fontSize:18}}>{icon}</span>
      <div><div>{label}</div><div style={{fontSize:11,color:C.textMuted,fontWeight:400}}>{desc}</div></div>
    </button>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div>
        <div style={{fontFamily:"'DM Serif Display',serif",fontSize:24}}>Settings</div>
        <div style={{color:C.textMuted,fontSize:12}}>Manage your account and preferences</div>
      </div>

      {/* Profile */}
      <Card>
        <div style={{fontWeight:700,fontSize:13,color:C.teal,marginBottom:14,textTransform:"uppercase",letterSpacing:"0.06em"}}>👤 Profile</div>
        <div style={{marginBottom:12}}>
          <div style={{fontSize:11,color:C.textMuted,marginBottom:5}}>Full Name</div>
          <div style={{display:"flex",gap:8}}>
            <input value={editName} onChange={e=>setEditName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&saveName()}
              style={{flex:1,background:C.navyLight,border:`1px solid ${C.navyLight}`,borderRadius:10,padding:"10px 14px",color:C.textPrimary,fontSize:13,outline:"none"}}
              onFocus={e=>e.target.style.borderColor=C.teal} onBlur={e=>e.target.style.borderColor=C.navyLight}/>
            <button onClick={saveName} disabled={savingName||editName.trim()===user?.full_name}
              style={{background:C.teal,color:"#0B1120",border:"none",borderRadius:10,padding:"0 16px",fontWeight:700,fontSize:12,cursor:"pointer",opacity:(savingName||editName.trim()===user?.full_name)?0.5:1}}>
              {savingName?"Saving…":"Save"}
            </button>
          </div>
        </div>
        <div>
          <div style={{fontSize:11,color:C.textMuted,marginBottom:5}}>Email Address</div>
          <div style={{background:C.navyLight,borderRadius:10,padding:"10px 14px",fontSize:13,color:C.textFaint}}>{user?.email}</div>
        </div>
      </Card>

      {/* Display & Currency */}
      <Card>
        <div style={{fontWeight:700,fontSize:13,color:C.teal,marginBottom:14,textTransform:"uppercase",letterSpacing:"0.06em"}}>🌐 Display & Currency</div>
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11,color:C.textMuted,marginBottom:6}}>Base Currency</div>
          <select value={baseCurrency} onChange={e=>setBase(e.target.value)}
            style={{width:"100%",background:C.navyLight,border:`1px solid ${C.navyLight}`,borderRadius:10,padding:"10px 14px",color:C.textPrimary,fontSize:13,outline:"none",cursor:"pointer"}}>
            {currencies.map(c=><option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
          </select>
          <div style={{fontSize:11,color:C.textMuted,marginTop:5}}>All amounts display in this currency using live rates</div>
        </div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div><div style={{fontSize:13,fontWeight:600}}>Theme</div><div style={{fontSize:11,color:C.textMuted}}>Currently {theme==="dark"?"Dark":"Light"} mode</div></div>
          <button onClick={toggleTheme} style={{background:C.navyLight,border:"none",borderRadius:10,padding:"8px 16px",color:C.textPrimary,cursor:"pointer",fontWeight:600,fontSize:12}}>
            {theme==="dark"?"☀️ Light Mode":"🌙 Dark Mode"}
          </button>
        </div>
      </Card>

      {/* Budgeting Style */}
      <Card>
        <div style={{fontWeight:700,fontSize:13,color:C.teal,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.06em"}}>🧮 Budgeting Style</div>
        <div style={{fontSize:11,color:C.textMuted,marginBottom:14}}>Choose how the Budgets tab works for your account</div>
        <div style={{display:"flex",gap:8}}>
          {[
            {key:"manual",     label:"Manual",     desc:"Set a flat budget per category, like today"},
            {key:"percentage", label:"Percentage", desc:"Define % rules once; caps recalc from your monthly income"},
          ].map(m=>{
            const active = (user.budget_mode||"manual")===m.key;
            return <button key={m.key} onClick={async()=>{
              if(active) return;
              try { const {user:u}=await authApi.updateProfile({budget_mode:m.key}); updateUser({budget_mode:u.budget_mode}); showToast(`Switched to ${m.label} budgeting`, C.teal); }
              catch { showToast("Could not update budgeting style", C.coral); }
            }} style={{flex:1,textAlign:"left",background:active?C.teal+"22":C.navyLight,border:`2px solid ${active?C.teal:"transparent"}`,borderRadius:10,padding:"10px 12px",cursor:active?"default":"pointer"}}>
              <div style={{fontSize:12,fontWeight:700,color:active?C.teal:C.textPrimary,marginBottom:3}}>{m.label}</div>
              <div style={{fontSize:10,color:C.textMuted,lineHeight:1.4}}>{m.desc}</div>
            </button>;
          })}
        </div>
      </Card>

      {/* Security — PIN lock */}
      <Card>
        <div style={{fontWeight:700,fontSize:13,color:C.teal,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.06em"}}>🔒 Security</div>
        <div style={{fontSize:11,color:C.textMuted,marginBottom:14}}>Require a PIN to open the app on this device</div>
        {!pinForm ? (
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div>
              <div style={{fontSize:13,fontWeight:600}}>App Lock</div>
              <div style={{fontSize:11,color:C.textMuted}}>{user.has_pin?"PIN is set — required each time you open the app":"No PIN set"}</div>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setPinForm(true)} style={{background:C.navyLight,border:"none",borderRadius:10,padding:"8px 16px",color:C.textPrimary,cursor:"pointer",fontWeight:600,fontSize:12}}>{user.has_pin?"Change PIN":"Set PIN"}</button>
              {user.has_pin && <button onClick={()=>setPinForm(true)} style={{background:"none",border:`1px solid ${C.coral}55`,borderRadius:10,padding:"8px 16px",color:C.coral,cursor:"pointer",fontWeight:600,fontSize:12}}>Remove</button>}
            </div>
          </div>
        ) : (
          <div>
            <Field label="New PIN (4-6 digits, leave blank to remove)" type="password" value={pin1} onChange={v=>{setPin1(v.replace(/\D/g,"").slice(0,6));}} placeholder="••••"/>
            {pin1 && <Field label="Confirm PIN" type="password" value={pin2} onChange={v=>setPin2(v.replace(/\D/g,"").slice(0,6))} placeholder="••••"/>}
            <Field label="Account Password" type="password" value={pinPassword} onChange={setPinPassword} placeholder="Confirm it's you"/>
            <div style={{display:"flex",gap:8}}>
              <Btn onClick={()=>savePin(pin1||null)} disabled={savingPin} style={{flex:1,padding:12,fontSize:13}}>{savingPin?"Saving…":pin1?"Save PIN":"Remove PIN"}</Btn>
              <button onClick={()=>{setPinForm(false);setPin1("");setPin2("");setPinPassword("");}} style={{background:"none",border:`1px solid ${C.navyLight}`,borderRadius:10,padding:"0 16px",color:C.textMuted,cursor:"pointer",fontSize:12}}>Cancel</button>
            </div>
          </div>
        )}
      </Card>

      {/* Notifications */}
      <Card>
        <div style={{fontWeight:700,fontSize:13,color:C.teal,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.06em"}}>🔔 Notification Preferences</div>
        <div style={{fontSize:11,color:C.textMuted,marginBottom:14}}>Controls which alerts you see in the app</div>

        {/* Daily push reminder toggle */}
        {"serviceWorker" in navigator && "PushManager" in window && (
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 0",borderBottom:`1px solid ${C.navyLight}`,marginBottom:10}}>
            <div>
              <div style={{fontWeight:600,fontSize:13}}>📱 Daily Transaction Reminders</div>
              <div style={{fontSize:11,color:C.textMuted,marginTop:2}}>Push notification at 8 AM & 8 PM to record your transactions</div>
              {notifPerm==="denied"&&<div style={{fontSize:11,color:C.coral,marginTop:2}}>Blocked in browser — enable in site settings</div>}
            </div>
            <button onClick={toggleNotifications} style={{
              padding:"7px 16px",borderRadius:20,border:`1.5px solid ${notifPerm==="granted"?C.teal:C.navyLight}`,
              background:notifPerm==="granted"?C.teal+"22":"none",color:notifPerm==="granted"?C.teal:C.textMuted,
              fontWeight:600,fontSize:12,cursor:"pointer",whiteSpace:"nowrap",transition:"all 0.2s",
              opacity:notifPerm==="denied"?0.5:1,pointerEvents:notifPerm==="denied"?"none":"auto"
            }}>{notifPerm==="granted"?"On ✓":"Off"}</button>
          </div>
        )}

        <NotifRow C={C} id="budget_alerts"  label="Budget Alerts"    desc="Notify when a category exceeds its budget"/>
        <NotifRow C={C} id="goal_reminders" label="Goal Reminders"   desc="Remind you of upcoming goal deadlines"/>
        <NotifRow C={C} id="loan_due"       label="Loan Due Dates"   desc="Alert when a loan repayment is approaching"/>
        <NotifRow C={C} id="weekly_summary" label="Weekly Summary"   desc="Show a weekly financial snapshot"/>
      </Card>

      {/* Data Management */}
      <Card>
        <div style={{fontWeight:700,fontSize:13,color:C.teal,marginBottom:14,textTransform:"uppercase",letterSpacing:"0.06em"}}>📁 Data Management</div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {rowBtn("⬇️","Export Transactions","Download all records as CSV", exportTransactions)}
          {rowBtn("⬆️","Import Transactions","Upload a CSV file to bulk-add records", ()=>openM("importExport"))}
          {rowBtn("🚫","Factory Reset","Delete all data and start fresh",
            ()=>askConfirm("Factory Reset","This will permanently delete ALL your financial data — accounts, transactions, goals, loans, investments and categories. Your login account is kept. This cannot be undone.",
              async()=>{try{await authApi.resetData();await loadData();showToast("All data cleared. Fresh start!",C.teal,4000);}catch(e){const msg=e?.response?.data?.error||e?.message||"Unknown error";console.error("Factory reset error:",e);showToast("Reset failed: "+msg,C.coral,6000);}}),
            true)}
        </div>
      </Card>

      {/* Support */}
      <Suspense fallback={<Card><div style={{textAlign:"center",color:C.textMuted,padding:20,fontSize:13}}>Loading…</div></Card>}>
        <SupportTickets user={user} C={C} showToast={showToast}/>
      </Suspense>

      {/* Account */}
      <Card>
        <div style={{fontWeight:700,fontSize:13,color:C.teal,marginBottom:14,textTransform:"uppercase",letterSpacing:"0.06em"}}>👤 Account</div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {rowBtn("🚪","Sign Out","Log out of this device", logout)}
          {rowBtn("⚠️","Deactivate Account","Permanently disable your account",
            ()=>askConfirm("Deactivate Account","Your account will be deactivated and you will be signed out. Contact support to reactivate. Are you sure?",deactivateAccount),
            true)}
        </div>
      </Card>

      <div style={{textAlign:"center",fontSize:11,color:C.textFaint,paddingBottom:20}}>Pesa Yangu · Built for Kenya 🇰🇪</div>
    </div>
  );
}

// Returns true if a transaction falls in the current calendar month
function isCurrentMonth(t) {
  const now = new Date(), d = new Date(t.date||t.tx_date);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

// Day-level [start,end] bounds for a named period, `offset` periods back from
// now (0 = current, -1 = the one before). Relies on JS Date's built-in
// month/day overflow normalization (e.g. month -1 rolls into December of the
// previous year) so year boundaries are handled automatically.
function getPeriodRange(period, offset=0) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "today") {
    const d = new Date(today); d.setDate(d.getDate() + offset);
    return { start: d, end: d, label: fmtDate(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`) };
  }
  if (period === "week") {
    const dow = today.getDay();
    const mon = new Date(today); mon.setDate(today.getDate() - (dow===0?6:dow-1) + offset*7);
    const sun = new Date(mon); sun.setDate(mon.getDate()+6);
    return { start: mon, end: sun, label: `${MONTH_NAMES[mon.getMonth()]} ${mon.getDate()}–${MONTH_NAMES[sun.getMonth()]} ${sun.getDate()}` };
  }
  if (period === "month") {
    const start = new Date(now.getFullYear(), now.getMonth()+offset, 1);
    const end   = new Date(now.getFullYear(), now.getMonth()+offset+1, 0);
    return { start, end, label: `${MONTH_NAMES[start.getMonth()]} ${start.getFullYear()}` };
  }
  if (period === "quarter") {
    const q = Math.floor(now.getMonth()/3) + offset;
    const start = new Date(now.getFullYear(), q*3, 1);
    const end   = new Date(now.getFullYear(), q*3+3, 0);
    return { start, end, label: `Q${Math.floor(start.getMonth()/3)+1} ${start.getFullYear()}` };
  }
  if (period === "year") {
    const y = now.getFullYear() + offset;
    return { start: new Date(y,0,1), end: new Date(y,11,31), label: String(y) };
  }
  return null;
}

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function prevBudgetMonth(y,m){ return m===1?[y-1,12]:[y,m-1]; }
function nextBudgetMonth(y,m){ return m===12?[y+1,1]:[y,m+1]; }

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const { user, plan, loading: authLoading, login, register, logout, updateUser } = useAuth();
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

  // ── Theme
  const [theme, setThemeState] = useState(getTheme);
  const C = tokens(theme);
  const toggleTheme = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    persistTheme(next);
    setThemeState(next);
    window.dispatchEvent(new Event("py:theme")); // notify AuthPage if open
  }, [theme]);

  // ── Data state (all loaded from API)
  const [wallets,     setWallets]     = useState([]);
  const [txs,         setTxs]         = useState([]);
  const [expCats,     setExpCats]     = useState([]);
  const [incCats,     setIncCats]     = useState([]);
  const [goals,       setGoals]       = useState([]);
  const [investments, setInvestments] = useState([]);
  const [loans,       setLoans]       = useState([]);
  const [policies,    setPolicies]    = useState([]);
  const [recurring,   setRecurring]   = useState([]);
  const [currencies,  setCurrencies]  = useState(DEFAULT_CURRENCIES);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError,   setDataError]   = useState("");

  // ── PIN lock — sessionStorage so it clears when the browser/tab closes,
  // requiring the PIN again next time the app is opened (the actual point
  // of a lock screen), without prompting again on every in-app navigation.
  const [pinUnlocked,  setPinUnlocked]  = useState(() => sessionStorage.getItem("py_unlocked") === "1");
  const [pinEntry,     setPinEntry]     = useState("");
  const [pinError,     setPinError]     = useState("");
  const [pinVerifying, setPinVerifying] = useState(false);
  const verifyPin = async () => {
    if (!pinEntry) return;
    setPinVerifying(true); setPinError("");
    try {
      await authApi.verifyPin(pinEntry);
      sessionStorage.setItem("py_unlocked", "1");
      setPinUnlocked(true); setPinEntry("");
    } catch { setPinError("Incorrect PIN"); setPinEntry(""); }
    finally { setPinVerifying(false); }
  };

  // ── UI state
  const [tab,    _setTab]   = useState(() => {
    // Restore tab from URL hash on first load
    const hash = window.location.hash.replace("#","");
    const valid = ["dashboard","accounts","transactions","budgets","goals","recurring","investments","loans","insurance","reconcile","settings","more","admin"];
    return valid.includes(hash) ? hash : "dashboard";
  });

  const setTab = (newTab) => {
    _setTab(newTab);
    if (newTab !== "transactions") { setTxSearch(""); setTxWalletFilter(""); }
    window.history.pushState({ tab: newTab }, "", "#" + newTab);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Browser back/forward button support
  useEffect(() => {
    const onPop = (e) => {
      const t = e.state?.tab || "dashboard";
      _setTab(t);
      if (t !== "transactions") { setTxSearch(""); setTxWalletFilter(""); }
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
    // Seed the initial history entry so back can return to it
    window.history.replaceState({ tab }, "", "#" + tab);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []); // eslint-disable-line

  const goToWalletTxs = (walletId) => {
    setTxWalletFilter(walletId);
    setTxSearch("");
    // Always push Wallets into history first so back ALWAYS returns to Wallets,
    // regardless of which tab the user was on when they clicked a wallet card.
    window.history.pushState({ tab: "accounts" }, "", "#accounts");
    _setTab("transactions");
    window.history.pushState({ tab: "transactions" }, "", "#transactions");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const [modals, setModals] = useState({});
  const openM  = (key, extra={}) => setModals(p=>({...p,[key]:{open:true,...extra}}));
  const closeM = (key)            => setModals(p=>({...p,[key]:{open:false}}));
  const isOpen = (key)            => !!modals[key]?.open;

  const [baseCurrency, setBase] = useState("KES");
  const [toast,        setToast] = useState(null);
  const [aiLoading,    setAiLoading] = useState(false);
  const [aiText,       setAiText]    = useState("");
  const [idleWarning,  setIdleWarning] = useState(false); // show 1-min warning

  // ── Auto-logout after 15 min inactivity (warn at 14 min)
  useEffect(() => {
    if (!user) return;
    const WARN_MS   = 14 * 60 * 1000;
    const LOGOUT_MS = 15 * 60 * 1000;
    let warnTimer, logoutTimer;
    const reset = () => {
      setIdleWarning(false);
      clearTimeout(warnTimer);
      clearTimeout(logoutTimer);
      warnTimer   = setTimeout(() => setIdleWarning(true), WARN_MS);
      logoutTimer = setTimeout(() => {
        setIdleWarning(false);
        logout();
        showToast("You were signed out due to inactivity.", "#E74C3C", 5000);
      }, LOGOUT_MS);
    };
    const EVENTS = ["mousemove","mousedown","keydown","touchstart","scroll","click"];
    EVENTS.forEach(ev => window.addEventListener(ev, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(warnTimer);
      clearTimeout(logoutTimer);
      EVENTS.forEach(ev => window.removeEventListener(ev, reset));
    };
  }, [user, logout]);

  // ── Toast helper
  const showToast = useCallback((msg, color=C.teal, duration=2800) => {
    setToast({msg,color});
    setTimeout(()=>setToast(null), duration);
  }, []);

  // ── Display helper
  const disp = useCallback((amtKES) => fmtC(amtKES, baseCurrency, currencies), [baseCurrency, currencies]);

  // ── Cache helpers — stale-while-revalidate via localStorage
  const CACHE_KEY = user ? `py_cache_${user.id}` : null;
  const writeCache = (data) => { try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch {} };
  const readCache  = () => { try { const s = localStorage.getItem(CACHE_KEY); return s ? JSON.parse(s) : null; } catch { return null; } };

  const applyData = useCallback(([w, t, c, g, inv, l, r, fx, ins]) => {
    setWallets(w.wallets || []);
    setTxs((t.transactions || []).map(tx => ({
      ...tx,
      wallet:        tx.wallet_id,
      category:      tx.category_id,
      amount:        parseFloat(tx.amount_kes),
      date:          (tx.tx_date||'').slice(0,10),
      loanId:        tx.loan_id,
      principalPaid: tx.principal_paid ? parseFloat(tx.principal_paid) : undefined,
      interestPaid:  tx.interest_paid  ? parseFloat(tx.interest_paid)  : undefined,
    })));
    const cats = c.categories || [];
    setExpCats(cats.filter(c=>c.type==="expense").map(normaliseCategory));
    setIncCats(cats.filter(c=>c.type==="income").map(normaliseCategory));
    setGoals((g.goals||[]).map(normaliseGoal));
    setInvestments((inv.investments||[]).map(normaliseInv));
    setLoans((l.loans||[]).map(normaliseLoan));
    setRecurring((r.recurring||[]).map(normaliseRecurring));
    setPolicies(ins?.policies||[]);
    if (fx.rates) {
      setCurrencies(prev => prev.map(c => fx.rates[c.code]
        ? { ...c, rate: 1/fx.rates[c.code] }
        : c
      ));
    }
  }, []); // eslint-disable-line

  // ── Load all data after login — shows cache instantly, then refreshes
  const loadData = useCallback(() => {
    if (!user) return;

    // 1. Paint cached data immediately (makes app feel instant on revisit)
    const cached = readCache();
    if (cached?.data) {
      applyData(cached.data);
      setDataLoading(false); // show cached UI right away
    } else {
      setDataLoading(true);
    }

    setDataError("");

    // 2. Always fetch fresh data in background
    Promise.all([
      walletsApi.list(),
      txApi.list({ limit:500 }),
      catsApi.list(),
      goalsApi.list(),
      invsApi.list(),
      loansApi.list(),
      recurApi.list(),
      fxApi.rates(),
      insuranceApi.list(),
    ])
    .then((results) => {
      applyData(results);
      writeCache(results); // save for next visit
    })
    .catch(err => {
      console.error("Data load error:", err);
      if (!cached?.data) setDataError("Could not load your data. Please refresh.");
    })
    .finally(() => setDataLoading(false));
  }, [user]); // eslint-disable-line

  useEffect(() => { loadData(); }, [loadData]);

  // ── Push notification subscription (after login, once)
  useEffect(() => {
    if (!user) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (Notification.permission === "denied") return;

    const subscribePush = async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        // Check if already subscribed
        const existing = await reg.pushManager.getSubscription();
        if (existing) {
          // Re-register to keep server in sync
          await pushApi.subscribe(existing.toJSON()).catch(() => {});
          return;
        }
        // Ask permission only if not yet granted
        const perm = await Notification.requestPermission();
        if (perm !== "granted") return;
        const { publicKey } = await pushApi.getVapidKey();
        if (!publicKey) return;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: publicKey,
        });
        await pushApi.subscribe(sub.toJSON());
      } catch {
        // Silently ignore — push is non-critical
      }
    };

    subscribePush();
  }, [user?.id]); // eslint-disable-line

  // ── PWA install banner — shows periodically, permanent opt-out available
  const [installPrompt,     setInstallPrompt]     = useState(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [showInstallModal,  setShowInstallModal]  = useState(false);

  useEffect(() => {
    // Never show if running as installed PWA
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    // Never show if user chose "Stop showing this"
    if (localStorage.getItem("py_install_stopped")) return;
    // Snooze: hide until the snoozed-until timestamp passes
    const snoozeUntil = parseInt(localStorage.getItem("py_install_snooze") || "0", 10);
    const shouldShow  = Date.now() > snoozeUntil;

    const handler = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
      if (shouldShow) setShowInstallBanner(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    // iOS / all browsers without beforeinstallprompt
    if (shouldShow) setShowInstallBanner(true);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // "Not now" — snooze for 3 days, then show again
  const snoozeInstallBanner = () => {
    const threeDays = Date.now() + 3 * 24 * 60 * 60 * 1000;
    localStorage.setItem("py_install_snooze", String(threeDays));
    setShowInstallBanner(false);
  };

  // "Stop showing this" — permanent opt-out
  const stopInstallBanner = () => {
    localStorage.setItem("py_install_stopped", "1");
    setShowInstallBanner(false);
  };

  const triggerInstall = async () => {
    if (installPrompt) {
      installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      if (outcome === "accepted") {
        localStorage.setItem("py_install_stopped", "1");
        setShowInstallBanner(false);
        setInstallPrompt(null);
      }
    } else {
      setShowInstallModal(true);
    }
  };

  // ── Pre-warm Render backend on app open so it's ready before login
  useEffect(() => {
    const base = import.meta.env.VITE_API_URL?.replace("/api/v1","") || "";
    fetch(`${base}/ping`, { method:"GET" }).catch(()=>{});
  }, []);

  // ── Field normalisers (backend snake_case → UI expectations)
  const normaliseCategory = (c) => ({
    ...c, budget: parseFloat(c.budget_kes||0), watch: !!c.watch,
    parentId:        c.parent_id || null,
    allocationType:  c.allocation_type || "fixed",
    percentOfParent: c.percent_of_parent!=null ? parseFloat(c.percent_of_parent) : null,
    spendKind:       c.spend_kind || null,
    linkedWalletId:  c.linked_wallet_id || null,
    windfallPercent: c.windfall_percent!=null ? parseFloat(c.windfall_percent) : null,
    goalTargetKes:   c.goal_target_kes!=null ? parseFloat(c.goal_target_kes) : null,
    goalDeadline:    (c.goal_deadline||"").slice(0,10) || null,
    allocatedKes:    c.allocated_kes!=null ? parseFloat(c.allocated_kes) : 0,
  });
  const normaliseContribution = (c) => ({
    ...c,
    amount:     parseFloat(c.amount_kes||0),
    fromWallet: c.from_wallet_id,
    toWallet:   c.to_wallet_id,
    date:       (c.contributed_date||'').slice(0,10),
  });
  const normaliseGoal = (g) => ({
    ...g,
    target: parseFloat(g.target_kes||0),
    saved:  parseFloat(g.saved_kes||0),
    wallet: g.wallet_id,
    contributions: (g.contributions||[]).map(normaliseContribution),
  });
  const normaliseInv = (i) => ({
    ...i,
    units:        parseFloat(i.units||0),
    buyPrice:     parseFloat(i.buy_price_kes||0),
    currentPrice: parseFloat(i.current_price_kes||0),
    wallet:       i.wallet_id,
    returns:      (i.returns||[]).map(r=>({...r, amount:parseFloat(r.amount_kes||0)})),
  });
  const normaliseLoan = (l) => ({
    ...l,
    principal:      parseFloat(l.principal_kes||0),
    remaining:      parseFloat(l.remaining_kes||0),
    termMonths:     l.term_months ? parseInt(l.term_months) : null,
    monthlyPayment: parseFloat(l.monthly_payment_kes||0),
    nextDue:        (l.next_due_date||"").slice(0,10)||null,
    repayments:     (l.repayments||[]).map(r=>({
      ...r,
      total:     parseFloat(r.total_kes||0),
      principal: parseFloat(r.principal_kes||0),
      interest:  parseFloat(r.interest_kes||0),
      wallet:    r.wallet_id,
      date:      (r.payment_date||r.date||"").slice(0,10),
    })),
  });
  const normaliseRecurring = (r) => ({
    ...r,
    amount:   parseFloat(r.amount_kes||0),
    wallet:   r.wallet_id,
    category: r.category_id,
    active:   !!r.is_active,
    nextDate: r.next_date,
  });

  // ── Derived values
  const totalBalance   = wallets.reduce((s,w)=>s+parseFloat(w.balance||0), 0);
  const totalIncome    = txs.filter(t=>t.type==="income"  && isCurrentMonth(t)).reduce((s,t)=>s+t.amount, 0);
  const totalRefunds   = txs.filter(t=>t.type==="refund"  && isCurrentMonth(t)).reduce((s,t)=>s+t.amount, 0);
  const totalExpense   = Math.max(0, txs.filter(t=>t.type==="expense" && isCurrentMonth(t)).reduce((s,t)=>s+t.amount, 0) - totalRefunds);
  const portfolioValue = investments.reduce((s,i)=>s+i.units*i.currentPrice, 0);
  const totalDebt      = loans.reduce((s,l)=>s+l.remaining, 0);
  const totalGoalSaved = goals.reduce((s,g)=>s+g.saved, 0);
  const netWorth       = totalBalance + portfolioValue - totalDebt;
  const savingsRate    = totalIncome>0 ? ((totalIncome-totalExpense)/totalIncome)*100 : 0;

  // Last 6 months of expenses from real transaction data
  const last6MonthsExpenses = useMemo(() => {
    const now = new Date();
    return Array.from({length:6}, (_,i) => {
      const d = new Date(now.getFullYear(), now.getMonth()-5+i, 1);
      const yr = d.getFullYear(), mo = d.getMonth();
      const label = d.toLocaleString("default",{month:"short"});
      const value = txs
        .filter(t => t.type==="expense" && t.date)
        .reduce((s,t) => {
          const td = new Date(t.date);
          return (td.getFullYear()===yr && td.getMonth()===mo) ? s+t.amount : s;
        }, 0);
      return { label, value, highlight: i===5 };
    });
  }, [txs]);
  const avgMonthlyExpense = useMemo(() => {
    const nonZero = last6MonthsExpenses.slice(0,5).filter(m=>m.value>0);
    return nonZero.length ? nonZero.reduce((s,m)=>s+m.value,0)/nonZero.length : 0;
  }, [last6MonthsExpenses]);

  const spendByCat = useMemo(()=>{
    const m={};
    expCats.forEach(c=>m[c.id]=0);
    txs.filter(t=>t.type==="expense" && isCurrentMonth(t)).forEach(t=>{ const key=t.category||t.category_id; m[key]=(m[key]||0)+t.amount; });
    txs.filter(t=>t.type==="refund" && isCurrentMonth(t)).forEach(t=>{ const orig=txs.find(x=>x.id===t.refund_of); const key=orig?(orig.category||orig.category_id):null; if(key) m[key]=Math.max(0,(m[key]||0)-t.amount); });
    return m;
  }, [txs, expCats]);

  // Money moved into a Primary category's linked wallet this month (see
  // allocateToCategory) — this is how "Used" is tracked for those categories,
  // since real expense transactions are never posted against them.
  const transferredByCat = useMemo(()=>{
    const m={};
    txs.filter(t=>t.type==="transfer_out" && isCurrentMonth(t)).forEach(t=>{ const key=t.category||t.category_id; if(key) m[key]=(m[key]||0)+t.amount; });
    return m;
  }, [txs]);

  const earnByCat = useMemo(()=>{
    const m={};
    incCats.forEach(c=>m[c.id]=0);
    txs.filter(t=>t.type==="income").forEach(t=>{
      const key = t.category || t.category_id;
      m[key] = (m[key]||0)+t.amount;
    });
    return m;
  }, [txs, incCats]);

  // ── Category hierarchy (percentage-mode budgeting). A category is either a
  // flat 'fixed' leaf (today's existing behaviour, budget_kes as-is) or a
  // 'percent' rule/bucket whose Cap cascades top-down from Gross Income
  // through its parent chain. Transactions only ever post against leaves;
  // parent Cap/Used are rolled up bottom-up from descendant leaves.
  const catsById = useMemo(() => {
    const m = {}; expCats.forEach(c => m[c.id] = c); return m;
  }, [expCats]);
  const childrenByParent = useMemo(() => {
    const m = {};
    expCats.forEach(c => { const key = c.parentId || "__root__"; (m[key] = m[key] || []).push(c); });
    return m;
  }, [expCats]);
  // All descendant ids of `id` (used to stop a category becoming its own descendant's child)
  const getDescendantIds = (id) => {
    const out = [];
    const walk = (pid) => (childrenByParent[pid]||[]).forEach(k => { out.push(k.id); walk(k.id); });
    walk(id);
    return out;
  };
  // budgetYear/budgetMonth declared here (ahead of their other usages below)
  // because grossIncome (and capById, which needs it) depend on them.
  const [budgetYear,  setBudgetYear]  = useState(new Date().getFullYear());
  const [budgetMonth, setBudgetMonth] = useState(new Date().getMonth() + 1);
  // Income for the percentage cascade — auto-derived from actual recorded
  // income transactions in the selected month, never typed in manually, so
  // it always matches what really landed in the user's accounts.
  const grossIncome = useMemo(() => {
    return txs.filter(t => {
      if (t.type !== "income") return false;
      const d = new Date(t.date || t.tx_date);
      return d.getFullYear() === budgetYear && d.getMonth() + 1 === budgetMonth;
    }).reduce((s,t) => s + (t.amount ?? parseFloat(t.amount_kes||0)), 0);
  }, [txs, budgetYear, budgetMonth]);
  const capById = useMemo(() => {
    const memo = {};
    const resolve = (id) => {
      if (memo[id] != null) return memo[id];
      const c = catsById[id];
      if (!c) return 0;
      const val = c.allocationType === "percent"
        ? (c.parentId ? resolve(c.parentId) : grossIncome) * ((c.percentOfParent||0) / 100)
        : c.budget;
      memo[id] = val;
      return val;
    };
    Object.keys(catsById).forEach(resolve);
    return memo;
  }, [catsById, grossIncome]);
  const usedById = useMemo(() => {
    const memo = {};
    const resolve = (id) => {
      if (memo[id] != null) return memo[id];
      const kids = childrenByParent[id] || [];
      const val = kids.length ? kids.reduce((s,k) => s + resolve(k.id), 0)
        : (catsById[id]?.linkedWalletId ? (transferredByCat[id] || 0) : (spendByCat[id] || 0));
      memo[id] = val;
      return val;
    };
    Object.keys(catsById).forEach(resolve);
    return memo;
  }, [catsById, childrenByParent, spendByCat, transferredByCat]);
  // Sum of children's Cap — advisory only ("you've earmarked X against a Y allocation"),
  // never the enforced Cap itself (see capById).
  const earmarkedById = useMemo(() => {
    const memo = {};
    const resolve = (id) => {
      if (memo[id] != null) return memo[id];
      const kids = childrenByParent[id] || [];
      const val = kids.reduce((s,k) => s + (capById[k.id]||0), 0);
      memo[id] = val;
      return val;
    };
    Object.keys(catsById).forEach(resolve);
    return memo;
  }, [catsById, childrenByParent, capById]);
  const remainingById = (id) => (capById[id]||0) - (usedById[id]||0);

  // Linked-wallet categories track allocation (money moved into their own
  // wallet), not actual spending — exceeding that isn't overspending, so it
  // must not count against the financial health score or trigger alerts.
  const overBudget = expCats.filter(c=>(capById[c.id]||0)>0 && (usedById[c.id]||0)>(capById[c.id]||0) && !c.linkedWalletId);
  const watched    = expCats.filter(c=>c.watch);
  // 0 when no activity; otherwise built from real behaviour across net worth, savings, budgets & goals
  const hasActivity = txs.length > 0 || wallets.some(w=>parseFloat(w.balance||0)!==0);
  const totalAssets = totalBalance + portfolioValue;
  // 1. Net worth — assets vs liabilities (0 = fully leveraged, 100 = debt-free)
  const netWorthFactor = totalAssets > 0
    ? Math.max(0, Math.min(100, ((totalAssets - totalDebt) / totalAssets) * 100))
    : (totalDebt > 0 ? 0 : 50);
  // 2. Savings rate this month, mapped from -50%..+50% onto 0..100
  const savingsFactor = Math.max(0, Math.min(100, 50 + savingsRate));
  // 3. Spending — share of budgeted categories still within budget this month
  const budgetedCats = expCats.filter(c => (capById[c.id]||0) > 0);
  const budgetFactor = budgetedCats.length
    ? 100 * (budgetedCats.length - overBudget.length) / budgetedCats.length
    : 70; // neutral when no budgets are set yet
  // 4. Goals — average progress toward goals that still have a target
  const activeGoals = goals.filter(g => g.target > 0);
  const goalsFactor = activeGoals.length
    ? activeGoals.reduce((s,g) => s + Math.min(100, (g.saved / g.target) * 100), 0) / activeGoals.length
    : 60; // neutral when no goals set yet
  const score = (() => {
    if (!hasActivity) return 0;
    const s = netWorthFactor*0.30 + savingsFactor*0.30 + budgetFactor*0.20 + goalsFactor*0.20;
    return Math.max(1, Math.min(99, Math.round(s)));
  })();

  // ── Filtered transactions for Records tab (real-time search)
  // ── Search (declared here so filteredTxs useMemo can reference it without TDZ)
  const [txSearch,       setTxSearch]       = useState("");
  const [txWalletFilter, setTxWalletFilter] = useState("");
  const [txTypeFilter,   setTxTypeFilter]   = useState("all");   // "all"|"income"|"expense"
  const [txPeriod,       setTxPeriod]       = useState("all");   // "all"|"today"|"week"|"month"|"quarter"|"year"|"custom"
  const [txCompare,      setTxCompare]      = useState(false);
  const [compareMode,    setCompareMode]    = useState("previous"); // "previous"|"lastYear"|"custom"
  const [compareCustom,  setCompareCustom]  = useState({ month:"", quarter:1, year:new Date().getFullYear() });
  const [txDateFrom,     setTxDateFrom]     = useState("");
  const [txDateTo,       setTxDateTo]       = useState("");
  const [walletSearch,   setWalletSearch]   = useState("");
  const [walletView,     setWalletView]     = useState("grid");
  const [budgetSearch,   setBudgetSearch]   = useState("");
  const [budgetView,     setBudgetView]     = useState("all"); // "all"|"expense"|"income"

  // ── Per-month budget overrides (manual mode only). A category's budget_kes
  // is the constant default that applies every month unless a monthly_budgets
  // row exists for the currently viewed month — fetched fresh whenever the
  // budget month changes.
  const [monthlyOverrides, setMonthlyOverrides] = useState({}); // {categoryId: budget_kes}
  useEffect(() => {
    if (user?.budget_mode === "percentage") return;
    let cancelled = false;
    budgetsApi.list(budgetYear, budgetMonth).then(({budgets}) => {
      if (cancelled) return;
      const overrides = {};
      (budgets||[]).forEach(b => { if (b.monthly_budget_kes != null) overrides[b.id] = parseFloat(b.monthly_budget_kes); });
      setMonthlyOverrides(overrides);
    }).catch(()=>{});
    return () => { cancelled = true; };
  }, [user?.budget_mode, budgetYear, budgetMonth]);

  // ── Keep "today"-derived state in sync across a midnight rollover, without
  // clobbering a month/period the user deliberately navigated to.
  const todayTick = useMidnightTick();
  const prevTodayYM  = useRef({ y: new Date().getFullYear(), m: new Date().getMonth() + 1 });
  const budgetYMRef  = useRef({ y: budgetYear, m: budgetMonth });
  budgetYMRef.current = { y: budgetYear, m: budgetMonth };
  useEffect(() => {
    const now = new Date();
    const newY = now.getFullYear(), newM = now.getMonth() + 1;
    const { y: prevY, m: prevM } = prevTodayYM.current;
    const { y: curY, m: curM }   = budgetYMRef.current;
    if (curY === prevY && curM === prevM && (curY !== newY || curM !== newM)) {
      setBudgetYear(newY);
      setBudgetMonth(newM);
    }
    prevTodayYM.current = { y: newY, m: newM };
  }, [todayTick]);

  const filteredTxs = useMemo(() => {
    const pool = limits.txHistory < Infinity ? txs.slice(0, limits.txHistory) : txs;
    let result = txWalletFilter
      ? pool.filter(t => (t.wallet || t.wallet_id) === txWalletFilter)
      : pool;

    // ── Type filter
    if (txTypeFilter !== "all") {
      result = result.filter(t => t.type === txTypeFilter);
    }

    // ── Period filter
    if (txPeriod !== "all") {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      result = result.filter(t => {
        const d = new Date(t.date || t.tx_date);
        const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        if (txPeriod === "today")   return day.getTime() === today.getTime();
        if (txPeriod === "week") {
          const dow = today.getDay(); // 0=Sun
          const mon = new Date(today); mon.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
          const sun = new Date(mon);  sun.setDate(mon.getDate() + 6);
          return day >= mon && day <= sun;
        }
        if (txPeriod === "month")   return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
        if (txPeriod === "quarter") {
          const q = Math.floor(now.getMonth() / 3);
          return d.getFullYear() === now.getFullYear() && Math.floor(d.getMonth() / 3) === q;
        }
        if (txPeriod === "year")   return d.getFullYear() === now.getFullYear();
        if (txPeriod === "custom") {
          const from = txDateFrom ? new Date(txDateFrom) : null;
          const to   = txDateTo   ? new Date(txDateTo)   : null;
          if (from && day < from) return false;
          if (to   && day > to)   return false;
          return true;
        }
        return true;
      });
    }

    // ── Text search
    if (!txSearch.trim()) return result;
    const q = txSearch.trim().toLowerCase();
    return result.filter(t => {
      const catId  = t.category || t.category_id;
      const cat    = t.type === "expense" ? expCats.find(c => c.id === catId)
                   : t.type === "income"  ? incCats.find(c => c.id === catId)
                   : null;
      const wallet = wallets.find(w => w.id === (t.wallet || t.wallet_id));
      return (
        (t.merchant || "").toLowerCase().includes(q) ||
        (t.note     || "").toLowerCase().includes(q) ||
        (cat?.name  || "").toLowerCase().includes(q) ||
        (wallet?.name || "").toLowerCase().includes(q)
      );
    });
  }, [txs, txSearch, txWalletFilter, txTypeFilter, txPeriod, txDateFrom, txDateTo, expCats, incCats, wallets, limits.txHistory, todayTick]);

  // How far back "period B" is from "now", in units of the selected period
  // type (today=days, week=weeks, month/quarter/year=months/quarters/years).
  // "lastYear" and "custom" both resolve to a plain offset so they can reuse
  // getPeriodRange exactly like "previous" does — no separate date math.
  const compareOffset = useMemo(() => {
    const now = new Date();
    if (compareMode === "previous") return -1;
    if (compareMode === "lastYear") {
      if (txPeriod === "today") {
        const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const b = new Date(now.getFullYear()-1, now.getMonth(), now.getDate());
        return Math.round((b - a) / 86400000);
      }
      if (txPeriod === "week")    return -52;
      if (txPeriod === "month")   return -12;
      if (txPeriod === "quarter") return -4;
      if (txPeriod === "year")    return -1;
    }
    if (compareMode === "custom") {
      if (txPeriod === "month" && compareCustom.month) {
        const [y,m] = compareCustom.month.split("-").map(Number);
        return (y - now.getFullYear())*12 + (m - (now.getMonth()+1));
      }
      if (txPeriod === "quarter") {
        const curQ = Math.floor(now.getMonth()/3) + 1;
        return (compareCustom.year - now.getFullYear())*4 + (compareCustom.quarter - curQ);
      }
      if (txPeriod === "year") {
        return compareCustom.year - now.getFullYear();
      }
    }
    return -1;
  }, [compareMode, compareCustom, txPeriod]);

  const compareStats = useMemo(() => {
    if (!txCompare || !["today","week","month","quarter","year"].includes(txPeriod)) return null;
    const curRange  = getPeriodRange(txPeriod, 0);
    const prevRange = getPeriodRange(txPeriod, compareOffset);
    const pool = limits.txHistory < Infinity ? txs.slice(0, limits.txHistory) : txs;
    let base = txWalletFilter ? pool.filter(t => (t.wallet || t.wallet_id) === txWalletFilter) : pool;
    if (txTypeFilter !== "all") base = base.filter(t => t.type === txTypeFilter);
    const sumFor = (range) => {
      const rows = base.filter(t => {
        const d = new Date(t.date || t.tx_date);
        const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        return day >= range.start && day <= range.end;
      });
      const inAmt  = rows.filter(t => t.type === "income").reduce((s,t) => s + (t.amount || parseFloat(t.amount_kes||0)), 0);
      const outAmt = rows.filter(t => t.type === "expense").reduce((s,t) => s + (t.amount || parseFloat(t.amount_kes||0)), 0);
      return { in: inAmt, out: outAmt, net: inAmt - outAmt };
    };
    return { cur: { ...sumFor(curRange), label: curRange.label }, prev: { ...sumFor(prevRange), label: prevRange.label } };
  }, [txCompare, txPeriod, compareOffset, txs, txWalletFilter, txTypeFilter, limits.txHistory, todayTick]);

  // ── Wallet / category select options
  const wOpts = wallets.map(w=>({ value:w.id, label:`${w.icon} ${w.name} (${fmtC(parseFloat(w.balance||0),w.currency,currencies,true)} ${w.currency})` }));
  const loanOpts = loans.map(l=>({ value:l.id, label:l.name }));
  const invOpts  = investments.map(i=>({ value:i.id, label:`${i.name} (${i.ticker})` }));
  const ICONS = ["💰","💳","🏠","🚗","⚡","🎬","💊","🍔","📚","🎓","💼","💻","📈","🎯","💵","💹","✈️","🎁","💎","👶","🌴","🔧","⚕️","🎵","🐾","📱","🛒","🏋️","🎮","🌟"];
  const CAT_COLORS = [
    C.blue,C.teal,C.gold,C.coral,C.purple,C.green,C.orange,
    "#1ABC9C","#E74C3C","#3498DB","#8E44AD","#27AE60",
    "#F39C12","#D35400","#C0392B","#16A085","#2980B9",
    "#2ECC71","#F1C40F","#E67E22","#9B59B6","#34495E","#7F8C8D",
    "#EC407A","#AB47BC","#5C6BC0","#26A69A","#66BB6A","#FFCA28",
    "#FF7043","#8D6E63","#78909C","#EF5350","#29B6F6","#9CCC65",
  ];

  // ─────────────────────────────────────────────────────────────────────────
  // FORM BLANKS
  // ─────────────────────────────────────────────────────────────────────────
  const blankTx    = { type:"expense", category:"", amount:"", wallet:"", note:"", merchant:"", isRecurring:false, freq:"monthly", time:"" };
  const blankXfer  = { from:"", to:"", amount:"", note:"" };
  const blankWindfall = { amount:"", fromWallet:"" };
  const blankWal   = { name:"", accountType:"current", currency:"KES", icon:"🏦", color:C.teal, openingBalance:"", currentBalance:"" };
  const blankExpCat= { id:null, name:"", icon:"🏷️", color:C.blue, budget:"", watch:false, parentId:null, allocationType:"fixed", percentOfParent:"", spendKind:null, linkedWalletId:null, kind:"spending", windfallPercent:"", goalTarget:"", goalDeadline:"" };
  const blankIncCat= { name:"", icon:"💵", color:C.teal, budget:"" };
  const blankBudget= { catId:"", catType:"expense", amount:"", everyMonth:true };
  const blankLoan    = { name:"", lender:"", principal:"", currentBalance:"", rate:"", interestType:"compound", termMonths:"", monthlyPayment:"", nextDue:"", currency:"KES" };
  const blankPolicy  = { name:"", provider:"", policyType:"life", policyNumber:"", premiumAmount:"", premiumFreq:"monthly", startDate:"", endDate:"", sumAssured:"", surrenderValue:"", amountPaid:"", beneficiary:"", walletId:"", currency:"KES", notes:"" };
  const blankRepay = { loanId:"", wallet:"", total:"", principal:"", interest:"", date:todayStr(), note:"", files:[] };
  const blankInv   = { name:"", ticker:"", type:"Stock", units:"", buyPrice:"", currency:"KES", wallet:"" };
  const blankRet   = { investmentId:"", type:"interest", amount:"", wallet:"", date:todayStr(), note:"" };
  const blankGoal  = { name:"", icon:"🎯", target:"", wallet:"", deadline:"", color:C.teal, openingBalance:"" };
  const blankRecur = { type:"expense", category:"", amount:"", wallet:"", merchant:"", note:"", freq:"monthly", nextDate:"" };
  const blankRefund = { refundOf:"", amount:"", wallet:"", note:"", date:todayStr() };
  const blankPremiumPayment = { policyId:"", wallet:"", amount:"", date:todayStr(), note:"" };

  const [fTx,     setFTx]    = useState(blankTx);
  const [fXfer,   setFXfer]  = useState(blankXfer);
  const [fWindfall, setFWindfall] = useState(blankWindfall);
  const [fWal,    setFWal]   = useState(blankWal);
  const [fExpCat, setFExpCat]= useState(blankExpCat);
  const [fIncCat, setFIncCat]= useState(blankIncCat);
  const [fBudget, setFBudget]= useState(blankBudget);
  const [fLoan,   setFLoan]  = useState(blankLoan);
  const [fPolicy, setFPolicy]= useState(blankPolicy);
  const [fPremiumPayment, setFPremiumPayment] = useState(blankPremiumPayment);
  const [fRepay,  setFRepay] = useState(blankRepay);
  const [parsingStatement, setParsingStatement] = useState(false);
  const [statementNotice,  setStatementNotice]  = useState("");
  const [fInv,    setFInv]   = useState(blankInv);
  const [fRet,    setFRet]   = useState(blankRet);
  const [fGoal,   setFGoal]  = useState(blankGoal);
  const [fRecur,  setFRecur] = useState(blankRecur);
  const [fRefund, setFRefund]= useState(blankRefund);

  // ── Edit targets (stores the entity being edited, null when adding new)
  const [editTx,      setEditTx]      = useState(null);
  const [editWal,     setEditWal]     = useState(null);
  const [editGoal,    setEditGoal]    = useState(null);
  const [editInv,     setEditInv]     = useState(null);
  const [editLoan,    setEditLoan]    = useState(null);
  const [editPolicy,  setEditPolicy]  = useState(null);
  const [editRepay,   setEditRepay]   = useState(null); // { loan, repayment }
  const [editRefund,  setEditRefund]  = useState(null);
  const [catHistory,  setCatHistory]  = useState(null); // { cat, type } — category records modal
  const [txDetail,    setTxDetail]    = useState(null); // transaction detail modal

  // Confirm dialog
  const [confirm, setConfirm] = useState({ open:false, title:"", message:"", onConfirm:()=>{} });
  const askConfirm = (title, message, onConfirm) => setConfirm({ open:true, title, message, onConfirm });
  const closeConfirm = () => setConfirm(c=>({...c, open:false}));

  // Reconcile
  const [recoWallet,  setRecoWallet]  = useState("");
  const [recoRows,    setRecoRows]    = useState([]);
  const [recoFile,    setRecoFile]    = useState(null);
  const [recoBusy,    setRecoBusy]    = useState(false);

  // Import
  const [importRows,       setImportRows]      = useState([]);
  const [importBusy,       setImportBusy]      = useState(false);
  const [importErrors,     setImportErrors]    = useState([]);
  const [importStep,       setImportStep]      = useState("upload"); // "upload" | "new-items" | "preview"
  const [importParsedRows, setImportParsedRows]= useState([]); // raw rows before validation
  const [importNewWallets, setImportNewWallets]= useState([]); // [{name, type, selected}]
  const [importNewCats,    setImportNewCats]   = useState([]); // [{name, type, selected}]

  // ─────────────────────────────────────────────────────────────────────────
  // API ACTIONS  (optimistic UI: update state first, then call API)
  // ─────────────────────────────────────────────────────────────────────────

  // Helper: get wallet currency
  const walletCur = (wid) => wallets.find(w=>w.id===wid)?.currency||"KES";

  const addTx = async () => {
    const amt = parseFloat(fTx.amount); if(!amt) return;
    const wid = fTx.wallet;
    const amtKES = toKES(amt, walletCur(wid), currencies);
    const payload = {
      wallet_id:   wid,
      category_id: fTx.category||undefined,
      type:        fTx.type,
      amount_kes:  amtKES,
      merchant:    fTx.merchant||undefined,
      note:        fTx.note||undefined,
      tx_date:     localDateTimeToISO(fTx.date, fTx.time),
    };
    try {
      const { transaction: tx } = await txApi.create(payload);
      setTxs(p=>[{ ...tx, wallet:tx.wallet_id, category:tx.category_id, amount:parseFloat(tx.amount_kes), date:(tx.tx_date||'').slice(0,10) }, ...p]);
      setWallets(p=>p.map(w=>w.id===wid?{...w,balance:parseFloat(w.balance)+(fTx.type==="income"?amtKES:-amtKES)}:w));
      if(fTx.isRecurring) {
        const { recurring: r } = await recurApi.create({
          wallet_id:   wid, category_id:fTx.category||undefined,
          type:fTx.type, amount_kes:amtKES,
          merchant:fTx.merchant||undefined, note:fTx.note||undefined,
          freq:fTx.freq, next_date:todayStr(),
        });
        setRecurring(p=>[...p, normaliseRecurring(r)]);
      }
      setFTx(blankTx); closeM("tx");
      showToast("Transaction added");
    } catch(err) { showToast(err?.response?.data?.error||"Failed to add transaction", C.coral); }
  };

  const doTransfer = async () => {
    const amt = parseFloat(fXfer.amount); if(!amt) return;
    const fromW = wallets.find(w=>w.id===fXfer.from);
    const amtKES = toKES(amt, fromW?.currency||"KES", currencies);
    try {
      await walletsApi.transfer({ from_wallet_id:fXfer.from, to_wallet_id:fXfer.to, amount_kes:amtKES, note:fXfer.note||undefined });
      setWallets(p=>p.map(w=>{
        if(w.id===fXfer.from) return{...w,balance:parseFloat(w.balance)-amtKES};
        if(w.id===fXfer.to)   return{...w,balance:parseFloat(w.balance)+amtKES};
        return w;
      }));
      // Fetch the two transfer transaction records so they appear in Records tab immediately
      const { transactions: fresh } = await txApi.list({ limit: 10 });
      if (fresh?.length) {
        const newTxs = fresh
          .filter(tx => tx.transfer_pair_id && !txs.find(t=>t.id===tx.id))
          .map(tx => ({ ...tx, wallet:tx.wallet_id, category:tx.category_id, amount:parseFloat(tx.amount_kes), date:(tx.tx_date||"").slice(0,10) }));
        if (newTxs.length) setTxs(p=>[...newTxs, ...p]);
      }
      setFXfer(blankXfer); closeM("xfer");
      showToast("Transfer complete");
    } catch(err) { showToast(err?.response?.data?.error||"Transfer failed", C.coral); }
  };

  // Moves money into a Primary category's linked wallet — a real transfer
  // (tagged with the category so its "Used" can be tracked), not an expense.
  const allocateToCategory = async (categoryId, sourceWalletId, amount) => {
    const amt = parseFloat(amount); if(!amt || !sourceWalletId) return;
    const cat = expCats.find(c=>c.id===categoryId); if(!cat?.linkedWalletId) return;
    const fromW = wallets.find(w=>w.id===sourceWalletId);
    const amtKES = toKES(amt, fromW?.currency||"KES", currencies);
    try {
      await walletsApi.transfer({ from_wallet_id:sourceWalletId, to_wallet_id:cat.linkedWalletId, amount_kes:amtKES, note:`Allocation: ${cat.name}`, category_id:categoryId });
      setWallets(p=>p.map(w=>{
        if(w.id===sourceWalletId)   return{...w,balance:parseFloat(w.balance)-amtKES};
        if(w.id===cat.linkedWalletId) return{...w,balance:parseFloat(w.balance)+amtKES};
        return w;
      }));
      const { transactions: fresh } = await txApi.list({ limit: 10 });
      if (fresh?.length) {
        const newTxs = fresh
          .filter(tx => tx.transfer_pair_id && !txs.find(t=>t.id===tx.id))
          .map(tx => ({ ...tx, wallet:tx.wallet_id, category:tx.category_id, amount:parseFloat(tx.amount_kes), date:(tx.tx_date||"").slice(0,10) }));
        if (newTxs.length) setTxs(p=>[...newTxs, ...p]);
      }
      showToast(`Allocated to ${cat.name}`);
    } catch(err) { showToast(err?.response?.data?.error||"Allocation failed", C.coral); }
  };

  // One-off income (bonus, gift) split across every top-level Primary category
  // that has both a Windfall % and a linked account — a separate percentage
  // set from the monthly Gross Income cascade, executed as one atomic batch.
  const recordWindfall = async () => {
    const amt = parseFloat(fWindfall.amount); if(!amt || !fWindfall.fromWallet) return;
    const fromW = wallets.find(w=>w.id===fWindfall.fromWallet);
    const amtKES = toKES(amt, fromW?.currency||"KES", currencies);
    const candidates = expCats.filter(c=>!c.parentId && c.windfallPercent>0 && c.linkedWalletId);
    if(!candidates.length) { showToast("No Primary category has both a Windfall % and a linked account", C.coral); return; }
    const allocations = candidates.map(c=>({ category_id:c.id, wallet_id:c.linkedWalletId, amount_kes: amtKES*(c.windfallPercent/100) }));
    try {
      await walletsApi.splitWindfall({ from_wallet_id: fWindfall.fromWallet, amount_kes: amtKES, allocations });
      setWallets(p=>p.map(w=>{
        let delta = 0;
        if (w.id===fWindfall.fromWallet) delta -= allocations.reduce((s,a)=>s+a.amount_kes,0);
        delta += allocations.filter(a=>a.wallet_id===w.id).reduce((s,a)=>s+a.amount_kes,0);
        return delta ? {...w, balance: parseFloat(w.balance) + delta} : w;
      }));
      const { transactions: fresh } = await txApi.list({ limit: candidates.length*2 + 10 });
      if (fresh?.length) {
        const newTxs = fresh
          .filter(tx => tx.transfer_pair_id && !txs.find(t=>t.id===tx.id))
          .map(tx => ({ ...tx, wallet:tx.wallet_id, category:tx.category_id, amount:parseFloat(tx.amount_kes), date:(tx.tx_date||"").slice(0,10) }));
        if (newTxs.length) setTxs(p=>[...newTxs, ...p]);
      }
      setFWindfall(blankWindfall); closeM("windfall");
      showToast(`Windfall split across ${candidates.length} categor${candidates.length===1?"y":"ies"}`);
    } catch(err) { showToast(err?.response?.data?.error||"Windfall split failed", C.coral); }
  };

  const addWallet = async () => {
    if(!fWal.name) return;
    try {
      const bal = toKES(parseFloat(fWal.openingBalance)||0, fWal.currency, currencies);
      const { wallet } = await walletsApi.create({
        name:fWal.name, account_type:fWal.accountType,
        currency:fWal.currency, balance:bal, opening_balance:bal,
        color:fWal.color, icon:fWal.icon,
      });
      setWallets(p=>[...p, wallet]);
      setFWal(blankWal); closeM("wallet");
      showToast("Account created");
    } catch(err) { showToast(err?.response?.data?.error||"Failed", C.coral); }
  };

  const openEditExpCat = (c) => {
    setFExpCat({
      id:c.id, name:c.name, icon:c.icon, color:c.color, watch:c.watch,
      budget:String(c.budget||""), parentId:c.parentId||null,
      allocationType:c.allocationType||"fixed",
      percentOfParent:c.percentOfParent!=null?String(c.percentOfParent):"",
      spendKind:c.spendKind||null,
      linkedWalletId:c.linkedWalletId||null,
      kind: c.allocationType==="fixed" ? "spending" : (c.linkedWalletId ? "primary" : "parent"),
      windfallPercent:c.windfallPercent!=null?String(c.windfallPercent):"",
      goalTarget:c.goalTargetKes!=null?String(c.goalTargetKes):"",
      goalDeadline:c.goalDeadline||"",
    });
    openM("expCat");
  };

  const addExpCat = async () => {
    if(!fExpCat.name) return;
    const payload = { name:fExpCat.name, type:"expense", icon:fExpCat.icon, color:fExpCat.color, watch:fExpCat.watch, allocation_type:fExpCat.allocationType };
    if (fExpCat.allocationType==="percent") { payload.percent_of_parent = parseFloat(fExpCat.percentOfParent)||0; payload.budget_kes = 0; }
    else { payload.budget_kes = parseFloat(fExpCat.budget)||0; payload.percent_of_parent = null; }
    payload.parent_id = fExpCat.parentId || null;
    payload.spend_kind = fExpCat.parentId ? fExpCat.spendKind : null;
    payload.linked_wallet_id = fExpCat.allocationType==="percent" ? (fExpCat.linkedWalletId||null) : null;
    const isPrimary = fExpCat.kind==="primary";
    payload.windfall_percent = isPrimary && fExpCat.windfallPercent!=="" ? parseFloat(fExpCat.windfallPercent)||0 : null;
    payload.goal_target_kes  = isPrimary && payload.linked_wallet_id && fExpCat.goalTarget!=="" ? parseFloat(fExpCat.goalTarget)||0 : null;
    payload.goal_deadline    = isPrimary && payload.linked_wallet_id && fExpCat.goalDeadline ? fExpCat.goalDeadline : null;
    try {
      if (fExpCat.id) {
        const { category } = await catsApi.update(fExpCat.id, payload);
        setExpCats(p=>p.map(c=>c.id===fExpCat.id?normaliseCategory(category):c));
        showToast("Category updated");
      } else {
        const { category } = await catsApi.create(payload);
        setExpCats(p=>[...p, normaliseCategory(category)]);
        showToast("Category added");
      }
      setFExpCat(blankExpCat); closeM("expCat");
    } catch(err) { showToast(err?.response?.data?.error||"Failed", C.coral); }
  };

  const addIncCat = async () => {
    if(!fIncCat.name) return;
    try {
      const { category } = await catsApi.create({ name:fIncCat.name, type:"income", icon:fIncCat.icon, color:fIncCat.color, budget_kes:parseFloat(fIncCat.budget)||0 });
      setIncCats(p=>[...p, normaliseCategory(category)]);
      setFIncCat(blankIncCat); closeM("incCat");
      showToast("Category added");
    } catch(err) { showToast(err?.response?.data?.error||"Failed", C.coral); }
  };

  const saveBudget = async () => {
    const amt = parseFloat(fBudget.amount)||0;
    try {
      if (fBudget.everyMonth) {
        await catsApi.update(fBudget.catId, { budget_kes:amt });
        if(fBudget.catType==="expense") setExpCats(p=>p.map(c=>c.id===fBudget.catId?{...c,budget:amt}:c));
        else setIncCats(p=>p.map(c=>c.id===fBudget.catId?{...c,budget:amt}:c));
        showToast("Budget updated — applies every month until you change it");
      } else {
        await budgetsApi.setMonthly({ category_id:fBudget.catId, year:budgetYear, month:budgetMonth, budget_kes:amt });
        setMonthlyOverrides(p=>({...p,[fBudget.catId]:amt}));
        showToast(`Budget set for ${MONTH_NAMES[budgetMonth-1]} only`);
      }
      setFBudget(blankBudget); closeM("budget");
    } catch(err) { showToast(err?.response?.data?.error||"Failed", C.coral); }
  };

  const clearMonthlyOverride = async (catId) => {
    try {
      await budgetsApi.removeMonthly(catId, budgetYear, budgetMonth);
      setMonthlyOverrides(p=>{ const n={...p}; delete n[catId]; return n; });
      setFBudget(blankBudget); closeM("budget");
      showToast("Reverted to the default budget");
    } catch(err) { showToast(err?.response?.data?.error||"Failed", C.coral); }
  };

  const toggleWatch = async (catId) => {
    const cat = expCats.find(c=>c.id===catId); if(!cat) return;
    try {
      await catsApi.update(catId, { watch:!cat.watch });
      setExpCats(p=>p.map(c=>c.id===catId?{...c,watch:!c.watch}:c));
      showToast(!cat.watch?"Now watching":"Removed from watch");
    } catch(err) { showToast("Failed", C.coral); }
  };

  const addLoan = async () => {
    const p = parseFloat(fLoan.principal); if(!p||!fLoan.name) return;
    try {
      const principalKES = toKES(p, fLoan.currency, currencies);
      const curBal = parseFloat(fLoan.currentBalance);
      const { loan } = await loansApi.create({
        name:fLoan.name, lender:fLoan.lender||undefined, currency:fLoan.currency,
        principal_kes: principalKES,
        remaining_kes: !isNaN(curBal) && fLoan.currentBalance !== "" ? toKES(curBal, fLoan.currency, currencies) : undefined,
        interest_rate: parseFloat(fLoan.rate)||0,
        interest_type: fLoan.interestType||"compound",
        term_months: fLoan.termMonths ? parseInt(fLoan.termMonths) : undefined,
        monthly_payment_kes: toKES(parseFloat(fLoan.monthlyPayment)||0, fLoan.currency, currencies),
        next_due_date: fLoan.nextDue||undefined,
      });
      setLoans(p=>[...p, normaliseLoan(loan)]);
      setFLoan(blankLoan); closeM("loan");
      showToast("Loan added");
    } catch(err) { showToast(err?.response?.data?.error||"Failed", C.coral); }
  };

  const handleRepayStatementFile = async (file) => {
    setFRepay(p=>({...p,files:[...p.files,file]}));
    if(!fRepay.loanId) return;
    setParsingStatement(true); setStatementNotice("");
    try {
      const fields = await loansApi.parseRepaymentStatement(fRepay.loanId, file);
      setFRepay(p=>({
        ...p,
        total:  p.total  || (fields.amount_kes ? String(fields.amount_kes) : p.total),
        date:   fields.payment_date || p.date,
        note:   p.note   || (fields.note || p.note),
      }));
      setStatementNotice(fields.warning || "Auto-filled from the statement — please review before saving.");
    } catch(err) {
      setStatementNotice(err?.response?.data?.error||"Couldn't read this file — please fill in the fields manually.");
    } finally { setParsingStatement(false); }
  };

  const addRepayment = async () => {
    const total = parseFloat(fRepay.total); if(!total) return;
    const loan  = loans.find(l=>l.id===fRepay.loanId); if(!loan) return;
    try {
      const { repayment } = await loansApi.recordRepayment(loan.id, {
        wallet_id:    fRepay.wallet,
        total_kes:    toKES(total, loan.currency, currencies),
        principal_kes:toKES(parseFloat(fRepay.principal)||0, loan.currency, currencies),
        interest_kes: toKES(parseFloat(fRepay.interest)||0,  loan.currency, currencies),
        payment_date: fRepay.date,
        note:         fRepay.note||undefined,
        files:        fRepay.files,
      });
      setLoans(p=>p.map(l=>{
        if(l.id!==loan.id) return l;
        const reduction = l.interest_type==="simple" ? parseFloat(repayment.total_kes||0) : parseFloat(repayment.principal_kes||0);
        return {...l, remaining:Math.max(0,l.remaining-reduction), repayments:[...l.repayments,{total:parseFloat(repayment.total_kes),principal:parseFloat(repayment.principal_kes),interest:parseFloat(repayment.interest_kes),date:(repayment.payment_date||"").slice(0,10),note:repayment.note,attachments:[]}]};
      }));
      setWallets(p=>p.map(w=>w.id===fRepay.wallet?{...w,balance:parseFloat(w.balance)-parseFloat(repayment.total_kes||0)}:w));
      setFRepay(blankRepay); setStatementNotice(""); closeM("repay");
      showToast("Repayment recorded");
    } catch(err) { showToast(err?.response?.data?.error||"Failed", C.coral); }
  };

  const addInvestment = async () => {
    const units=parseFloat(fInv.units), price=parseFloat(fInv.buyPrice);
    if(!units||!price||!fInv.name) return;
    try {
      const { investment: inv } = await invsApi.create({
        wallet_id:         fInv.wallet,
        name:              fInv.name,
        ticker:            fInv.ticker||undefined,
        type:              fInv.type,
        currency:          fInv.currency,
        units,
        buy_price_kes:     toKES(price, fInv.currency, currencies),
        current_price_kes: toKES(price, fInv.currency, currencies),
      });
      setInvestments(p=>[...p, normaliseInv({...inv,returns:[]})]);
      setFInv(blankInv); closeM("inv");
      showToast("Investment added");
    } catch(err) { showToast(err?.response?.data?.error||"Failed", C.coral); }
  };

  const addReturn = async () => {
    const amt = parseFloat(fRet.amount); if(!amt) return;
    const inv  = investments.find(i=>i.id===fRet.investmentId); if(!inv) return;
    try {
      const { return: ret } = await invsApi.recordReturn(inv.id, {
        wallet_id:   fRet.wallet,
        return_type: fRet.type,
        amount_kes:  toKES(amt, inv.currency, currencies),
        return_date: fRet.date,
        note:        fRet.note||undefined,
      });
      setInvestments(p=>p.map(i=>i.id===inv.id?{...i,returns:[...i.returns,{type:ret.return_type,amount:parseFloat(ret.amount_kes),date:ret.return_date,note:ret.note}]}:i));
      setWallets(p=>p.map(w=>w.id===fRet.wallet?{...w,balance:parseFloat(w.balance)+parseFloat(ret.amount_kes||0)}:w));
      if (ret.transaction) {
        const tx = ret.transaction;
        setTxs(p=>[{ ...tx, wallet:tx.wallet_id, category:tx.category_id, amount:parseFloat(tx.amount_kes), date:(tx.tx_date||'').slice(0,10) }, ...p]);
      }
      setFRet(blankRet); closeM("ret");
      showToast("Return recorded");
    } catch(err) { showToast(err?.response?.data?.error||"Failed", C.coral); }
  };

  const addGoal = async () => {
    const t=parseFloat(fGoal.target); if(!t||!fGoal.name) return;
    try {
      const { goal } = await goalsApi.create({
        wallet_id:  fGoal.wallet||undefined,
        name:       fGoal.name, icon:fGoal.icon, color:fGoal.color,
        target_kes: t,
        saved_kes:  parseFloat(fGoal.openingBalance)||0,
        deadline:   fGoal.deadline||undefined,
      });
      setGoals(p=>[...p, normaliseGoal(goal)]);
      setFGoal(blankGoal); closeM("goal");
      showToast("Goal created");
    } catch(err) { showToast(err?.response?.data?.error||"Failed", C.coral); }
  };

  const fundGoal = async (gid, amt, walletId, extra={}) => {
    try {
      const goal = goals.find(g=>g.id===gid);
      const { goal: updated, contribution, transactions } = await goalsApi.fund(gid, {
        amount: amt, from_wallet_id: walletId,
        note: extra.note||undefined, contributed_date: extra.date||undefined,
      });
      const normContrib = normaliseContribution(contribution);
      setGoals(p=>p.map(g=>g.id===gid?{...g, saved:parseFloat(updated.saved_kes), is_achieved:updated.is_achieved, contributions:[normContrib,...g.contributions]}:g));
      setWallets(p=>p.map(w=>{
        if (w.id===walletId) return {...w,balance:parseFloat(w.balance)-amt};
        if (goal && w.id===goal.wallet_id) return {...w,balance:parseFloat(w.balance)+amt};
        return w;
      }));
      if (transactions?.length) {
        setTxs(p=>[...transactions.map(tx=>({...tx, wallet:tx.wallet_id, amount:parseFloat(tx.amount_kes), date:(tx.tx_date||'').slice(0,10)})), ...p]);
      }
      showToast(`Added ${disp(amt)} to goal`);
    } catch(err) { showToast(err?.response?.data?.error||"Failed", C.coral); }
  };

  const editGoalContribution = async (gid, cid, patch) => {
    try {
      const goal = goals.find(g=>g.id===gid);
      const old = goal?.contributions.find(c=>c.id===cid);
      const { goal: updated, contribution } = await goalsApi.updateContribution(gid, cid, patch);
      const normContrib = normaliseContribution(contribution);
      setGoals(p=>p.map(g=>g.id===gid?{...g, saved:parseFloat(updated.saved_kes), is_achieved:updated.is_achieved, contributions:g.contributions.map(c=>c.id===cid?normContrib:c)}:g));
      // Reverse the old contribution's wallet effect and apply the new one
      setWallets(p=>p.map(w=>{
        let b = parseFloat(w.balance);
        if (old) {
          if (w.id === old.fromWallet) b += old.amount;
          if (w.id === old.toWallet)   b -= old.amount;
        }
        if (w.id === normContrib.fromWallet) b -= normContrib.amount;
        if (w.id === normContrib.toWallet)   b += normContrib.amount;
        return b !== parseFloat(w.balance) ? {...w, balance:b} : w;
      }));
      setTxs(p=>p.map(t=>{
        if (t.goal_contribution_id !== cid) return t;
        return {
          ...t,
          amount: normContrib.amount,
          wallet: t.type==="transfer_out" ? normContrib.fromWallet : normContrib.toWallet,
          date:   normContrib.date,
          note:   normContrib.note,
        };
      }));
      showToast("Contribution updated");
    } catch(err) { showToast(err?.response?.data?.error||"Failed", C.coral); }
  };

  const deleteGoalContribution = async (gid, cid) => {
    try {
      const goal = goals.find(g=>g.id===gid);
      const c = goal?.contributions.find(x=>x.id===cid);
      await goalsApi.removeContribution(gid, cid);
      setGoals(p=>p.map(g=>g.id===gid?{...g, saved:Math.max(0,g.saved-(c?.amount||0)), contributions:g.contributions.filter(x=>x.id!==cid)}:g));
      if (c) {
        setWallets(p=>p.map(w=>{
          if (w.id===c.fromWallet) return {...w,balance:parseFloat(w.balance)+c.amount};
          if (w.id===c.toWallet)   return {...w,balance:parseFloat(w.balance)-c.amount};
          return w;
        }));
      }
      setTxs(p=>p.filter(t=>t.goal_contribution_id!==cid));
      showToast("Contribution deleted");
    } catch(err) { showToast(err?.response?.data?.error||"Failed to delete", C.coral); }
  };

  const addRecurring = async () => {
    const amt=parseFloat(fRecur.amount); if(!amt) return;
    try {
      const { recurring: r } = await recurApi.create({
        wallet_id:   fRecur.wallet, category_id:fRecur.category||undefined,
        type:fRecur.type, amount_kes:toKES(amt,walletCur(fRecur.wallet),currencies),
        merchant:fRecur.merchant||undefined, note:fRecur.note||undefined,
        freq:fRecur.freq, next_date:fRecur.nextDate,
      });
      setRecurring(p=>[...p, normaliseRecurring(r)]);
      setFRecur(blankRecur); closeM("recur");
      showToast("Recurring added");
    } catch(err) { showToast(err?.response?.data?.error||"Failed", C.coral); }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // EDIT HANDLERS
  // ─────────────────────────────────────────────────────────────────────────

  // Open edit modal pre-filled
  const openEditTx = (tx) => {
    setEditTx(tx);
    setFTx({
      type:     tx.type,
      category: tx.category || tx.category_id || "",
      amount:   String(tx.amount || parseFloat(tx.amount_kes || 0)),
      wallet:   tx.wallet || tx.wallet_id || "",
      note:     tx.note || "",
      merchant: tx.merchant || "",
      isRecurring: false,
      freq: "monthly",
      date: tx.date || (tx.tx_date||"").slice(0,10) || todayStr(),
      time: (() => { const d = tx.tx_date ? new Date(tx.tx_date) : new Date(); return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0"); })(),
    });
    openM("tx");
  };

  const openEditWallet = (w) => {
    setEditWal(w);
    setFWal({
      name:           w.name,
      accountType:    w.account_type || w.accountType || "current",
      currency:       w.currency || "KES",
      icon:           w.icon || "🏦",
      color:          w.color || C.teal,
      openingBalance: String(parseFloat(w.opening_balance ?? w.balance ?? 0)),
      currentBalance: String(parseFloat(w.balance ?? 0)),
    });
    openM("wallet");
  };

  const openEditGoal = (g) => {
    setEditGoal(g);
    setFGoal({
      name:     g.name,
      icon:     g.icon || "🎯",
      target:   String(g.target_kes || g.target || ""),
      wallet:   g.wallet_id || g.wallet || "",
      deadline: g.deadline || "",
      color:    g.color || C.teal,
    });
    openM("goal");
  };

  const openEditInv = (inv) => {
    setEditInv(inv);
    setFInv({
      name:      inv.name,
      ticker:    inv.ticker || "",
      type:      inv.type || "Stock",
      units:     String(inv.units || ""),
      buyPrice:  String(inv.buyPrice || inv.buy_price_kes || ""),
      currency:  inv.currency || "KES",
      wallet:    inv.wallet || inv.wallet_id || "",
      currentPrice: String(inv.currentPrice || inv.current_price_kes || ""),
    });
    openM("inv");
  };

  const openEditLoan = (l) => {
    setEditLoan(l);
    setFLoan({
      name:           l.name,
      lender:         l.lender || "",
      principal:      String(l.principal || l.principal_kes || ""),
      currentBalance: String(l.remaining ?? l.remaining_kes ?? l.principal ?? l.principal_kes ?? ""),
      rate:           String(l.rate || l.interest_rate || ""),
      termMonths:     l.termMonths || l.term_months ? String(l.termMonths || l.term_months) : "",
      monthlyPayment: String(l.monthlyPayment || l.monthly_payment_kes || ""),
      nextDue:        l.nextDue || l.next_due_date || "",
      currency:       l.currency || "KES",
    });
    openM("loan");
  };

  const openEditRepay = (loan, repayment) => {
    setEditRepay({ loan, repayment });
    setFRepay({
      loanId:    loan.id,
      wallet:    repayment.wallet || repayment.wallet_id || wallets[0]?.id || "",
      total:     String(repayment.total || repayment.total_kes || ""),
      principal: String(repayment.principal || repayment.principal_kes || ""),
      interest:  String(repayment.interest || repayment.interest_kes || ""),
      date:      repayment.date || repayment.payment_date || todayStr(),
      note:      repayment.note || "",
      files:     [],
    });
    openM("repay");
  };

  // Save edits
  const saveTx = async () => {
    const amt = parseFloat(fTx.amount); if (!amt) return;
    const wid = fTx.wallet;
    const amtKES = toKES(amt, walletCur(wid), currencies);
    if (editTx) {
      // EDIT mode
      try {
        const { transaction: tx } = await txApi.update(editTx.id, {
          wallet_id:   wid,
          category_id: fTx.category || undefined,
          type:        fTx.type,
          amount_kes:  amtKES,
          merchant:    fTx.merchant || undefined,
          note:        fTx.note || undefined,
          tx_date:     localDateTimeToISO(fTx.date, fTx.time),
        });
        const norm = { ...tx, wallet:tx.wallet_id, category:tx.category_id, amount:parseFloat(tx.amount_kes), date:(tx.tx_date||'').slice(0,10) };
        setTxs(p => p.map(t => t.id === editTx.id ? norm : t));
        // Recalculate wallet balances: reverse old, apply new
        const oldAmt   = editTx.amount || parseFloat(editTx.amount_kes || 0);
        const oldIsIn  = editTx.type === "income" || editTx.type === "transfer_in";
        const newIsIn  = fTx.type === "income" || fTx.type === "transfer_in";
        const oldWid   = editTx.wallet || editTx.wallet_id;
        setWallets(p => p.map(w => {
          let bal = parseFloat(w.balance);
          if (w.id === oldWid) bal += oldIsIn ? -oldAmt : oldAmt;
          if (w.id === wid)    bal += newIsIn ?  amtKES : -amtKES;
          return w.id === oldWid || w.id === wid ? { ...w, balance: bal } : w;
        }));
        setEditTx(null); setFTx(blankTx); closeM("tx");
        showToast("Transaction updated");
      } catch(err) { showToast(err?.response?.data?.error || "Failed to update", C.coral); }
    } else {
      addTx();
    }
  };

  const saveWallet = async () => {
    if (!fWal.name) return;
    if (editWal) {
      try {
        const curBal = toKES(parseFloat(fWal.currentBalance) || 0, fWal.currency, currencies);
        const openBal = toKES(parseFloat(fWal.openingBalance) || 0, fWal.currency, currencies);
        const { wallet } = await walletsApi.update(editWal.id, {
          name:            fWal.name,
          account_type:    fWal.accountType,
          currency:        fWal.currency,
          balance:         curBal,
          opening_balance: openBal,
          color:           fWal.color,
          icon:            fWal.icon,
        });
        setWallets(p => p.map(w => w.id === editWal.id ? wallet : w));
        setEditWal(null); setFWal(blankWal); closeM("wallet");
        showToast("Account updated");
      } catch(err) { showToast(err?.response?.data?.error || "Failed", C.coral); }
    } else {
      addWallet();
    }
  };

  const saveGoal = async () => {
    const t = parseFloat(fGoal.target); if (!t || !fGoal.name) return;
    if (editGoal) {
      try {
        const { goal } = await goalsApi.update(editGoal.id, {
          name:       fGoal.name,
          icon:       fGoal.icon,
          color:      fGoal.color,
          target_kes: t,
          wallet_id:  fGoal.wallet || undefined,
          deadline:   fGoal.deadline || null,
        });
        setGoals(p => p.map(g => g.id === editGoal.id ? normaliseGoal(goal) : g));
        setEditGoal(null); setFGoal(blankGoal); closeM("goal");
        showToast("Goal updated");
      } catch(err) { showToast(err?.response?.data?.error || "Failed", C.coral); }
    } else {
      addGoal();
    }
  };

  const saveInvestment = async () => {
    const units = parseFloat(fInv.units), price = parseFloat(fInv.buyPrice);
    if (!fInv.name) return;
    if (editInv) {
      try {
        const payload = {};
        if (fInv.name)         payload.name              = fInv.name;
        if (fInv.ticker)       payload.ticker             = fInv.ticker;
        if (fInv.type)         payload.type               = fInv.type;
        if (fInv.currency)     payload.currency           = fInv.currency;
        if (units)             payload.units              = units;
        if (price)             payload.buy_price_kes      = toKES(price, fInv.currency, currencies);
        if (fInv.currentPrice) payload.current_price_kes  = toKES(parseFloat(fInv.currentPrice), fInv.currency, currencies);
        if (fInv.wallet)       payload.wallet_id          = fInv.wallet;
        const { investment: inv } = await invsApi.update(editInv.id, payload);
        setInvestments(p => p.map(i => i.id === editInv.id ? normaliseInv({ ...inv, returns: editInv.returns || [] }) : i));
        setEditInv(null); setFInv(blankInv); closeM("inv");
        showToast("Investment updated");
      } catch(err) { showToast(err?.response?.data?.error || "Failed", C.coral); }
    } else {
      addInvestment();
    }
  };

  const saveLoan = async () => {
    if (!fLoan.name) return;
    if (editLoan) {
      try {
        const payload = { name: fLoan.name };
        if (fLoan.lender)         payload.lender              = fLoan.lender;
        if (fLoan.currency)       payload.currency            = fLoan.currency;
        if (fLoan.principal)      payload.principal_kes       = toKES(parseFloat(fLoan.principal), fLoan.currency, currencies);
        if (fLoan.currentBalance !== "") payload.remaining_kes = toKES(parseFloat(fLoan.currentBalance)||0, fLoan.currency, currencies);
        if (fLoan.rate)           payload.interest_rate       = parseFloat(fLoan.rate);
        payload.term_months = fLoan.termMonths ? parseInt(fLoan.termMonths) : null;
        if (fLoan.monthlyPayment) payload.monthly_payment_kes = toKES(parseFloat(fLoan.monthlyPayment), fLoan.currency, currencies);
        if (fLoan.nextDue)        payload.next_due_date       = fLoan.nextDue;
        const { loan } = await loansApi.update(editLoan.id, payload);
        setLoans(p => p.map(l => l.id === editLoan.id ? { ...normaliseLoan(loan), repayments: editLoan.repayments } : l));
        setEditLoan(null); setFLoan(blankLoan); closeM("loan");
        showToast("Loan updated");
      } catch(err) { showToast(err?.response?.data?.error || "Failed", C.coral); }
    } else {
      addLoan();
    }
  };

  const saveRepayment = async () => {
    const total = parseFloat(fRepay.total); if (!total) return;
    if (editRepay) {
      try {
        const { repayment } = await loansApi.updateRepayment(editRepay.loan.id, editRepay.repayment.id, {
          wallet_id:    fRepay.wallet,
          total_kes:    toKES(total, editRepay.loan.currency, currencies),
          principal_kes:toKES(parseFloat(fRepay.principal) || 0, editRepay.loan.currency, currencies),
          interest_kes: toKES(parseFloat(fRepay.interest) || 0,  editRepay.loan.currency, currencies),
          payment_date: fRepay.date,
          note:         fRepay.note || undefined,
        });
        setLoans(p => p.map(l => {
          if (l.id !== editRepay.loan.id) return l;
          const reps = l.repayments.map(r =>
            r.id === editRepay.repayment.id
              ? { ...r, total:parseFloat(repayment.total_kes), principal:parseFloat(repayment.principal_kes), interest:parseFloat(repayment.interest_kes), date:repayment.payment_date, note:repayment.note }
              : r
          );
          // Recalc remaining
          const paidPrincipal = reps.reduce((s, r) => s + (r.principal || 0), 0);
          return { ...l, repayments: reps, remaining: Math.max(0, l.principal - paidPrincipal) };
        }));
        // Reverse the old debit (possibly on a different wallet) and apply the new one
        setWallets(p=>p.map(w=>{
          let b = parseFloat(w.balance);
          if (w.id === editRepay.repayment.wallet) b += editRepay.repayment.total;
          if (w.id === fRepay.wallet) b -= parseFloat(repayment.total_kes||0);
          return (w.id === editRepay.repayment.wallet || w.id === fRepay.wallet) ? {...w, balance:b} : w;
        }));
        setEditRepay(null); setFRepay(blankRepay); closeM("repay");
        showToast("Repayment updated");
      } catch(err) { showToast(err?.response?.data?.error || "Failed", C.coral); }
    } else {
      addRepayment();
    }
  };

  // ── Insurance handlers ───────────────────────────────────────────────────────
  const savePolicy = async () => {
    if (!fPolicy.name || !fPolicy.provider) return showToast("Policy name and provider are required", C.coral);
    const payload = {
      name:              fPolicy.name,
      provider:          fPolicy.provider,
      policy_type:       fPolicy.policyType,
      policy_number:     fPolicy.policyNumber||undefined,
      premium_amount:    parseFloat(fPolicy.premiumAmount)||0,
      premium_frequency: fPolicy.premiumFreq,
      start_date:        fPolicy.startDate||undefined,
      end_date:          fPolicy.endDate||undefined,
      sum_assured:       fPolicy.sumAssured?parseFloat(fPolicy.sumAssured):undefined,
      surrender_value:   fPolicy.surrenderValue?parseFloat(fPolicy.surrenderValue):undefined,
      amount_paid:       fPolicy.amountPaid?parseFloat(fPolicy.amountPaid):undefined,
      beneficiary:       fPolicy.beneficiary||undefined,
      wallet_id:         fPolicy.walletId||undefined,
      currency:          fPolicy.currency,
      notes:             fPolicy.notes||undefined,
    };
    try {
      if (editPolicy) {
        const {policy} = await insuranceApi.update(editPolicy.id, payload);
        setPolicies(p => p.map(x => x.id===editPolicy.id ? {...policy, payments:x.payments||[]} : x));
        showToast("Policy updated");
      } else {
        const {policy} = await insuranceApi.create(payload);
        setPolicies(p => [policy, ...p]);
        showToast("Policy added");
      }
      setEditPolicy(null); setFPolicy(blankPolicy); closeM("policy");
    } catch(err) { showToast(err?.response?.data?.error||"Failed", C.coral); }
  };

  const deletePolicy = async (id) => {
    try {
      await insuranceApi.remove(id);
      setPolicies(p => p.filter(x => x.id!==id));
      showToast("Policy deleted");
    } catch(err) { showToast(err?.response?.data?.error||"Failed", C.coral); }
  };

  const openEditPolicy = (p) => {
    setEditPolicy(p);
    setFPolicy({
      name:           p.name,
      provider:       p.provider,
      policyType:     p.policy_type,
      policyNumber:   p.policy_number||"",
      premiumAmount:  String(parseFloat(p.premium_amount)||""),
      premiumFreq:    p.premium_frequency,
      startDate:      (p.start_date||"").slice(0,10),
      endDate:        (p.end_date||"").slice(0,10),
      sumAssured:     p.sum_assured?String(parseFloat(p.sum_assured)):"",
      surrenderValue: p.surrender_value?String(parseFloat(p.surrender_value)):"",
      amountPaid:     p.amount_paid?String(parseFloat(p.amount_paid)):"",
      beneficiary:    p.beneficiary||"",
      walletId:       p.wallet_id||"",
      currency:       p.currency||"KES",
      notes:          p.notes||"",
    });
    openM("policy");
  };

  const recordPremiumPayment = async () => {
    const amt = parseFloat(fPremiumPayment.amount); if(!amt || !fPremiumPayment.policyId || !fPremiumPayment.wallet) return;
    try {
      const { payment } = await insuranceApi.recordPayment(fPremiumPayment.policyId, {
        wallet_id: fPremiumPayment.wallet, amount_kes: amt,
        payment_date: fPremiumPayment.date, note: fPremiumPayment.note||undefined,
      });
      setPolicies(p => p.map(x => x.id===fPremiumPayment.policyId ? {...x, payments:[payment, ...(x.payments||[])]} : x));
      setWallets(p => p.map(w => w.id===fPremiumPayment.wallet ? {...w, balance:parseFloat(w.balance)-amt} : w));
      if (payment.transaction) {
        const tx = payment.transaction;
        setTxs(p=>[{ ...tx, wallet:tx.wallet_id, category:tx.category_id, amount:parseFloat(tx.amount_kes), date:(tx.tx_date||'').slice(0,10) }, ...p]);
      }
      setFPremiumPayment(blankPremiumPayment); closeM("premiumPayment");
      showToast("Payment recorded");
    } catch(err) { showToast(err?.response?.data?.error||"Failed", C.coral); }
  };

  const deletePremiumPayment = async (policyId, paymentId, amount, walletId) => {
    try {
      await insuranceApi.removePayment(policyId, paymentId);
      setPolicies(p => p.map(x => x.id===policyId ? {...x, payments:(x.payments||[]).filter(pm=>pm.id!==paymentId)} : x));
      if (walletId) setWallets(p => p.map(w => w.id===walletId ? {...w, balance:parseFloat(w.balance)+parseFloat(amount||0)} : w));
      setTxs(p => p.filter(t => t.premium_payment_id !== paymentId));
      showToast("Payment deleted");
    } catch(err) { showToast(err?.response?.data?.error||"Failed to delete payment", C.coral); }
  };

  // ── Refund handlers ──────────────────────────────────────────────────────────
  const openRefundModal = (tx) => {
    setEditRefund(null);
    setFRefund({ refundOf:tx.id, amount:String(tx.amount||parseFloat(tx.amount_kes||0)), wallet:tx.wallet||tx.wallet_id||wallets[0]?.id||"", note:`Refund: ${tx.merchant||tx.note||""}`.trim(), date:todayStr() });
    openM("refund");
  };

  const openEditRefundModal = (tx) => {
    setEditRefund(tx);
    setFRefund({ refundOf:tx.refund_of||"", amount:String(tx.amount||parseFloat(tx.amount_kes||0)), wallet:tx.wallet||tx.wallet_id||"", note:tx.note||"", date:tx.date||tx.tx_date||todayStr() });
    openM("refund");
  };

  const saveRefund = async () => {
    const amt = parseFloat(fRefund.amount); if(!amt||!fRefund.refundOf||!fRefund.wallet) return;
    const amtKES = toKES(amt, walletCur(fRefund.wallet), currencies);
    if (editRefund) {
      try {
        const { transaction: tx } = await txApi.update(editRefund.id, { wallet_id:fRefund.wallet, amount_kes:amtKES, note:fRefund.note||undefined, tx_date:localDateTimeToISO(fRefund.date, nowTimeStr()), refund_of:fRefund.refundOf });
        const norm = { ...tx, wallet:tx.wallet_id, category:tx.category_id, amount:parseFloat(tx.amount_kes), date:(tx.tx_date||'').slice(0,10) };
        setTxs(p=>p.map(t=>t.id===editRefund.id?norm:t));
        const oldAmt=editRefund.amount||parseFloat(editRefund.amount_kes||0), oldWid=editRefund.wallet||editRefund.wallet_id;
        setWallets(p=>p.map(w=>{ let b=parseFloat(w.balance); if(w.id===oldWid) b-=oldAmt; if(w.id===fRefund.wallet) b+=amtKES; return (w.id===oldWid||w.id===fRefund.wallet)?{...w,balance:b}:w; }));
        setEditRefund(null); setFRefund(blankRefund); closeM("refund");
        showToast("Refund updated");
      } catch(err) { showToast(err?.response?.data?.error||"Failed to update refund", C.coral); }
    } else {
      try {
        const { transaction: tx } = await txApi.create({ wallet_id:fRefund.wallet, type:"refund", amount_kes:amtKES, note:fRefund.note||undefined, tx_date:localDateTimeToISO(fRefund.date, nowTimeStr()), refund_of:fRefund.refundOf });
        const norm = { ...tx, wallet:tx.wallet_id, category:tx.category_id, amount:parseFloat(tx.amount_kes), date:(tx.tx_date||'').slice(0,10) };
        setTxs(p=>[norm,...p]);
        setWallets(p=>p.map(w=>w.id===fRefund.wallet?{...w,balance:parseFloat(w.balance)+amtKES}:w));
        setFRefund(blankRefund); closeM("refund");
        showToast("Refund recorded");
      } catch(err) { showToast(err?.response?.data?.error||"Failed to record refund", C.coral); }
    }
  };

  const toggleRecurring = async (id) => {
    try {
      const { recurring: r } = await recurApi.toggle(id);
      setRecurring(p=>p.map(rx=>rx.id===id?normaliseRecurring(r):rx));
    } catch(err) { showToast("Failed", C.coral); }
  };

  // ── Delete handlers ──────────────────────────────────────────────────────────
  const deleteTx = async (id) => {
    try {
      await txApi.remove(id);
      const tx = txs.find(t=>t.id===id);
      if (tx) {
        const isIn = tx.type==="income"||tx.type==="transfer_in"||tx.type==="refund";
        const wid  = tx.wallet||tx.wallet_id;
        const amt  = tx.amount||parseFloat(tx.amount_kes||0);
        setWallets(p=>p.map(w=>w.id===wid?{...w,balance:parseFloat(w.balance)+(isIn?-amt:amt)}:w));
      }
      setTxs(p=>p.filter(t=>t.id!==id));
      showToast("Transaction deleted");
    } catch(err) { showToast("Failed to delete", C.coral); }
  };

  const deleteWallet = async (id) => {
    try {
      await walletsApi.remove(id);
      setWallets(p=>p.filter(w=>w.id!==id));
      showToast("Account deleted");
    } catch(err) {
      const counts = err?.response?.data?.counts;
      if (counts) {
        const parts = [];
        if (counts.transactions)      parts.push(`${counts.transactions} transaction${counts.transactions !== 1 ? "s" : ""}`);
        if (counts.recurring)         parts.push(`${counts.recurring} recurring payment${counts.recurring !== 1 ? "s" : ""}`);
        if (counts.goals)             parts.push(`${counts.goals} goal${counts.goals !== 1 ? "s" : ""}`);
        if (counts.investments)       parts.push(`${counts.investments} investment${counts.investments !== 1 ? "s" : ""}`);
        if (counts.loan_repayments)   parts.push(`${counts.loan_repayments} loan repayment${counts.loan_repayments !== 1 ? "s" : ""}`);
        if (counts.investment_returns) parts.push(`${counts.investment_returns} investment return${counts.investment_returns !== 1 ? "s" : ""}`);
        showToast(`Can't delete — this account has ${parts.join(", ")} linked to it. Remove those first.`, C.coral, 6000);
      } else {
        showToast(err?.response?.data?.error || "Failed to delete", C.coral);
      }
    }
  };

  const deleteGoal = async (id) => {
    try {
      const g = goals.find(g=>g.id===id);
      await goalsApi.remove(id);
      setGoals(p=>p.filter(g=>g.id!==id));
      // Mirrors the backend, which reverses every contribution back to the
      // wallet it actually came from (not a lump sum into g.wallet_id —
      // contributions can each have a different source account).
      if (g?.contributions?.length) {
        setWallets(p=>p.map(w=>{
          let b = parseFloat(w.balance);
          g.contributions.forEach(c=>{
            if (w.id===c.fromWallet) b += c.amount;
            if (w.id===c.toWallet)   b -= c.amount;
          });
          return b !== parseFloat(w.balance) ? {...w, balance:b} : w;
        }));
        const contribIds = new Set(g.contributions.map(c=>c.id));
        setTxs(p=>p.filter(t=>!contribIds.has(t.goal_contribution_id)));
      }
      showToast("Goal deleted");
    } catch(err) { showToast("Failed to delete", C.coral); }
  };

  const deleteInvestment = async (id) => {
    try {
      const inv = investments.find(i=>i.id===id);
      await invsApi.remove(id);
      setInvestments(p=>p.filter(i=>i.id!==id));
      // Mirrors the backend, which reverses every return's wallet credit when the investment is deleted.
      if (inv?.returns?.length) {
        const reverseByWallet = {};
        inv.returns.forEach(r=>{ if(r.wallet_id) reverseByWallet[r.wallet_id]=(reverseByWallet[r.wallet_id]||0)+(r.amount||0); });
        setWallets(p=>p.map(w=>reverseByWallet[w.id]?{...w,balance:parseFloat(w.balance)-reverseByWallet[w.id]}:w));
        const returnIds = new Set(inv.returns.map(r=>r.id));
        setTxs(p=>p.filter(t=>!returnIds.has(t.investment_return_id)));
      }
      showToast("Investment deleted");
    } catch(err) { showToast("Failed to delete", C.coral); }
  };

  const deleteLoan = async (id) => {
    try {
      await loansApi.remove(id);
      setLoans(p=>p.filter(l=>l.id!==id));
      showToast("Loan deleted");
    } catch(err) { showToast("Failed to delete", C.coral); }
  };

  const deleteRecurring = async (id) => {
    try {
      await recurApi.remove(id);
      setRecurring(p=>p.filter(r=>r.id!==id));
      showToast("Recurring deleted");
    } catch(err) { showToast("Failed to delete", C.coral); }
  };

  const deleteCategory = async (id, type) => {
    try {
      await catsApi.remove(id);
      if (type==="expense") setExpCats(p=>p.filter(c=>c.id!==id));
      else setIncCats(p=>p.filter(c=>c.id!==id));
      showToast("Category deleted");
    } catch(err) { showToast(err?.response?.data?.error||"Failed to delete", C.coral); }
  };

  const deleteRepayment = async (loanId, repaymentId, repaymentTotal, walletId) => {
    try {
      await loansApi.removeRepayment(loanId, repaymentId);
      setLoans(p=>p.map(l=>{
        if(l.id!==loanId) return l;
        const reps = l.repayments.filter(r=>r.id!==repaymentId);
        const paidPrincipal = reps.reduce((s,r)=>s+(r.principal||0),0);
        return {...l, repayments:reps, remaining:Math.max(0,l.principal-paidPrincipal)};
      }));
      if (walletId) setWallets(p=>p.map(w=>w.id===walletId?{...w,balance:parseFloat(w.balance)+parseFloat(repaymentTotal||0)}:w));
      showToast("Repayment deleted");
    } catch(err) { showToast(err?.response?.data?.error||"Failed to delete repayment", C.coral); }
  };

  const deleteReturn = async (investmentId, returnId, returnAmount, walletId) => {
    try {
      await invsApi.removeReturn(investmentId, returnId);
      setInvestments(p=>p.map(i=>{
        if(i.id!==investmentId) return i;
        return {...i, returns: i.returns.filter(r=>r.id!==returnId)};
      }));
      if (walletId) setWallets(p=>p.map(w=>w.id===walletId?{...w,balance:parseFloat(w.balance)-parseFloat(returnAmount||0)}:w));
      setTxs(p=>p.filter(t=>t.investment_return_id!==returnId));
      showToast("Return deleted");
    } catch(err) { showToast(err?.response?.data?.error||"Failed to delete return", C.coral); }
  };

  const deactivateAccount = async () => {
    try {
      await authApi.deactivate();
      logout();
      showToast("Account deactivated");
    } catch(err) { showToast("Failed to deactivate", C.coral); }
  };

  // ── Export CSV (download from backend)
  // ── Export: transactions + wallets + goals as separate CSV downloads ───────
  const exportTransactions = async () => {
    try {
      const res = await txApi.exportCSV();
      downloadBlob(new Blob([res.data]), `pesa-yangu-transactions-${todayStr()}.csv`);
      showToast("Transactions exported");
    } catch { showToast("Export failed", C.coral); }
  };

  const exportAll = () => {
    // Transactions
    const txHeaders = ["date","time","type","category","amount_kes","merchant","note","wallet","currency"];
    const txRows = txs.map(t => {
      const cat = t.type==="expense"?expCats.find(c=>c.id===(t.category||t.category_id)):incCats.find(c=>c.id===(t.category||t.category_id));
      const w   = wallets.find(w=>w.id===(t.wallet||t.wallet_id));
      const dt  = t.tx_date ? new Date(t.tx_date) : null;
      const timeStr = dt ? String(dt.getHours()).padStart(2,"0")+":"+String(dt.getMinutes()).padStart(2,"0") : "00:00";
      return { date:(t.date||(t.tx_date||"").slice(0,10)), time:timeStr, type:t.type, category:cat?.name||"", amount_kes:t.amount||parseFloat(t.amount_kes||0), merchant:t.merchant||"", note:t.note||"", wallet:w?.name||"", currency:w?.currency||"KES" };
    });
    downloadBlob(new Blob([toCSV(txHeaders, txRows)]), `pesa-yangu-transactions-${todayStr()}.csv`);

    // Wallets
    const walHeaders = ["name","account_type","currency","opening_balance","balance"];
    const walRows = wallets.map(w => ({ name:w.name, account_type:w.account_type||w.accountType||"", currency:w.currency||"KES", opening_balance:parseFloat(w.opening_balance||0), balance:parseFloat(w.balance||0) }));
    downloadBlob(new Blob([toCSV(walHeaders, walRows)]), `pesa-yangu-wallets-${todayStr()}.csv`);

    // Goals
    const goalHeaders = ["name","target_kes","saved_kes","deadline","wallet"];
    const goalRows = goals.map(g => {
      const w = wallets.find(w=>w.id===(g.wallet||g.wallet_id));
      return { name:g.name, target_kes:g.target_kes||g.target, saved_kes:g.saved_kes||g.saved, deadline:g.deadline||"", wallet:w?.name||"" };
    });
    downloadBlob(new Blob([toCSV(goalHeaders, goalRows)]), `pesa-yangu-goals-${todayStr()}.csv`);

    showToast("3 CSV files downloaded");
  };

  // ── Import CSV
  // ── Import: client-side parse → preview → confirm ───────────────────────────
  const resetImport = () => {
    setImportRows([]); setImportErrors([]); setImportStep("upload");
    setImportParsedRows([]); setImportNewWallets([]); setImportNewCats([]);
  };

  const handleImportFile = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const { rows } = parseCSV(e.target.result);
      setImportParsedRows(rows);

      // Detect wallet names in CSV that don't exist in the app
      const knownWalletNames = new Set(wallets.map(w => w.name.toLowerCase()));
      const newWalletNames = new Set();
      rows.forEach(r => {
        if (r.wallet     && !knownWalletNames.has((r.wallet     ||"").toLowerCase())) newWalletNames.add(r.wallet);
        if (r.from_wallet && !knownWalletNames.has((r.from_wallet||"").toLowerCase())) newWalletNames.add(r.from_wallet);
        if (r.to_wallet   && !knownWalletNames.has((r.to_wallet  ||"").toLowerCase())) newWalletNames.add(r.to_wallet);
      });

      // Detect category names in CSV that don't exist
      const knownCatKeys = new Set([
        ...expCats.map(c => c.name.toLowerCase()+":expense"),
        ...incCats.map(c => c.name.toLowerCase()+":income"),
      ]);
      const newCatMap = new Map(); // "name:type" → {name, type}
      rows.forEach(r => {
        if (!r.category) return;
        const t = (r.type||"expense").toLowerCase();
        const catType = t === "income" ? "income" : "expense";
        const key = r.category.toLowerCase()+":"+catType;
        if (!knownCatKeys.has(key)) newCatMap.set(key, { name: r.category, type: catType });
      });

      const newWallets = [...newWalletNames].map(name => ({ name, type: "current", selected: true, openingBalance: "" }));
      const newCats    = [...newCatMap.values()].map(c => ({ ...c, selected: true }));

      if (newWallets.length || newCats.length) {
        setImportNewWallets(newWallets);
        setImportNewCats(newCats);
        setImportStep("new-items");
      } else {
        const validated = validateImportRows(rows, wallets, expCats, incCats);
        setImportRows(validated);
        setImportErrors(validated.filter(r=>!r._valid).map(r=>`Row ${r._row}: ${r._errors.join(", ")}`));
        setImportStep("preview");
      }
    };
    reader.readAsText(file);
  };

  const confirmNewItems = async () => {
    setImportBusy(true);
    try {
      // Create selected wallets
      for (const w of importNewWallets.filter(w => w.selected)) {
        const bal = parseFloat(w.openingBalance) || 0;
        await walletsApi.create({ name: w.name, account_type: w.type, currency: "KES", balance: bal, opening_balance: bal, color: "#00D4AA", icon: "🏦" });
      }
      // Create selected categories
      for (const c of importNewCats.filter(c => c.selected)) {
        await catsApi.create({ name: c.name, type: c.type, icon: c.type==="income"?"💰":"🏷️", color:"#4A90E2" });
      }
      // Reload fresh data for re-validation
      const [{ wallets: freshW }, { categories: freshCatRaw }] = await Promise.all([
        walletsApi.list(), catsApi.list(),
      ]);
      const fw = freshW || [];
      const freshExp = (freshCatRaw||[]).filter(c=>c.type==="expense").map(normaliseCategory);
      const freshInc = (freshCatRaw||[]).filter(c=>c.type==="income").map(normaliseCategory);
      setWallets(fw); setExpCats(freshExp); setIncCats(freshInc);
      // Re-validate all rows with fresh data
      const validated = validateImportRows(importParsedRows, fw, freshExp, freshInc);
      setImportRows(validated);
      setImportErrors(validated.filter(r=>!r._valid).map(r=>`Row ${r._row}: ${r._errors.join(", ")}`));
      setImportStep("preview");
    } catch(err) {
      showToast("Failed to create items: "+(err?.response?.data?.error||err.message), C.coral);
    } finally { setImportBusy(false); }
  };

  const confirmImport = async () => {
    const valid = importRows.filter(r => r._valid);
    if (!valid.length) return;
    setImportBusy(true);
    try {
      // Build a CSV from only valid rows and send to backend
      const headers = ["date","time","type","category","amount_kes","merchant","note","wallet","from_wallet","to_wallet"];
      const validRows = valid.map(r => ({
        date:        r._date,
        time:        r._time || "00:00",
        type:        r._type === "transfer" ? "transfer_out" : r._type,
        category:    r.category || "",
        amount_kes:  r._amount,
        merchant:    r.merchant || "",
        note:        r.note || "",
        wallet:      r.wallet || (r._type === "transfer" ? r.from_wallet : ""),
        from_wallet: r.from_wallet || "",
        to_wallet:   r.to_wallet || "",
      }));
      const csvBlob = new Blob([toCSV(headers, validRows)]);
      const file = new File([csvBlob], "import.csv", { type: "text/csv" });
      const { imported } = await txApi.importCSV(file);
      // Reload transactions
      const { transactions: fresh } = await txApi.list({ limit:500 });
      setTxs((fresh||[]).map(tx=>({ ...tx, wallet:tx.wallet_id, category:tx.category_id, amount:parseFloat(tx.amount_kes), date:(tx.tx_date||'').slice(0,10) })));
      // Reload wallet balances
      const { wallets: freshW } = await walletsApi.list();
      setWallets(freshW || []);
      closeM("importExport");
      setImportRows([]); setImportErrors([]); setImportStep("upload");
      showToast(`Imported ${imported} transactions`);
    } catch(err) { showToast(err?.response?.data?.error||"Import failed", C.coral); }
    finally { setImportBusy(false); }
  };

  // ── Reconcile
  const handleRecoFile = async (file) => {
    if(!recoWallet) { showToast("Select an account first", C.coral); return; }
    setRecoFile(file); setRecoBusy(true);
    try {
      const { rows } = await reconcileApi.parse(recoWallet, file);
      setRecoRows(rows||[]);
    } catch(err) { showToast(err?.response?.data?.error||"Parse failed", C.coral); }
    finally { setRecoBusy(false); }
  };

  const importRecoRow = async (idx) => {
    const row = recoRows[idx]; if(!row||row.status==="matched") return;
    try {
      await reconcileApi.confirm([row], recoWallet);
      setRecoRows(p=>p.map((r,i)=>i===idx?{...r,status:"matched"}:r));
      if (row.amount) setWallets(p=>p.map(w=>w.id===recoWallet?{...w,balance:parseFloat(w.balance)+row.amount}:w));
      showToast("Row imported");
    } catch(err) { showToast("Failed", C.coral); }
  };

  const importAllReco = async () => {
    const unmatched = recoRows.map((r,i)=>({...r,idx:i})).filter(r=>r.status==="unmatched");
    if(!unmatched.length) return;
    try {
      await reconcileApi.confirm(unmatched, recoWallet);
      setRecoRows(p=>p.map(r=>({...r,status:"matched"})));
      const totalDelta = unmatched.reduce((s,r)=>s+(r.amount||0),0);
      if (totalDelta) setWallets(p=>p.map(w=>w.id===recoWallet?{...w,balance:parseFloat(w.balance)+totalDelta}:w));
      showToast(`Imported ${unmatched.length} rows`);
    } catch(err) { showToast("Import failed", C.coral); }
  };

  // ── AI Advice
  const getAI = async () => {
    setAiLoading(true); setAiText(""); openM("ai");
    const ctx = {
      netWorth:disp(netWorth), totalBalance:disp(totalBalance),
      income:disp(totalIncome), expenses:disp(totalExpense),
      savingsRate:savingsRate.toFixed(1)+"%", score,
      overBudget:overBudget.map(c=>c.name),
      watched:watched.map(c=>({name:c.name,spent:disp(spendByCat[c.id]||0),budget:disp(c.budget)})),
      goals:goals.map(g=>({name:g.name,pct:Math.round((g.saved/g.target)*100)+"%"})),
      loans:loans.map(l=>({name:l.name,remaining:disp(l.remaining),rate:l.rate+"%"})),
      baseCurrency,
    };
    try {
      const { advice } = await aiApi.advice(ctx);
      setAiText(advice || "No response.");
    } catch(err) {
      setAiText(err?.response?.data?.error || "Unable to connect to AI advisor.");
    }
    setAiLoading(false);
  };

  // ── Share
  const shareApp = (via) => {
    const msg = encodeURIComponent("Hey! I'm using Pesa Yangu to manage my finances — budgets, goals, investments and loans. Try it: https://pesayangu.africa");
    if(via==="whatsapp") window.open(`https://wa.me/?text=${msg}`,"_blank");
    else if(via==="copy") { navigator.clipboard.writeText(decodeURIComponent(msg)); showToast("Link copied!"); }
    else if(via==="email") window.open(`mailto:?subject=Try Pesa Yangu&body=${msg}`,"_blank");
  };

  // ── Upgrade (demo: toggle plan locally until billing backend is live)
  const handleUpgrade = async () => {
    try {
      // In production this opens Stripe/MPesa checkout
      // For now just update local user state
      updateUser({ plan:"pro" });
      closeM("billing");
      showToast("Welcome to Pesa Yangu Pro! ✦", C.gold);
    } catch { showToast("Upgrade failed", C.coral); }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER GATES
  // ─────────────────────────────────────────────────────────────────────────
  // Password reset link must always show reset form even if user has an active session
  if (new URLSearchParams(window.location.search).get('reset'))
    return <AuthPage onLogin={login} onRegister={register}/>;

  if (authLoading) return <ThemeCtx.Provider value={C}><LoadingScreen message="Starting Pesa Yangu…"/></ThemeCtx.Provider>;
  if (!user)       return <AuthPage onLogin={login} onRegister={register}/>;
  // PIN lock — gates everyone (including admins) below this point. Wrapped in
  // ThemeCtx.Provider because Field/Btn read the theme via useC()/context,
  // same lesson as the admin-dashboard crash fixed earlier today.
  if (user.has_pin && !pinUnlocked) return (
    <ThemeCtx.Provider value={C}>
      <div style={{minHeight:"100vh",background:C.navy,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"'Inter',sans-serif",padding:20}}>
        <div style={{width:46,height:46,background:`linear-gradient(135deg,${C.teal},${C.blue})`,borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,marginBottom:16}}>🔒</div>
        <div style={{fontFamily:"'DM Serif Display',serif",fontSize:22,color:C.textPrimary,marginBottom:4}}>Enter your PIN</div>
        <div style={{fontSize:12,color:C.textMuted,marginBottom:20}}>Pesa Yangu is locked on this device</div>
        <div style={{width:"100%",maxWidth:280}}>
          <input type="password" inputMode="numeric" autoFocus value={pinEntry}
            onChange={e=>{setPinEntry(e.target.value.replace(/\D/g,"").slice(0,6));setPinError("");}}
            onKeyDown={e=>e.key==="Enter"&&verifyPin()}
            placeholder="••••"
            style={{width:"100%",textAlign:"center",letterSpacing:"0.3em",fontSize:20,background:C.navyLight,border:`1px solid ${pinError?C.coral:C.navyLight}`,borderRadius:12,padding:"14px",color:C.textPrimary,outline:"none",boxSizing:"border-box"}}/>
          {pinError && <div style={{color:C.coral,fontSize:12,marginTop:8,textAlign:"center"}}>{pinError}</div>}
          <Btn onClick={verifyPin} disabled={pinVerifying||!pinEntry} style={{width:"100%",marginTop:14,padding:13,fontSize:14}}>{pinVerifying?"Checking…":"Unlock"}</Btn>
          <button onClick={logout} style={{background:"none",border:"none",color:C.textMuted,fontSize:12,marginTop:16,cursor:"pointer",width:"100%"}}>Sign out instead</button>
        </div>
      </div>
    </ThemeCtx.Provider>
  );
  // LoadingScreen (used as the Suspense fallback below) reads the theme via
  // useC()/ThemeCtx, not a prop — this branch must be wrapped in the
  // Provider itself (matching the authLoading/dataLoading branches above),
  // otherwise the fallback crashes on C.navy being read off a null context
  // while the AdminDashboard.jsx chunk is still downloading.
  if (user.role === "admin") return <ThemeCtx.Provider value={C}><Suspense fallback={<LoadingScreen message="Loading admin dashboard…"/>}><AdminApp user={user} logout={logout} C={C} theme={theme} toggleTheme={toggleTheme}/></Suspense></ThemeCtx.Provider>;
  if (dataLoading) return <ThemeCtx.Provider value={C}><LoadingScreen message="Loading your data…"/></ThemeCtx.Provider>;
  if (dataError)   return (
    <ThemeCtx.Provider value={C}>
    <div style={{minHeight:"100vh",background:C.navy,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Inter',sans-serif"}}>
      <div style={{textAlign:"center",color:C.coral}}>
        <div style={{fontSize:36,marginBottom:12}}>⚠</div>
        <div style={{fontWeight:700,marginBottom:8}}>{dataError}</div>
        <Btn onClick={()=>window.location.reload()}>Retry</Btn>
      </div>
    </div>
    </ThemeCtx.Provider>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // NAV
  // ─────────────────────────────────────────────────────────────────────────
  const NAV = [
    {id:"dashboard",    label:"Dashboard",  icon:"◈"},
    {id:"accounts",     label:"Accounts",   icon:"🏦"},
    {id:"transactions", label:"Records",    icon:"📋"},
    {id:"budgets",      label:"Budgets",    icon:"🎯"},
    {id:"goals",        label:"Goals",      icon:"🏆"},
    {id:"recurring",    label:"Recurring",  icon:"🔁"},
    {id:"investments",  label:"Invest",     icon:"📈"},
    {id:"loans",        label:"Loans",      icon:"🏦"},
    {id:"insurance",    label:"Insurance",  icon:"🛡️"},
    {id:"reconcile",    label:"Reconcile",  icon:"✅"},
    {id:"settings",     label:"Settings",   icon:"⚙️"},
    ...(user?.role==="admin" ? [{id:"admin", label:"Admin", icon:"🛡️"}] : []),
  ];

  const ACCT_TYPE = {current:"Current",savings:"Savings",investment:"Investment",cash:"Cash",digital:"Mobile Money"};

  // ─────────────────────────────────────────────────────────────────────────
  // FULL RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <ThemeCtx.Provider value={C}>
    <div style={{minHeight:"100vh",background:C.navy,color:C.textPrimary,fontFamily:"'Inter',-apple-system,sans-serif",display:"flex",flexDirection:"column",overflowX:"hidden",transition:"background 0.3s,color 0.3s"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=DM+Serif+Display&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        *, *::before, *::after { transition: background-color 0.25s, border-color 0.25s, color 0.25s; }
        ::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:${C.navyLight};border-radius:4px}
        select option{background:${C.navyMid};color:${C.textPrimary}}
        input::placeholder{color:${C.textFaint}}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes slideIn{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}

        body, html {
          overflow-x: hidden;
          max-width: 100vw;
          background: ${C.navy};
        }

        .interactive-card {
          position: relative;
          transition: transform 0.25s cubic-bezier(0.2,0.8,0.2,1), box-shadow 0.25s, border-color 0.25s, background 0.25s !important;
        }
        .interactive-card:hover {
          transform: translateY(-4px) scale(1.01);
          border-color: ${C.teal}88 !important;
          box-shadow: 0 12px 30px ${C.shadow}, 0 4px 12px ${C.shadow};
          background: ${C.navyLight} !important;
        }
        .interactive-card:active {
          transform: translateY(-1px) scale(0.985);
          box-shadow: 0 4px 10px ${C.shadow};
          border-color: ${C.teal}bb !important;
          background: ${C.navyLight} !important;
        }

        /* Grid and Layout Responsiveness */
        .grid-2, .grid-3, .grid-4, .grid-5, .grid-2-1 {
          display: grid;
        }
        .grid-2 { grid-template-columns: 1fr 1fr; gap: 12px; }
        .grid-3 { grid-template-columns: repeat(3, 1fr); gap: 10px; }
        .grid-4 { grid-template-columns: repeat(4, 1fr); gap: 10px; }
        .grid-5 { grid-template-columns: repeat(5, 1fr); gap: 10px; }
        .grid-2-1 { grid-template-columns: 2fr 1fr; gap: 14px; }

        .reco-grid-row {
          display: grid;
          grid-template-columns: 100px 1fr 120px 110px;
          gap: 10px;
          padding: 10px 18px;
        }

        @media (max-width: 640px) {
          .grid-2, .grid-3, .grid-4, .grid-5, .grid-2-1 {
            grid-template-columns: 1fr !important;
            gap: 12px !important;
          }
          .desktop-nav {
            display: none !important;
          }
          .mobile-bottom-nav {
            display: flex !important;
          }
          .desktop-only-btn {
            display: none !important;
          }
          .page-container {
            padding: 12px 12px 80px 12px !important;
          }
          .modal-container {
            padding: 20px !important;
            border-radius: 16px !important;
            max-height: 95vh !important;
          }
          .app-btn {
            padding: 12px 18px !important;
            font-size: 14px !important;
          }
          .app-btn-small {
            padding: 9px 14px !important;
            font-size: 12px !important;
          }

          .reco-grid-row {
            display: grid !important;
            grid-template-columns: 1fr auto !important;
            gap: 4px 8px !important;
            padding: 12px 14px !important;
          }
          .reco-header-row {
            display: none !important;
          }
          .reco-date {
            grid-column: 1;
            font-size: 10px !important;
          }
          .reco-desc {
            grid-column: 1;
            font-size: 13px !important;
          }
          .reco-amt {
            grid-column: 2;
            grid-row: 1;
            text-align: right !important;
            font-size: 13px !important;
          }
          .reco-status {
            grid-column: 2;
            grid-row: 2;
            justify-content: flex-end;
          }
        }
      `}</style>

      {/* Toast */}
      {toast&&<div style={{position:"fixed",bottom:20,left:"50%",transform:"translateX(-50%)",background:toast.color,color:toast.color===C.coral?C.textPrimary:C.navy,padding:"10px 20px",borderRadius:12,fontWeight:700,fontSize:13,zIndex:2000,animation:"slideIn 0.3s ease",whiteSpace:"nowrap",boxShadow:"0 4px 20px #0008"}}>{toast.msg}</div>}

      <ChatWidget user={user} C={C} showToast={showToast}/>

      {/* Header */}
      <div style={{background:C.navyMid,borderBottom:`1px solid ${C.navyLight}`,padding:"11px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:100,gap:8,flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
          <div onClick={()=>setTab(tab==="settings"?"dashboard":"settings")} style={{width:30,height:30,background:`linear-gradient(135deg,${C.teal},${C.blue})`,borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:800,cursor:"pointer"}}>◈</div>
          <span style={{fontWeight:800,fontSize:16,letterSpacing:"-0.02em"}}>Pesa Yangu</span>
        </div>
        <select value={baseCurrency} onChange={e=>setBase(e.target.value)} style={{background:C.navyLight,border:"none",borderRadius:8,color:C.textPrimary,padding:"5px 10px",fontSize:12,cursor:"pointer",outline:"none"}}>
          {currencies.map(c=><option key={c.code} value={c.code}>{c.code} {c.symbol}</option>)}
        </select>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"flex-end",alignItems:"center"}}>
          <Btn onClick={()=>{setFXfer({...blankXfer,from:wallets[0]?.id||"",to:wallets[1]?.id||""});openM("xfer");}} outline color={C.blue} small className="desktop-only-btn">⇄ Transfer</Btn>
          <Btn onClick={()=>openM("share")} outline color={C.purple} small className="desktop-only-btn">📤 Share</Btn>
          <Btn onClick={()=>openM("importExport")} outline color={C.textMuted} small className="desktop-only-btn">⬆⬇ Data</Btn>
          <Btn onClick={getAI} outline color={C.gold} small className="desktop-only-btn">✦ AI</Btn>
          <button onClick={toggleTheme} title={theme==="dark"?"Switch to light mode":"Switch to dark mode"} style={{background:C.navyLight,border:`1px solid ${C.navyLight}`,borderRadius:8,color:C.textMuted,padding:"6px 10px",cursor:"pointer",fontSize:15,lineHeight:1,transition:"background 0.2s,color 0.2s"}} onMouseEnter={e=>{e.currentTarget.style.color=C.teal;}} onMouseLeave={e=>{e.currentTarget.style.color=C.textMuted;}}>{theme==="dark"?"☀️":"🌙"}</button>
          <button onClick={logout} style={{background:"none",border:`1px solid ${C.coral}55`,borderRadius:8,color:C.coral,padding:"6px 12px",cursor:"pointer",fontSize:12,fontWeight:600,lineHeight:1,transition:"background 0.2s,border-color 0.2s"}} onMouseEnter={e=>{e.currentTarget.style.background=C.coral+"22";e.currentTarget.style.borderColor=C.coral;}} onMouseLeave={e=>{e.currentTarget.style.background="none";e.currentTarget.style.borderColor=C.coral+"55";}}>Sign Out</button>
        </div>
      </div>

      {/* Nav tabs */}
      <div className="desktop-nav" style={{background:C.navyMid,borderBottom:`1px solid ${C.navyLight}`,display:"flex",overflowX:"auto",padding:"0 10px"}}>
        {NAV.map(n=>(
          <button key={n.id} onClick={()=>setTab(n.id)} style={{background:"none",border:"none",color:tab===n.id?C.teal:C.textMuted,padding:"10px 13px",cursor:"pointer",fontWeight:tab===n.id?700:500,borderBottom:tab===n.id?`2px solid ${C.teal}`:"2px solid transparent",fontSize:12,whiteSpace:"nowrap",transition:"all 0.2s"}}>
            {n.icon} {n.label}
          </button>
        ))}
      </div>

      {/* Page */}
      <div className="page-container" style={{flex:1,padding:"18px",maxWidth:1000,margin:"0 auto",width:"100%",animation:"fadeUp 0.25s ease"}}>

        {/* DASHBOARD  */}
        {tab==="dashboard"&&(
          <div style={{display:"flex",flexDirection:"column",gap:16}}>

            {/* ── Install App Banner (periodic, permanent opt-out) ── */}
            {showInstallBanner&&(
              <div style={{background:"linear-gradient(135deg,#0D2137,#0A2744)",border:`1px solid ${C.teal}44`,borderRadius:16,padding:"16px 18px",position:"relative",overflow:"hidden"}}>
                <div style={{position:"absolute",right:-20,top:-20,fontSize:80,opacity:0.07,pointerEvents:"none"}}>📱</div>
                <div style={{display:"flex",alignItems:"center",gap:14}}>
                  <div style={{width:46,height:46,background:`linear-gradient(135deg,${C.teal},${C.blue})`,borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>📲</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:700,fontSize:14,color:C.textPrimary,marginBottom:3}}>Get the Pesa Yangu App</div>
                    <div style={{fontSize:12,color:C.textMuted,lineHeight:1.4}}>Install on your phone for faster access, offline support &amp; daily reminders — no app store needed.</div>
                  </div>
                  <button onClick={triggerInstall} style={{background:C.teal,border:"none",borderRadius:10,color:C.navy,fontWeight:700,fontSize:12,padding:"9px 16px",cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>Install App</button>
                </div>
                <div style={{display:"flex",justifyContent:"flex-end",gap:16,marginTop:12,paddingTop:10,borderTop:`1px solid ${C.teal}22`}}>
                  <button onClick={snoozeInstallBanner} style={{background:"none",border:"none",color:C.textMuted,fontSize:12,cursor:"pointer",padding:"2px 0"}}>Not now</button>
                  <button onClick={stopInstallBanner} style={{background:"none",border:"none",color:C.coral+"aa",fontSize:12,cursor:"pointer",padding:"2px 0"}}>Stop showing this</button>
                </div>
              </div>
            )}

            <div className="grid-2-1">
              <Card>
                <div style={{display:"flex",alignItems:"center",gap:18}}>
                  <HealthRing score={score}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{color:C.textMuted,fontSize:10,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>Financial Health — {user.full_name}</div>
                    <div style={{fontFamily:"'DM Serif Display',serif",fontSize:24,color:score>=75?C.teal:score>=50?C.gold:C.coral,lineHeight:1.1,marginBottom:6}}>
                      {score>=75?"Looking Good":score>=50?"Room to Improve":"Needs Attention"}
                    </div>
                    <div style={{color:C.textMuted,fontSize:12}}>Savings rate <strong style={{color:C.teal}}>{savingsRate.toFixed(0)}%</strong> · {overBudget.length} budget{overBudget.length!==1?"s":""} over{activeGoals.length>0&&<> · Goals <strong style={{color:C.teal}}>{goalsFactor.toFixed(0)}%</strong></>}</div>
                    {overBudget.length>0&&<div style={{display:"flex",gap:5,flexWrap:"wrap",marginTop:8}}>{overBudget.map(a=><Badge key={a.id} color={C.coral}>⚠ {a.name}</Badge>)}</div>}
                  </div>
                </div>
              </Card>
              <Card onClick={() => setTab("accounts")}>
                <div style={{color:C.textMuted,fontSize:10,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Net Worth</div>
                <div style={{fontFamily:"'DM Serif Display',serif",fontSize:26,color:C.textPrimary}}>{disp(netWorth)}</div>
                <div style={{color:C.textMuted,fontSize:11,marginTop:5,marginBottom:8}}>{baseCurrency} · Assets − Liabilities</div>
                <Sparkline values={[netWorth*0.88,netWorth*0.91,netWorth*0.89,netWorth*0.94,netWorth*0.97,netWorth]} color={C.teal} width={140} height={30}/>
              </Card>
            </div>

            <div className="grid-5">
              <Card onClick={() => setTab("accounts")}><Chip label="Total Balance" value={disp(totalBalance)} color={C.textPrimary} sub={`${wallets.length} accounts`}/></Card>
              <Card onClick={() => setTab("transactions")}><Chip label="Income" value={disp(totalIncome)} color={C.teal} sub="This month"/></Card>
              <Card onClick={() => setTab("transactions")}><Chip label="Expenses" value={disp(totalExpense)} color={totalExpense>totalIncome*0.8?C.coral:C.textPrimary} sub={`${totalIncome>0?((totalExpense/totalIncome)*100).toFixed(0):0}% of income`}/></Card>
              <Card onClick={() => setTab("investments")}><Chip label="Investments" value={disp(portfolioValue)} color={C.teal} sub={`${investments.length} asset${investments.length!==1?"s":""}`}/></Card>
              <Card onClick={() => setTab("loans")}><Chip label="Total Debt" value={disp(totalDebt)} color={C.coral} sub={`${loans.length} loan${loans.length!==1?"s":""}`}/></Card>
            </div>

            {watched.length>0&&(
              <Card onClick={() => setTab("budgets")} style={{borderLeft:`3px solid ${C.gold}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div style={{fontWeight:700,fontSize:13}}>🔔 Watching Closely</div>
                  <button onClick={(e)=>{e.stopPropagation();setTab("budgets");}} style={{background:"none",border:"none",color:C.teal,cursor:"pointer",fontSize:11}}>Manage →</button>
                </div>
                {watched.map(c=>{
                  const spent=spendByCat[c.id]||0,over=c.budget>0&&spent>c.budget;
                  return<div key={c.id} style={{marginBottom:10}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                      <span style={{color:C.textMuted,fontSize:12}}>{c.icon} {c.name}</span>
                      <span style={{fontSize:12,fontWeight:600,color:over?C.coral:C.textPrimary}}>{disp(spent)}{c.budget>0?` / ${disp(c.budget)}`:""}{over&&<span style={{color:C.coral}}> ⚠</span>}</span>
                    </div>
                    {c.budget>0&&<Bar value={spent} max={c.budget} color={c.color}/>}
                  </div>;
                })}
              </Card>
            )}

            <div className="grid-2" style={{ gap: 14 }}>
              <Card onClick={() => setTab("budgets")}>
                <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>Spending by Category</div>
                {expCats.filter(c=>spendByCat[c.id]>0).sort((a,b)=>(spendByCat[b.id]||0)-(spendByCat[a.id]||0)).slice(0,6).map(c=>(
                  <div key={c.id} style={{marginBottom:9}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                      <span style={{color:C.textMuted,fontSize:11}}>{c.icon} {c.name}</span>
                      <span style={{fontSize:11,fontWeight:600,color:(spendByCat[c.id]||0)>c.budget&&c.budget>0?C.coral:C.textPrimary}}>{disp(spendByCat[c.id]||0)}</span>
                    </div>
                    <Bar value={spendByCat[c.id]||0} max={c.budget||spendByCat[c.id]||1} color={c.color}/>
                  </div>
                ))}
              </Card>
              <Card onClick={() => setTab("transactions")}>
                <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>Monthly Expenses</div>
                <MiniBar height={100} data={last6MonthsExpenses}/>
                <div style={{display:"flex",gap:10,marginTop:10}}>
                  <Chip label="Avg/Month" value={disp(avgMonthlyExpense)} color={C.textMuted}/>
                  <Chip label="This Month" value={disp(totalExpense)} color={avgMonthlyExpense>0&&totalExpense>avgMonthlyExpense*1.2?C.coral:C.teal}/>
                </div>
              </Card>
            </div>

            {goals.length>0&&(
              <Card onClick={() => setTab("goals")}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div style={{fontWeight:700,fontSize:13}}>Savings Goals</div>
                  <button onClick={(e)=>{e.stopPropagation();setTab("goals");}} style={{background:"none",border:"none",color:C.teal,cursor:"pointer",fontSize:11}}>View all →</button>
                </div>
                <div className="grid-4">
                  {goals.map(g=>{const pct=Math.min((g.saved/g.target)*100,100);return(
                    <div key={g.id} style={{background:C.navyLight,borderRadius:12,padding:12}}>
                      <div style={{fontSize:20,marginBottom:5}}>{g.icon}</div>
                      <div style={{fontWeight:600,fontSize:11,marginBottom:5,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{g.name}</div>
                      <Bar value={g.saved} max={g.target} color={g.color}/>
                      <div style={{color:g.color,fontWeight:700,fontSize:12,marginTop:5}}>{pct.toFixed(0)}%</div>
                      <div style={{color:C.textFaint,fontSize:10}}>{disp(g.saved)}</div>
                    </div>
                  );})}
                </div>
              </Card>
            )}

            <Card onClick={() => setTab("transactions")}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{fontWeight:700,fontSize:13}}>Recent Transactions</div>
                <button onClick={(e)=>{e.stopPropagation();setTab("transactions");}} style={{background:"none",border:"none",color:C.teal,cursor:"pointer",fontSize:11}}>View all →</button>
              </div>
              {txs.slice(0,8).map((t,i)=>{
                const isT=t.type==="transfer_out"||t.type==="transfer_in";
                const isRefund=t.type==="refund";
                const catId=t.category||t.category_id;
                const cat=isT?{icon:"⇄",name:"Transfer",color:C.blue}:isRefund?{icon:"↩️",name:"Refund",color:"#9B59B6"}:t.type==="expense"?expCats.find(c=>c.id===catId):incCats.find(c=>c.id===catId);
                const w=wallets.find(w=>w.id===(t.wallet||t.wallet_id));
                const isIn=t.type==="income"||t.type==="transfer_in"||isRefund;
                return<div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:i<7?`1px solid ${C.navyLight}`:"none"}}>
                  <div style={{width:34,height:34,borderRadius:9,background:(cat?.color||C.blue)+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>{cat?.icon||"💸"}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.merchant||t.note||"Transaction"}</div>
                    <div style={{fontSize:10,color:C.textMuted}}>{cat?.name||"—"} · {w?.name||"—"} · {fmtDate(t.date||t.tx_date)}{txTime(t)?" · "+txTime(t):""}</div>
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontSize:12,fontWeight:700,color:isIn?C.teal:C.textPrimary}}>{isIn?"+":"−"}{disp(t.amount||parseFloat(t.amount_kes||0))}</div>
                    {isRefund&&<Badge color="#9B59B6">↩ refund</Badge>}
                  </div>
                </div>;
              })}
              {txs.length===0&&<div style={{textAlign:"center",color:C.textFaint,padding:"20px 0",fontSize:13}}>No transactions yet. Click + Add to get started.</div>}
            </Card>
          </div>
        )}

        {/* ACCOUNTS  */}
        {tab==="accounts"&&(
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",flexWrap:"wrap",gap:10}}>
              <div>
                <div style={{fontFamily:"'DM Serif Display',serif",fontSize:24}}>Accounts</div>
                <div style={{color:C.textMuted,fontSize:12}}>Total: {disp(totalBalance)}</div>
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <Btn onClick={()=>{setEditTx(null);setFTx({...blankTx,wallet:wallets[0]?.id||"",category:expCats[0]?.id||""});openM("tx");}} small>+ Add Transaction</Btn>
                <Btn onClick={()=>{setFXfer({...blankXfer,from:wallets[0]?.id||"",to:wallets[1]?.id||""});openM("xfer");}} outline color={C.blue} small>⇄ Transfer</Btn>
                <Btn onClick={()=>{setFWal(blankWal);openM("wallet");}} small>+ Add Account</Btn>
              </div>
            </div>

            {/* Search + View Toggle */}
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <div style={{flex:1,position:"relative"}}>
                <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:C.textMuted,fontSize:13}}>🔍</span>
                <input value={walletSearch} onChange={e=>setWalletSearch(e.target.value)} placeholder="Search accounts…"
                  style={{width:"100%",background:C.navyLight,border:`1px solid ${C.navyLight}`,borderRadius:10,padding:"9px 12px 9px 34px",color:C.textPrimary,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
              </div>
              <div style={{display:"flex",background:C.navyLight,borderRadius:10,padding:3,gap:2}}>
                <button onClick={()=>setWalletView("grid")} style={{background:walletView==="grid"?C.teal:"none",border:"none",borderRadius:7,padding:"6px 10px",cursor:"pointer",fontSize:14,color:walletView==="grid"?"#fff":C.textMuted}}>⊞</button>
                <button onClick={()=>setWalletView("list")} style={{background:walletView==="list"?C.teal:"none",border:"none",borderRadius:7,padding:"6px 10px",cursor:"pointer",fontSize:14,color:walletView==="list"?"#fff":C.textMuted}}>☰</button>
              </div>
            </div>

            {/* Wallet cards — grid or list */}
            {(()=>{
              const visibleWallets = wallets
                .filter(w=>w.name.toLowerCase().includes(walletSearch.toLowerCase()))
                .sort((a,b)=>a.name.localeCompare(b.name));

              if(!visibleWallets.length) return <div style={{color:C.textMuted,fontSize:13,textAlign:"center",padding:32}}>No accounts match "{walletSearch}"</div>;

              return walletView==="grid" ? (
                <div className="grid-2">
                  {visibleWallets.map(w=>{
                    const bal=parseFloat(w.balance||0);
                    const wIn=txs.filter(t=>(t.wallet||t.wallet_id)===w.id&&(t.type==="income"||t.type==="transfer_in")).reduce((s,t)=>s+(t.amount||parseFloat(t.amount_kes||0)),0);
                    const wOut=txs.filter(t=>(t.wallet||t.wallet_id)===w.id&&(t.type==="expense"||t.type==="transfer_out")).reduce((s,t)=>s+(t.amount||parseFloat(t.amount_kes||0)),0);
                    return<Card key={w.id} onClick={()=>goToWalletTxs(w.id)} style={{borderTop:`3px solid ${w.color}`,cursor:"pointer",transition:"box-shadow 0.15s",userSelect:"none"}}
                      onMouseEnter={e=>e.currentTarget.style.boxShadow=`0 4px 20px ${w.color}33`}
                      onMouseLeave={e=>e.currentTarget.style.boxShadow=""}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                        <div>
                          <div style={{fontSize:22,marginBottom:3}}>{w.icon}</div>
                          <div style={{fontWeight:700,fontSize:14}}>{w.name}</div>
                          <div style={{display:"flex",gap:5,marginTop:4,flexWrap:"wrap"}}>
                            <Badge color={w.color}>{ACCT_TYPE[w.account_type||w.accountType]||w.account_type}</Badge>
                            <Badge color={C.textFaint}>{w.currency}</Badge>
                          </div>
                        </div>
                        <div style={{textAlign:"right"}}>
                          <div style={{fontFamily:"'DM Serif Display',serif",fontSize:20,color:w.color}}>{fmtC(bal,w.currency,currencies)}</div>
                          {baseCurrency!==w.currency&&<div style={{color:C.textFaint,fontSize:10,marginTop:1}}>≈ {disp(bal)}</div>}
                          {w.opening_balance!=null&&<div style={{color:C.textFaint,fontSize:10,marginTop:2}}>Opening: {fmtC(parseFloat(w.opening_balance||0),w.currency,currencies)}</div>}
                          <div style={{display:"flex",gap:5,marginTop:6}}>
                            <button onClick={e=>{e.stopPropagation();openEditWallet(w);}} style={{background:"none",border:`1px solid ${C.navyLight}`,borderRadius:6,color:C.textMuted,padding:"3px 8px",cursor:"pointer",fontSize:10}}>✏️ Edit</button>
                            <button onClick={e=>{e.stopPropagation();askConfirm("Delete Account",`Delete "${w.name}"? This will permanently remove the account. Deletion will be blocked if the account has any transactions, goals, investments, or loan repayments linked to it.`,()=>deleteWallet(w.id));}} style={{background:"none",border:`1px solid ${C.coral}44`,borderRadius:6,color:C.coral,padding:"3px 8px",cursor:"pointer",fontSize:10}}>🗑 Delete</button>
                          </div>
                        </div>
                      </div>
                      <div style={{display:"flex",gap:14,fontSize:11,color:C.textMuted,marginBottom:8}}>
                        <span>↑ {disp(wIn)}</span><span>↓ {disp(wOut)}</span>
                      </div>
                      <Sparkline values={[bal*0.82,bal*0.87,bal*0.85,bal*0.92,bal*0.97,bal]} color={w.color} width={170} height={26}/>
                      {(()=>{
                        const linked = expCats.filter(c=>c.linkedWalletId===w.id);
                        if(!linked.length) return null;
                        const sumAllocated = linked.reduce((s,c)=>s+(c.allocatedKes||0),0);
                        const unallocated = bal - sumAllocated;
                        return (
                          <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.navyLight}`}} onClick={e=>e.stopPropagation()}>
                            <div style={{fontSize:10,color:C.textMuted,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.05em"}}>Allocated for</div>
                            {linked.map(c=>(
                              <div key={c.id} style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:3}}>
                                <span style={{color:C.textMuted}}>{c.icon} {c.name}</span>
                                <span style={{fontWeight:600,color:C.textPrimary}}>{disp(c.allocatedKes)}</span>
                              </div>
                            ))}
                            <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginTop:4,paddingTop:4,borderTop:`1px solid ${C.navyLight}`}}>
                              <span style={{color:C.textMuted}}>{unallocated>=0?"Unallocated":"Over-allocated"}</span>
                              <span style={{fontWeight:700,color:unallocated>=0?C.teal:C.coral}}>{disp(Math.abs(unallocated))}</span>
                            </div>
                          </div>
                        );
                      })()}
                    </Card>;
                  })}
                </div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {visibleWallets.map(w=>{
                    const bal=parseFloat(w.balance||0);
                    return<div key={w.id} onClick={()=>goToWalletTxs(w.id)} style={{display:"flex",alignItems:"center",gap:12,padding:"14px 16px",background:C.navyMid,borderRadius:14,cursor:"pointer",borderLeft:`4px solid ${w.color}`,transition:"box-shadow 0.15s",userSelect:"none"}}
                      onMouseEnter={e=>e.currentTarget.style.boxShadow=`0 2px 12px ${w.color}33`}
                      onMouseLeave={e=>e.currentTarget.style.boxShadow=""}>
                      <div style={{fontSize:22,flexShrink:0}}>{w.icon}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontWeight:700,fontSize:14}}>{w.name}</div>
                        <div style={{display:"flex",gap:5,marginTop:3,flexWrap:"wrap"}}>
                          <Badge color={w.color}>{ACCT_TYPE[w.account_type||w.accountType]||w.account_type}</Badge>
                          <Badge color={C.textFaint}>{w.currency}</Badge>
                        </div>
                      </div>
                      <div style={{textAlign:"right",flexShrink:0}}>
                        <div style={{fontFamily:"'DM Serif Display',serif",fontSize:17,color:w.color}}>{fmtC(bal,w.currency,currencies)}</div>
                        {w.opening_balance!=null&&<div style={{color:C.textFaint,fontSize:10,marginTop:1}}>Opening: {fmtC(parseFloat(w.opening_balance||0),w.currency,currencies)}</div>}
                      </div>
                      <div style={{display:"flex",flexDirection:"column",gap:4,flexShrink:0}}>
                        <button onClick={e=>{e.stopPropagation();openEditWallet(w);}} style={{background:"none",border:`1px solid ${C.navyLight}`,borderRadius:6,color:C.textMuted,padding:"3px 8px",cursor:"pointer",fontSize:10}}>✏️</button>
                        <button onClick={e=>{e.stopPropagation();askConfirm("Delete Account",`Delete "${w.name}"? This will permanently remove the account. Deletion will be blocked if the account has any transactions, goals, investments, or loan repayments linked to it.`,()=>deleteWallet(w.id));}} style={{background:"none",border:`1px solid ${C.coral}44`,borderRadius:6,color:C.coral,padding:"3px 8px",cursor:"pointer",fontSize:10}}>🗑</button>
                      </div>
                    </div>;
                  })}
                </div>
              );
            })()}

            {wallets.length>1&&<Card>
              <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>Allocation</div>
              <div style={{display:"flex",gap:3,height:12,borderRadius:8,overflow:"hidden",marginBottom:12}}>
                {wallets.map(w=><div key={w.id} style={{flex:parseFloat(w.balance||0),background:w.color}}/>)}
              </div>
              <div style={{display:"flex",gap:14,flexWrap:"wrap"}}>
                {wallets.map(w=><div key={w.id} style={{display:"flex",alignItems:"center",gap:5,fontSize:11}}>
                  <div style={{width:7,height:7,borderRadius:"50%",background:w.color}}/>
                  <span style={{color:C.textMuted}}>{w.name}</span>
                  <span style={{fontWeight:700}}>{totalBalance>0?((parseFloat(w.balance||0)/totalBalance)*100).toFixed(0):0}%</span>
                </div>)}
              </div>
            </Card>}
          </div>
        )}

        {/* RECORDS  */}
        {tab==="transactions"&&(
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
              <div>
                <div style={{fontFamily:"'DM Serif Display',serif",fontSize:24}}>All Records</div>
                <div style={{color:C.textMuted,fontSize:12}}>
                  {(txSearch.trim()||txTypeFilter!=="all"||txPeriod!=="all") ? `${filteredTxs.length} of ${txs.length} records` : `${txs.length} records`}
                </div>
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
                <Btn onClick={exportTransactions} outline color={C.textMuted} small>⬇ Export</Btn>
                <Btn onClick={()=>openM("expCat")} outline color={C.blue} small>＋ Category</Btn>
                <Btn onClick={()=>{setEditTx(null);setFTx({...blankTx,wallet:wallets[0]?.id||"",category:expCats[0]?.id||""});openM("tx");}}>+ Add Transaction</Btn>
              </div>
            </div>

            {/* ── Wallet filter banner ── */}
            {txWalletFilter&&(()=>{
              const fw=wallets.find(w=>w.id===txWalletFilter);
              return fw?<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:fw.color+"22",border:`1px solid ${fw.color}44`,borderRadius:12,padding:"10px 14px",marginBottom:10,gap:8}}>
                <button onClick={()=>setTab("accounts")} style={{background:"none",border:"none",color:fw.color,cursor:"pointer",fontSize:13,fontWeight:700,padding:"0 4px",flexShrink:0}}>← Accounts</button>
                <div style={{flex:1,textAlign:"center"}}>
                  <div style={{fontSize:12,color:fw.color,fontWeight:600}}>{fw.icon} {fw.name}</div>
                  <div style={{fontFamily:"'DM Serif Display',serif",fontSize:20,color:parseFloat(fw.balance||0)>=0?C.teal:C.coral,marginTop:2}}>{disp(parseFloat(fw.balance||0))}</div>
                  <div style={{fontSize:10,color:C.textMuted,marginTop:1}}>Current balance</div>
                </div>
                <button onClick={()=>setTxWalletFilter("")} style={{background:"none",border:"none",color:fw.color,cursor:"pointer",fontSize:13,fontWeight:700,padding:"0 4px",flexShrink:0}}>✕ All</button>
              </div>:null;
            })()}

            {/* ── Search bar ── */}
            <div style={{position:"relative"}}>
              <span style={{position:"absolute",left:14,top:"50%",transform:"translateY(-50%)",fontSize:15,color:C.textFaint,pointerEvents:"none"}}>🔍</span>
              <input
                type="text"
                value={txSearch}
                onChange={e => setTxSearch(e.target.value)}
                placeholder="Search by vendor, note, category or account…"
                style={{
                  width:"100%", boxSizing:"border-box",
                  background:C.navyMid, border:`1.5px solid ${txSearch ? C.teal : C.textFaint}`,
                  borderRadius:12, padding:"12px 42px 12px 40px",
                  color:C.textPrimary, fontSize:13, outline:"none",
                  transition:"border-color 0.2s",
                }}
                onFocus={e => e.target.style.borderColor = C.teal}
                onBlur={e  => e.target.style.borderColor = txSearch ? C.teal : C.textFaint}
              />
              {txSearch && (
                <button
                  onClick={() => setTxSearch("")}
                  title="Clear search"
                  style={{
                    position:"absolute", right:12, top:"50%", transform:"translateY(-50%)",
                    background:C.navyLight, border:"none", borderRadius:6,
                    color:C.textMuted, cursor:"pointer", fontSize:12,
                    padding:"2px 7px", lineHeight:1.4,
                  }}
                >✕</button>
              )}
            </div>

            {/* ── Type filter pills ── */}
            <div style={{display:"flex",gap:6}}>
              {[["all","All"],["income","Income"],["expense","Expense"]].map(([v,label])=>{
                const active = txTypeFilter===v;
                const col = v==="income"?C.teal:v==="expense"?C.coral:C.blue;
                return <button key={v} onClick={()=>setTxTypeFilter(v)} style={{padding:"7px 16px",borderRadius:20,border:`1.5px solid ${active?col:C.navyLight}`,background:active?col+"22":"none",color:active?col:C.textMuted,fontWeight:active?700:500,fontSize:12,cursor:"pointer",transition:"all 0.15s"}}>{v==="income"?"↑ ":v==="expense"?"↓ ":""}{label}</button>;
              })}
            </div>

            {/* ── Period filter ── */}
            {(()=>{
              const periods=[["all","All time"],["today","Today"],["week","This week"],["month","This month"],["quarter","This quarter"],["year","This year"],["custom","Custom"]];
              const comparable = ["today","week","month","quarter","year"].includes(txPeriod);
              return(<>
                <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                  {periods.map(([v,label])=>{
                    const active=txPeriod===v;
                    return <button key={v} onClick={()=>{setTxPeriod(v);setCompareMode("previous");}} style={{padding:"6px 14px",borderRadius:20,border:`1.5px solid ${active?C.teal:C.navyLight}`,background:active?C.teal+"22":"none",color:active?C.teal:C.textMuted,fontWeight:active?700:500,fontSize:12,cursor:"pointer",transition:"all 0.15s"}}>{label}</button>;
                  })}
                  {comparable&&<button onClick={()=>setTxCompare(c=>!c)} style={{padding:"6px 14px",borderRadius:20,border:`1.5px solid ${txCompare?C.gold:C.navyLight}`,background:txCompare?C.gold+"22":"none",color:txCompare?C.gold:C.textMuted,fontWeight:txCompare?700:500,fontSize:12,cursor:"pointer",transition:"all 0.15s"}}>📊 Compare</button>}
                </div>
                {txPeriod==="custom"&&(
                  <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <span style={{fontSize:12,color:C.textMuted,whiteSpace:"nowrap"}}>From</span>
                      <input type="date" value={txDateFrom} onChange={e=>setTxDateFrom(e.target.value)} style={{background:C.navyLight,border:`1px solid ${C.navyLight}`,borderRadius:8,color:C.textPrimary,padding:"7px 10px",fontSize:12,outline:"none",cursor:"pointer"}}/>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <span style={{fontSize:12,color:C.textMuted,whiteSpace:"nowrap"}}>To</span>
                      <input type="date" value={txDateTo} onChange={e=>setTxDateTo(e.target.value)} style={{background:C.navyLight,border:`1px solid ${C.navyLight}`,borderRadius:8,color:C.textPrimary,padding:"7px 10px",fontSize:12,outline:"none",cursor:"pointer"}}/>
                    </div>
                    {(txDateFrom||txDateTo)&&<button onClick={()=>{setTxDateFrom("");setTxDateTo("");}} style={{background:"none",border:"none",color:C.textMuted,fontSize:12,cursor:"pointer",padding:"4px 6px"}}>✕ Clear</button>}
                  </div>
                )}
                {txCompare&&comparable&&(()=>{
                  const prevLabel = {today:"Yesterday",week:"Previous week",month:"Previous month",quarter:"Previous quarter",year:"Previous year"}[txPeriod];
                  const canPickExact = ["month","quarter","year"].includes(txPeriod);
                  const modes = [["previous",prevLabel],["lastYear","Same time last year"],...(canPickExact?[["custom",`Choose a specific ${txPeriod}`]]:[])];
                  const lastMonthStr = ()=>{ const d=new Date(); d.setMonth(d.getMonth()-1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; };
                  return (
                    <div style={{background:C.navyLight,borderRadius:12,padding:"10px 12px",display:"flex",flexDirection:"column",gap:8}}>
                      <div style={{fontSize:10,color:C.textMuted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>Compare against</div>
                      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                        {modes.map(([v,label])=>{
                          const active=compareMode===v;
                          return <button key={v} onClick={()=>{setCompareMode(v); if(v==="custom"&&txPeriod==="month"&&!compareCustom.month) setCompareCustom(c=>({...c,month:lastMonthStr()}));}}
                            style={{padding:"5px 12px",borderRadius:20,border:`1.5px solid ${active?C.gold:C.navyLight}`,background:active?C.gold+"22":C.navyMid,color:active?C.gold:C.textMuted,fontWeight:active?700:500,fontSize:11,cursor:"pointer"}}>{label}</button>;
                        })}
                      </div>
                      {compareMode==="custom"&&txPeriod==="month"&&(
                        <input type="month" value={compareCustom.month||lastMonthStr()} onChange={e=>setCompareCustom(c=>({...c,month:e.target.value}))}
                          style={{background:C.navyMid,border:`1px solid ${C.navyLight}`,borderRadius:8,color:C.textPrimary,padding:"7px 10px",fontSize:12,outline:"none",cursor:"pointer",width:"fit-content"}}/>
                      )}
                      {compareMode==="custom"&&txPeriod==="quarter"&&(
                        <div style={{display:"flex",gap:8}}>
                          <select value={compareCustom.quarter} onChange={e=>setCompareCustom(c=>({...c,quarter:+e.target.value}))}
                            style={{background:C.navyMid,border:`1px solid ${C.navyLight}`,borderRadius:8,color:C.textPrimary,padding:"7px 10px",fontSize:12,outline:"none",cursor:"pointer"}}>
                            {[1,2,3,4].map(q=><option key={q} value={q}>Q{q}</option>)}
                          </select>
                          <input type="number" value={compareCustom.year} onChange={e=>setCompareCustom(c=>({...c,year:+e.target.value||c.year}))}
                            style={{background:C.navyMid,border:`1px solid ${C.navyLight}`,borderRadius:8,color:C.textPrimary,padding:"7px 10px",fontSize:12,outline:"none",width:90}}/>
                        </div>
                      )}
                      {compareMode==="custom"&&txPeriod==="year"&&(
                        <input type="number" value={compareCustom.year} onChange={e=>setCompareCustom(c=>({...c,year:+e.target.value||c.year}))}
                          style={{background:C.navyMid,border:`1px solid ${C.navyLight}`,borderRadius:8,color:C.textPrimary,padding:"7px 10px",fontSize:12,outline:"none",width:110}}/>
                      )}
                    </div>
                  );
                })()}
              </>);
            })()}

            {/* ── Summary chips (reflect active filters) ── */}
            {(()=>{
              const fIn=filteredTxs.filter(t=>t.type==="income").reduce((s,t)=>s+(t.amount||parseFloat(t.amount_kes||0)),0);
              const fOut=filteredTxs.filter(t=>t.type==="expense").reduce((s,t)=>s+(t.amount||parseFloat(t.amount_kes||0)),0);
              return(
                <div className="grid-3">
                  <Chip label="In"  value={disp(fIn)}      color={C.teal}/>
                  <Chip label="Out" value={disp(fOut)}     color={C.coral}/>
                  <Chip label="Net" value={disp(fIn-fOut)} color={fIn>=fOut?C.teal:C.coral}/>
                </div>
              );
            })()}

            {compareStats&&(
              <Card>
                <div style={{fontSize:12,color:C.textMuted,marginBottom:10,fontWeight:600}}>
                  {compareStats.cur.label} vs {compareStats.prev.label}
                </div>
                <div className="grid-3" style={{gap:10}}>
                  {[
                    ["In",  compareStats.cur.in,  compareStats.prev.in,  C.teal,  false],
                    ["Out", compareStats.cur.out, compareStats.prev.out, C.coral, true],
                    ["Net", compareStats.cur.net, compareStats.prev.net, compareStats.cur.net>=compareStats.prev.net?C.teal:C.coral, false],
                  ].map(([label,cur,prev,col,badIfUp])=>{
                    const diff = cur - prev;
                    const up = diff >= 0;
                    const pct = prev !== 0 ? Math.abs(diff/prev)*100 : (cur!==0?100:0);
                    const deltaColor = (up !== badIfUp) ? C.teal : C.coral;
                    return (
                      <div key={label} style={{padding:"10px 12px",background:C.navyLight,borderRadius:10}}>
                        <div style={{fontSize:11,color:C.textMuted,marginBottom:4}}>{label}</div>
                        <div style={{fontSize:15,fontWeight:700,color:col}}>{disp(cur)}</div>
                        <div style={{fontSize:11,color:C.textFaint,marginTop:2}}>was {disp(prev)}</div>
                        <div style={{fontSize:11,fontWeight:600,marginTop:4,color:deltaColor}}>{up?"▲":"▼"} {pct.toFixed(0)}%</div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            <Card style={{padding:0}}>
              {filteredTxs.length === 0 ? (
                <div style={{padding:"40px 20px",textAlign:"center"}}>
                  <div style={{fontSize:32,marginBottom:10}}>🏆</div>
                  <div style={{fontWeight:600,fontSize:14,color:C.textPrimary,marginBottom:6}}>No records found</div>
                  <div style={{color:C.textMuted,fontSize:12,marginBottom:14}}>
                    {txSearch.trim()?<>No transactions match <strong>"{txSearch}"</strong></>:"No transactions match the current filters."}
                  </div>
                  <Btn onClick={()=>{setTxSearch("");setTxTypeFilter("all");setTxPeriod("all");setTxDateFrom("");setTxDateTo("");}} outline color={C.textMuted} small>Clear all filters</Btn>
                </div>
              ) : filteredTxs.map((t,i,arr)=>{
                const isT=t.type==="transfer_out"||t.type==="transfer_in";
                const isRefund=t.type==="refund";
                const catId=t.category||t.category_id;
                const cat=isT?{icon:"⇄",name:"Transfer",color:C.blue}:isRefund?{icon:"↩️",name:"Refund",color:"#9B59B6"}:t.type==="expense"?expCats.find(c=>c.id===catId):incCats.find(c=>c.id===catId);
                const w=wallets.find(w=>w.id===(t.wallet||t.wallet_id));
                const isIn=t.type==="income"||t.type==="transfer_in"||isRefund;
                const amt=t.amount||parseFloat(t.amount_kes||0);
                const origTx=isRefund?txs.find(x=>x.id===t.refund_of):null;

                // Highlight matching text in vendor/note
                const label = t.merchant || t.note || "Transaction";
                const q = txSearch.trim().toLowerCase();
                const highlight = (text) => {
                  if (!q || !text.toLowerCase().includes(q)) return text;
                  const idx = text.toLowerCase().indexOf(q);
                  return (
                    <span>
                      {text.slice(0, idx)}
                      <mark style={{background:C.teal+"44",color:C.textPrimary,borderRadius:3,padding:"0 2px"}}>{text.slice(idx, idx+q.length)}</mark>
                      {text.slice(idx+q.length)}
                    </span>
                  );
                };

                return<div key={t.id} onClick={()=>setTxDetail(t)}
                  onMouseEnter={e=>e.currentTarget.style.background=isRefund?"#9B59B622":C.navyMid}
                  onMouseLeave={e=>e.currentTarget.style.background=isRefund?"#9B59B611":"transparent"}
                  style={{display:"flex",alignItems:"center",gap:12,padding:"11px 18px",borderBottom:i<arr.length-1?`1px solid ${C.navyLight}`:"none",background:isRefund?"#9B59B611":"transparent",cursor:"pointer"}}>
                  <div style={{width:36,height:36,borderRadius:10,background:(cat?.color||C.teal)+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0}}>{cat?.icon||"💸"}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:600,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{highlight(label)}</div>
                    <div style={{color:C.textMuted,fontSize:10,marginTop:2,display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                      <span>{highlight(cat?.name||"—")}</span><span>·</span>
                      <span>{highlight(w?.name||"—")}</span><span>·</span>
                      <span>{fmtDate(t.date||t.tx_date)}{txTime(t)?" · "+txTime(t):""}</span>
                      {t.loanId&&<Badge color={C.coral}>Loan</Badge>}
                      {t.recurring&&<Badge color={C.purple}>🔁</Badge>}
                      {isRefund&&origTx&&<span style={{color:"#9B59B6"}}>↩ {origTx.merchant||origTx.note||"expense"}</span>}
                    </div>
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontWeight:700,fontSize:13,color:isIn?C.teal:C.textPrimary}}>{isIn?"+":"−"}{disp(amt)}</div>
                    <div style={{marginTop:4}}>
                      {isRefund?<Badge color="#9B59B6">↩ refund</Badge>:<Badge color={isT?C.blue:isIn?C.teal:C.coral}>{isT?t.type.replace("_"," "):t.type}</Badge>}
                    </div>
                  </div>
                </div>;
              })}

            </Card>
          </div>
        )}

        {/* BUDGETS  */}
        {tab==="budgets"&&(()=>{
          const isPercentMode = user.budget_mode==="percentage";
          const bmTxs = txs.filter(t=>{ const d=new Date(t.date||t.tx_date); return d.getFullYear()===budgetYear && d.getMonth()+1===budgetMonth; });
          const bmSpend = {}; expCats.forEach(c=>bmSpend[c.id]=0);
          bmTxs.filter(t=>t.type==="expense").forEach(t=>{ const key=t.category||t.category_id; bmSpend[key]=(bmSpend[key]||0)+t.amount; });
          bmTxs.filter(t=>t.type==="refund").forEach(t=>{ const orig=txs.find(x=>x.id===t.refund_of); const key=orig?(orig.category||orig.category_id):null; if(key) bmSpend[key]=Math.max(0,(bmSpend[key]||0)-t.amount); });
          const bmEarn = {}; incCats.forEach(c=>bmEarn[c.id]=0);
          bmTxs.filter(t=>t.type==="income").forEach(t=>{ const key=t.category||t.category_id; bmEarn[key]=(bmEarn[key]||0)+t.amount; });
          const bmTransferred = {};
          bmTxs.filter(t=>t.type==="transfer_out").forEach(t=>{ const key=t.category||t.category_id; if(key) bmTransferred[key]=(bmTransferred[key]||0)+t.amount; });
          // Bottom-up actual spend for the SELECTED month (mirrors usedById, but scoped to bmSpend
          // instead of the always-current-month spendByCat, so month navigation works correctly here).
          const bmUsedById = (() => {
            const memo = {};
            const resolve = (id) => {
              if (memo[id] != null) return memo[id];
              const kids = childrenByParent[id] || [];
              const val = kids.length ? kids.reduce((s,k)=>s+resolve(k.id),0)
                : (catsById[id]?.linkedWalletId ? (bmTransferred[id]||0) : (bmSpend[id]||0));
              memo[id] = val;
              return val;
            };
            Object.keys(catsById).forEach(resolve);
            return memo;
          })();
          const bmOver = expCats.filter(c=>(capById[c.id]||0)>0 && (bmUsedById[c.id]||0)>(capById[c.id]||0) && !c.linkedWalletId);
          const bmTotalIncome  = bmTxs.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0);
          const bmTotalExpense = Math.max(0, bmTxs.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0) - bmTxs.filter(t=>t.type==="refund").reduce((s,t)=>s+t.amount,0));
          const isCurrentBM = budgetYear===new Date().getFullYear() && budgetMonth===new Date().getMonth()+1;
          const bq = budgetSearch.trim().toLowerCase();
          const manualExpCats = expCats.filter(c=>c.allocationType!=="percent");
          const sortedExpCats = [...manualExpCats].sort((a,b)=>{ const sa=bmSpend[a.id]||0,sb=bmSpend[b.id]||0; return sb!==sa?sb-sa:a.name.localeCompare(b.name); });
          const sortedIncCats = [...incCats].sort((a,b)=>a.name.localeCompare(b.name));
          const filtExpCats = bq ? sortedExpCats.filter(c=>c.name.toLowerCase().includes(bq)||c.icon.includes(bq)) : sortedExpCats;
          const filtIncCats = bq ? sortedIncCats.filter(c=>c.name.toLowerCase().includes(bq)||c.icon.includes(bq)) : sortedIncCats;
          // Percentage mode: root-level allocation tree, with a deep search match
          // (a root shows if it or any of its descendants match the query).
          const rootExpCats = childrenByParent["__root__"] || [];
          const matchesDeep = (c) => c.name.toLowerCase().includes(bq) || c.icon.includes(bq) ||
            getDescendantIds(c.id).some(id => { const d=catsById[id]; return d && (d.name.toLowerCase().includes(bq)||d.icon.includes(bq)); });
          const filtRootExpCats = [...rootExpCats].sort((a,b)=>a.name.localeCompare(b.name)).filter(c => !bq || matchesDeep(c));
          return(
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:10}}>
              <div style={{fontFamily:"'DM Serif Display',serif",fontSize:24}}>Budgets & Categories</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                <Btn onClick={()=>{setFIncCat(blankIncCat);openM("incCat");}} outline color={C.teal} small>+ Income Cat.</Btn>
                <Btn onClick={()=>{setFExpCat(blankExpCat);openM("expCat");}} small>+ Expense Cat.</Btn>
              </div>
            </div>

            {/* Month navigator — centered, larger */}
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
              <div style={{display:"flex",alignItems:"center",gap:14}}>
                <button onClick={()=>{const[y,m]=prevBudgetMonth(budgetYear,budgetMonth);setBudgetYear(y);setBudgetMonth(m);}} style={{background:C.navyLight,border:"none",borderRadius:8,color:C.textPrimary,padding:"6px 14px",cursor:"pointer",fontSize:22,lineHeight:1}}>‹</button>
                <div style={{fontWeight:700,fontSize:19,minWidth:120,textAlign:"center"}}>{MONTH_NAMES[budgetMonth-1]} {budgetYear}</div>
                <button onClick={()=>{const[y,m]=nextBudgetMonth(budgetYear,budgetMonth);setBudgetYear(y);setBudgetMonth(m);}} style={{background:C.navyLight,border:"none",borderRadius:8,color:C.textPrimary,padding:"6px 14px",cursor:"pointer",fontSize:22,lineHeight:1}}>›</button>
                {!isCurrentBM&&<button onClick={()=>{setBudgetYear(new Date().getFullYear());setBudgetMonth(new Date().getMonth()+1);}} style={{background:C.teal+"22",border:"none",borderRadius:6,color:C.teal,padding:"3px 8px",cursor:"pointer",fontSize:10,fontWeight:600}}>Today</button>}
              </div>
              <div style={{color:C.textMuted,fontSize:12}}>{bmOver.length} over budget in {MONTH_NAMES[budgetMonth-1]}</div>
            </div>

            {/* Month summary — clickable to filter sections */}
            <div style={{display:"flex",gap:10}}>
              {[
                {key:"income",  label:"INCOME",   value:bmTotalIncome,              color:C.teal,  activeColor:C.teal},
                {key:"expense", label:"EXPENSES",  value:bmTotalExpense,             color:C.coral, activeColor:C.coral},
                {key:"all",     label:"NET",       value:bmTotalIncome-bmTotalExpense, color:bmTotalIncome>=bmTotalExpense?C.teal:C.coral, activeColor:bmTotalIncome>=bmTotalExpense?C.teal:C.coral},
              ].map(({key,label,value,color,activeColor})=>{
                const active = budgetView===key;
                return <button key={key} onClick={()=>setBudgetView(active&&key!=="all"?"all":key)} style={{flex:1,background:active?activeColor+"22":C.navyLight,borderRadius:12,padding:"12px 16px",borderTop:`3px solid ${active?activeColor:C.navyLight}`,border:`2px solid ${active?activeColor:"transparent"}`,cursor:"pointer",textAlign:"left",transition:"all 0.2s"}}>
                  <div style={{fontSize:10,color:active?activeColor:C.textMuted,marginBottom:4,fontWeight:active?700:400}}>{label}</div>
                  <div style={{fontFamily:"'DM Serif Display',serif",fontSize:15,color}}>{disp(value)}</div>
                </button>;
              })}
            </div>

            {/* Search bar */}
            <div style={{position:"relative"}}>
              <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:C.textMuted,fontSize:14,pointerEvents:"none"}}>🔍</span>
              <input
                value={budgetSearch} onChange={e=>setBudgetSearch(e.target.value)}
                placeholder="Search categories…"
                style={{background:C.navyLight,border:`1px solid ${budgetSearch?C.teal:C.navyLight}`,borderRadius:10,padding:"10px 14px 10px 36px",color:C.textPrimary,width:"100%",fontSize:13,outline:"none",boxSizing:"border-box",transition:"border-color 0.2s"}}
              />
              {budgetSearch&&<button onClick={()=>setBudgetSearch("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:16,lineHeight:1}}>✕</button>}
            </div>
            {bq&&<div style={{fontSize:12,color:C.textMuted}}>{filtExpCats.length+filtIncCats.length} categor{filtExpCats.length+filtIncCats.length===1?"y":"ies"} match "{budgetSearch}"</div>}
            {bmOver.length>0&&<Card style={{borderLeft:`3px solid ${C.coral}`}}>
              <div style={{fontWeight:700,color:C.coral,marginBottom:8,fontSize:13}}>⚠ Overspending Alerts</div>
              {bmOver.map(a=><div key={a.id} style={{color:C.textMuted,fontSize:12,padding:"3px 0"}}>{a.icon} <strong style={{color:C.textPrimary}}>{a.name}</strong>: {disp(bmUsedById[a.id])} vs {disp(capById[a.id])} — <span style={{color:C.coral}}>+{disp((bmUsedById[a.id]||0)-(capById[a.id]||0))} over</span></div>)}
            </Card>}

            {isPercentMode && budgetView!=="income" && <>
              <Divider label="Income"/>
              <Card>
                <div style={{display:"flex",alignItems:"flex-end",gap:12,flexWrap:"wrap"}}>
                  <div style={{flex:1,minWidth:160,marginBottom:0}}>
                    <div style={{color:C.textMuted,fontSize:11,marginBottom:5,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>Income for {MONTH_NAMES[budgetMonth-1]} ({baseCurrency})</div>
                    <div style={{fontFamily:"'DM Serif Display',serif",fontSize:24,color:C.textPrimary}}>{disp(grossIncome)}</div>
                    <div style={{fontSize:10,color:C.textMuted,marginTop:3}}>Auto-totaled from income you've recorded this month — log an income transaction to update it.</div>
                  </div>
                </div>
                <div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${C.navyLight}`}}>
                  <Btn onClick={()=>{setFWindfall(blankWindfall);openM("windfall");}} outline color={C.purple} small>🎁 Record Windfall</Btn>
                  <div style={{fontSize:10,color:C.textMuted,marginTop:6}}>Got a bonus or gift? Split it using your Windfall % rules instead of your monthly income split.</div>
                </div>
              </Card>
              <Divider label={`Allocation Rules${bq&&filtRootExpCats.length!==rootExpCats.length?` (${filtRootExpCats.length} of ${rootExpCats.length})`:""}`}/>
              {filtRootExpCats.length===0 && bq && <div style={{textAlign:"center",color:C.textMuted,fontSize:13,padding:"16px 0"}}>No categories match "{budgetSearch}"</div>}
              {filtRootExpCats.length===0 && !bq && <div style={{textAlign:"center",color:C.textFaint,fontSize:13,padding:"16px 0"}}>No allocation rules yet. Tap "+ Expense Cat." to define your first rule (e.g. Tithe, Tax Reserve).</div>}
              {filtRootExpCats.map(c=>(
                <CategoryTree key={c.id} node={c} childrenByParent={childrenByParent} capById={capById} usedById={bmUsedById} disp={disp}
                  onEdit={openEditExpCat}
                  onDelete={(node)=>askConfirm("Delete Category",`Delete category "${node.name}"? Existing transactions won't be affected.`,()=>deleteCategory(node.id,"expense"))}
                  onAddChild={(parentId)=>{setFExpCat({...blankExpCat,parentId});openM("expCat");}}
                  wallets={wallets} onAllocate={allocateToCategory}
                  onViewHistory={(node)=>setCatHistory({cat:node,type:"expense"})}/>
              ))}
            </>}

            {!isPercentMode && budgetView!=="income"&&<Divider label={`Expense Categories${bq&&filtExpCats.length!==manualExpCats.length?` (${filtExpCats.length} of ${manualExpCats.length})`:""}`}/>}
            {!isPercentMode && budgetView!=="income"&&filtExpCats.length===0&&bq&&<div style={{textAlign:"center",color:C.textMuted,fontSize:13,padding:"16px 0"}}>No expense categories match "{budgetSearch}"</div>}
            {!isPercentMode && budgetView!=="income"&&filtExpCats.map(c=>{
              const hasOverride=monthlyOverrides[c.id]!=null;
              const budget=hasOverride?monthlyOverrides[c.id]:(c.budget||0);
              const spent=bmSpend[c.id]||0,pct=budget>0?Math.min((spent/budget)*100,100):0,over=budget>0&&spent>budget;
              const txCnt=bmTxs.filter(t=>(t.category||t.category_id)===c.id).length;
              return<Card key={c.id} onClick={()=>setCatHistory({cat:c,type:"expense"})} style={{borderLeft:over?`3px solid ${C.coral}`:c.watch?`3px solid ${C.gold}`:"3px solid transparent",cursor:"pointer"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:budget>0?10:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <span style={{fontSize:18}}>{c.icon}</span>
                    <div>
                      <div style={{fontWeight:600,fontSize:13,display:"flex",alignItems:"center",gap:6}}>{c.name}{c.watch&&<Badge color={C.gold}>👁</Badge>}{hasOverride&&<Badge color={C.blue}>{MONTH_NAMES[budgetMonth-1]} only</Badge>}</div>
                      <div style={{fontSize:10,color:C.textMuted}}>{txCnt>0?`${txCnt} record${txCnt!==1?"s":""}  ·  `:""}{budget>0?`Budget: ${disp(budget)}`:"No budget set"}</div>
                    </div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontWeight:700,fontSize:13,color:over?C.coral:C.textPrimary}}>{disp(spent)}</div>
                      {budget>0&&<div style={{fontSize:10,color:over?C.coral:C.teal}}>{over?`+${disp(spent-budget)} over`:`${disp(budget-spent)} left`}</div>}
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      <button onClick={e=>{e.stopPropagation();setFBudget({catId:c.id,catType:"expense",amount:String(budget||""),everyMonth:!hasOverride});openM("budget");}} style={{background:C.navyLight,border:"none",borderRadius:8,color:C.teal,padding:"7px 14px",cursor:"pointer",fontSize:12,fontWeight:600,minWidth:96,textAlign:"center"}}>{budget>0?"Edit Budget":"Set Budget"}</button>
                      <button onClick={e=>{e.stopPropagation();toggleWatch(c.id);}} style={{background:c.watch?C.gold+"22":C.navyLight,border:"none",borderRadius:8,color:c.watch?C.gold:C.textMuted,padding:"7px 14px",cursor:"pointer",fontSize:12,fontWeight:600,minWidth:96,textAlign:"center"}}>{c.watch?"Watching":"Watch"}</button>
                      <button onClick={e=>{e.stopPropagation();askConfirm("Delete Category",`Delete category "${c.name}"? Existing transactions won't be affected.`,()=>deleteCategory(c.id,"expense"));}} style={{background:"none",border:`1px solid ${C.coral}44`,borderRadius:8,color:C.coral,padding:"7px 14px",cursor:"pointer",fontSize:12,fontWeight:600,minWidth:96,textAlign:"center"}}>🗑 Delete</button>
                    </div>
                  </div>
                </div>
                {budget>0&&<><Bar value={spent} max={budget} color={c.color}/><div style={{color:C.textFaint,fontSize:10,marginTop:4}}>{pct.toFixed(0)}% used</div></>}
              </Card>;
            })}
            {budgetView!=="expense"&&<Divider label={`Income Categories${bq&&filtIncCats.length!==incCats.length?` (${filtIncCats.length} of ${incCats.length})`:""}`}/>}
            {budgetView!=="expense"&&filtIncCats.length===0&&bq&&<div style={{textAlign:"center",color:C.textMuted,fontSize:13,padding:"16px 0"}}>No income categories match "{budgetSearch}"</div>}
            {budgetView!=="expense"&&<div className="grid-2">
              {filtIncCats.map(c=>{
                const earned=bmEarn[c.id]||0;
                const txCnt=bmTxs.filter(t=>(t.category||t.category_id)===c.id).length;
                return<Card key={c.id} onClick={()=>setCatHistory({cat:c,type:"income"})} style={{cursor:"pointer"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:18}}>{c.icon}</span>
                      <div>
                        <div style={{fontWeight:600,fontSize:13}}>{c.name}</div>
                        <div style={{fontSize:10,color:C.textMuted}}>{txCnt>0?`${txCnt} record${txCnt!==1?"s":""}  ·  `:""}{c.budget>0?`Target: ${disp(c.budget)}`:"No target"}</div>
                      </div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      <button onClick={e=>{e.stopPropagation();setFBudget({catId:c.id,catType:"income",amount:String(c.budget||"")});openM("budget");}} style={{background:C.navyLight,border:"none",borderRadius:8,color:C.teal,padding:"7px 14px",cursor:"pointer",fontSize:12,fontWeight:600,minWidth:96,textAlign:"center"}}>{c.budget>0?"Edit":"Set Target"}</button>
                      <button onClick={e=>{e.stopPropagation();askConfirm("Delete Category",`Delete category "${c.name}"? Existing transactions won't be affected.`,()=>deleteCategory(c.id,"income"));}} style={{background:"none",border:`1px solid ${C.coral}44`,borderRadius:8,color:C.coral,padding:"7px 14px",cursor:"pointer",fontSize:12,fontWeight:600,minWidth:96,textAlign:"center"}}>🗑 Delete</button>
                    </div>
                  </div>
                  <div style={{fontFamily:"'DM Serif Display',serif",fontSize:20,color:c.color}}>{disp(earned)}</div>
                  {c.budget>0&&<div style={{marginTop:8}}><Bar value={earned} max={c.budget} color={c.color}/><div style={{color:C.textFaint,fontSize:10,marginTop:4}}>{Math.min((earned/c.budget)*100,100).toFixed(0)}% of target</div></div>}
                </Card>;
              })}
            </div>}
          </div>
          );
        })()}

        {/* GOALS  */}
        {tab==="goals"&&(
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
              <div>
                <div style={{fontFamily:"'DM Serif Display',serif",fontSize:24}}>Savings Goals</div>
                <div style={{color:C.textMuted,fontSize:12}}>Saved: {disp(totalGoalSaved)}</div>
              </div>
              <Btn onClick={()=>{setEditGoal(null);setFGoal({...blankGoal,wallet:wallets[0]?.id||""});openM("goal");}}>+ New Goal</Btn>
            </div>
            <div className="grid-2" style={{ gap: 14 }}>
              {goals.map(g=><GoalCard key={g.id} g={g} wallets={wallets} disp={disp} fmtDate={fmtDate}
                onFund={fundGoal} onEdit={openEditGoal}
                onDelete={(id,name)=>askConfirm("Delete Goal",`Delete goal "${name}"? Every contribution will be reversed back to the account it came from, and this cannot be undone.`,()=>deleteGoal(id))}
                onEditContribution={editGoalContribution}
                onDeleteContribution={(gid,cid,amount)=>askConfirm("Delete Contribution",`Delete this contribution of ${disp(amount)}? It will be reversed back to the account it came from.`,()=>deleteGoalContribution(gid,cid))}
              />)}
              {goals.length===0&&<div style={{gridColumn:"1/-1",textAlign:"center",color:C.textFaint,padding:"40px 0",fontSize:13}}>No goals yet. Create one to start saving with purpose.</div>}
            </div>
          </div>
        )}

        {/* RECURRING  */}
        {tab==="recurring"&&(
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
              <div><div style={{fontFamily:"'DM Serif Display',serif",fontSize:24}}>Recurring Transactions</div><div style={{color:C.textMuted,fontSize:12}}>Bills, subscriptions & regular income</div></div>
              <Btn onClick={()=>{setFRecur({...blankRecur,wallet:wallets[0]?.id||"",category:expCats[0]?.id||""});openM("recur");}}>+ Add Recurring</Btn>
            </div>
            <div className="grid-3">
              <Chip label="Monthly Out" value={disp(recurring.filter(r=>r.active&&r.type==="expense").reduce((s,r)=>s+r.amount,0))} color={C.coral}/>
              <Chip label="Monthly In"  value={disp(recurring.filter(r=>r.active&&r.type==="income").reduce((s,r)=>s+r.amount,0))} color={C.teal}/>
              <Chip label="Net Monthly" value={disp(recurring.filter(r=>r.active).reduce((s,r)=>s+r.amount*(r.type==="income"?1:-1),0))} color={C.gold}/>
            </div>
            {[{label:"Expenses & Subscriptions",filter:r=>r.type==="expense"},{label:"Income",filter:r=>r.type==="income"}].map(sec=>(
              <Card key={sec.label}>
                <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>{sec.label}</div>
                {recurring.filter(sec.filter).map(r=>{
                  const cat=r.type==="expense"?expCats.find(c=>c.id===(r.category||r.category_id)):incCats.find(c=>c.id===(r.category||r.category_id));
                  const w=wallets.find(w=>w.id===(r.wallet||r.wallet_id));
                  return<div key={r.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",background:r.active?C.navyLight:C.navyLight+"66",borderRadius:10,marginBottom:6,opacity:r.active?1:0.6}}>
                    <div style={{width:32,height:32,borderRadius:9,background:(cat?.color||C.teal)+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>{cat?.icon||"💳"}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:600,fontSize:13}}>{r.merchant||r.note}</div>
                      <div style={{fontSize:10,color:C.textMuted}}>{r.freq} · {w?.name} · next: {r.nextDate||r.next_date}</div>
                    </div>
                    <div style={{fontWeight:700,color:r.type==="income"?C.teal:C.coral,fontSize:13,marginRight:8}}>{disp(r.amount)}/mo</div>
                    <button onClick={()=>toggleRecurring(r.id)} style={{background:r.active?C.teal+"22":C.coral+"22",border:"none",borderRadius:7,color:r.active?C.teal:C.coral,padding:"4px 9px",cursor:"pointer",fontSize:11,fontWeight:600,flexShrink:0}}>{r.active?"Active":"Paused"}</button>
                    <button onClick={()=>askConfirm("Delete Recurring",`Delete "${r.merchant||r.note}"? This won't delete past transactions.`,()=>deleteRecurring(r.id))} style={{background:"none",border:`1px solid ${C.coral}44`,borderRadius:7,color:C.coral,padding:"4px 7px",cursor:"pointer",fontSize:11,flexShrink:0}}>🗑</button>
                  </div>;
                })}
                {recurring.filter(sec.filter).length===0&&<div style={{color:C.textFaint,fontSize:12,textAlign:"center",padding:"12px 0"}}>None added yet.</div>}
              </Card>
            ))}
          </div>
        )}

        {/* INVESTMENTS  */}
        {tab==="investments"&&(
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
              <div><div style={{fontFamily:"'DM Serif Display',serif",fontSize:24}}>Investments</div><div style={{color:C.textMuted,fontSize:12}}>Portfolio overview</div></div>
              <div style={{display:"flex",gap:8}}>
                <Btn onClick={()=>{setFRet({...blankRet,investmentId:investments[0]?.id||"",wallet:wallets[0]?.id||""});openM("ret");}} outline color={C.gold} small>+ Record Return</Btn>
                <Btn onClick={()=>{setEditInv(null);setFInv({...blankInv,wallet:wallets[0]?.id||""});openM("inv");}} small>+ Add Investment</Btn>
              </div>
            </div>
            {(()=>{
              const totalIn=investments.reduce((s,i)=>s+i.units*i.buyPrice,0);
              const totalNow=investments.reduce((s,i)=>s+i.units*i.currentPrice,0);
              const totalRet=investments.reduce((s,i)=>s+i.returns.reduce((ss,r)=>ss+r.amount,0),0);
              const gain=totalNow-totalIn;
              return<div className="grid-4">
                <Chip label="Invested" value={disp(totalIn)} color={C.textMuted}/>
                <Chip label="Market Value" value={disp(totalNow)} color={C.gold}/>
                <Chip label="Capital Gain" value={fmtPct(totalIn>0?(gain/totalIn)*100:0)} color={gain>=0?C.teal:C.coral} sub={disp(gain)}/>
                <Chip label="Returns Earned" value={disp(totalRet)} color={C.green} sub="Int + Divs"/>
              </div>;
            })()}
            {investments.map(inv=>{
              const invested=inv.units*inv.buyPrice,current=inv.units*inv.currentPrice;
              const gain=current-invested,gainPct=invested>0?(gain/invested)*100:0;
              const totalRet=inv.returns.reduce((s,r)=>s+r.amount,0);
              const w=wallets.find(w=>w.id===(inv.wallet||inv.wallet_id));
              return<Card key={inv.id}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4,flexWrap:"wrap"}}>
                      <span style={{fontWeight:700,fontSize:14}}>{inv.name}</span>
                      {inv.ticker&&<Badge color={C.gold}>{inv.ticker}</Badge>}
                      <Badge color={C.blue}>{inv.type}</Badge>
                      <Badge color={C.textFaint}>{inv.currency}</Badge>
                    </div>
                    <div style={{color:C.textMuted,fontSize:11,marginBottom:10}}>{inv.units.toLocaleString(undefined,{maximumFractionDigits:8})} units · {fmtC(inv.buyPrice,inv.currency,currencies)} → {fmtC(inv.currentPrice,inv.currency,currencies)} · {w?.name||"—"}</div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                      <Chip label="Invested" value={disp(invested)} color={C.textMuted}/>
                      <Chip label="Value" value={disp(current)} color={C.gold}/>
                      <Chip label="Gain" value={fmtPct(gainPct)} color={gain>=0?C.teal:C.coral}/>
                      {totalRet>0&&<Chip label="Returns" value={disp(totalRet)} color={C.green}/>}
                    </div>
                    {inv.returns.length>0&&<div style={{marginTop:10}}>
                      <div style={{color:C.textMuted,fontSize:10,marginBottom:5,textTransform:"uppercase",letterSpacing:"0.05em"}}>Return History</div>
                      {inv.returns.map((r,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:C.navyLight,borderRadius:8,padding:"5px 10px",marginBottom:3,fontSize:11}}>
                        <span style={{color:C.textMuted}}>{fmtDate(r.date||r.return_date)} · <span style={{color:C.green,textTransform:"capitalize"}}>{r.type||r.return_type}</span>{r.note&&` · ${r.note}`}</span>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontWeight:600,color:C.teal}}>+{disp(r.amount||parseFloat(r.amount_kes||0))}</span>
                          {r.id&&<button onClick={()=>askConfirm("Delete Return",`Delete this ${r.type||r.return_type} of ${disp(r.amount||parseFloat(r.amount_kes||0))}? The amount will be reversed from the wallet.`,()=>deleteReturn(inv.id,r.id,r.amount||parseFloat(r.amount_kes||0),r.wallet_id))} style={{background:"none",border:"none",color:C.coral,cursor:"pointer",fontSize:11,padding:"2px 4px"}} title="Delete return">🗑</button>}
                        </div>
                      </div>)}
                    </div>}
                  </div>
                  <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:8}}>
                    <Sparkline values={[inv.buyPrice,inv.buyPrice*0.93,inv.buyPrice*1.02,inv.buyPrice*0.97,inv.currentPrice*0.98,inv.currentPrice]} color={gain>=0?C.teal:C.coral} width={80} height={40}/>
                    <button onClick={()=>openEditInv(inv)} style={{background:"none",border:`1px solid ${C.navyLight}`,borderRadius:6,color:C.textMuted,padding:"3px 8px",cursor:"pointer",fontSize:10}}>✏️ Edit</button>
                    <button onClick={()=>askConfirm("Delete Investment",`Delete "${inv.name}"? All return history will also be removed.`,()=>deleteInvestment(inv.id))} style={{background:"none",border:`1px solid ${C.coral}44`,borderRadius:6,color:C.coral,padding:"3px 8px",cursor:"pointer",fontSize:10}}>🗑 Delete</button>
                  </div>
                </div>
              </Card>;
            })}
            {investments.length===0&&<Card style={{textAlign:"center",padding:40}}><div style={{fontSize:36,marginBottom:12}}>📈</div><div style={{color:C.textMuted,fontSize:13}}>No investments yet. Add one to track your portfolio.</div></Card>}
          </div>
        )}

        {/* LOANS  */}
        {tab==="loans"&&(
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
              <div><div style={{fontFamily:"'DM Serif Display',serif",fontSize:24}}>Loans & Debt</div><div style={{color:C.textMuted,fontSize:12}}>Remaining: {disp(totalDebt)}</div></div>
              <div style={{display:"flex",gap:8}}>
                <Btn onClick={()=>{setEditRepay(null);setFRepay({...blankRepay,loanId:loans[0]?.id||"",wallet:wallets[0]?.id||""});setStatementNotice("");openM("repay");}} outline color={C.coral} small>Record Repayment</Btn>
                <Btn onClick={()=>{setEditLoan(null);setFLoan(blankLoan);openM("loan");}}>+ Add Loan</Btn>
              </div>
            </div>
            <div className="grid-3">
              <Chip label="Total Debt" value={disp(totalDebt)} color={C.coral}/>
              <Chip label="Monthly Payments" value={disp(loans.reduce((s,l)=>s+l.monthlyPayment,0))} color={C.gold}/>
              <Chip label="Interest Paid" value={disp(loans.reduce((s,l)=>s+l.repayments.reduce((ss,r)=>ss+(r.interest||0),0),0))} color={C.textMuted}/>
            </div>
            {loans.length===0?<Card style={{textAlign:"center",padding:48}}>
              <div style={{fontSize:36,marginBottom:12}}>🏦</div>
              <div style={{fontWeight:600,fontSize:15,marginBottom:6}}>No loans yet</div>
              <div style={{color:C.textMuted,fontSize:12,marginBottom:16}}>Track loans, repayments, and interest splits.</div>
              <Btn onClick={()=>{setEditLoan(null);setFLoan(blankLoan);openM("loan");}}>+ Add Your First Loan</Btn>
            </Card>:(()=>{
              const activeLoans  = loans.filter(l=>l.remaining>0);
              const settledLoans = loans.filter(l=>l.remaining<=0);
              const renderLoanCard = (l) => {
                const settled=l.remaining<=0;
                const paid=l.principal-l.remaining,pct=l.principal>0?(paid/l.principal)*100:0;
                const monthsLeft=l.monthlyPayment>0?Math.ceil(l.remaining/l.monthlyPayment):0;
                const accent = settled?C.teal:C.coral;
                return<Card key={l.id} style={{borderLeft:`3px solid ${accent}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                    <div><div style={{fontWeight:700,fontSize:15,display:"flex",alignItems:"center",gap:6}}>{l.name}{settled&&<Badge color={C.teal}>✅ Cleared</Badge>}</div><div style={{color:C.textMuted,fontSize:11}}>{l.lender} · {l.rate||l.interest_rate}% p.a. · {l.currency}</div></div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontFamily:"'DM Serif Display',serif",fontSize:22,color:accent}}>{disp(l.remaining)}</div>
                      <div style={{color:C.textMuted,fontSize:10}}>remaining</div>
                      <div style={{display:"flex",gap:5,marginTop:4}}>
                        <button onClick={()=>openEditLoan(l)} style={{background:"none",border:`1px solid ${C.navyLight}`,borderRadius:6,color:C.textMuted,padding:"3px 8px",cursor:"pointer",fontSize:10}}>✏️ Edit</button>
                        <button onClick={()=>askConfirm("Delete Loan",`Delete loan "${l.name}"? All repayment history will also be removed.`,()=>deleteLoan(l.id))} style={{background:"none",border:`1px solid ${C.coral}44`,borderRadius:6,color:C.coral,padding:"3px 8px",cursor:"pointer",fontSize:10}}>🗑 Delete</button>
                      </div>
                    </div>
                  </div>
                  <Bar value={paid} max={l.principal} color={C.teal}/>
                  <div style={{display:"flex",gap:10,marginTop:7,fontSize:11,flexWrap:"wrap"}}>
                    <span style={{color:C.textMuted}}>Paid: <strong style={{color:C.teal}}>{pct.toFixed(0)}%</strong></span>
                    {!settled&&<span style={{color:C.textMuted}}>Monthly: <strong style={{color:C.gold}}>{disp(l.monthlyPayment)}</strong></span>}
                    {l.termMonths&&<span style={{color:C.textMuted}}>Term: <strong style={{color:C.textPrimary}}>{l.termMonths >= 12 ? `${Math.floor(l.termMonths/12)}yr${l.termMonths%12?` ${l.termMonths%12}mo`:""}` : `${l.termMonths}mo`}</strong></span>}
                    {!settled&&<span style={{color:C.textMuted}}>~{monthsLeft} months left</span>}
                    {!settled&&<span style={{color:C.textMuted}}>Next: <strong>{l.nextDue||l.next_due_date}</strong></span>}
                  </div>
                  {l.repayments.length>0&&<div style={{marginTop:10}}>
                    <div style={{color:C.textMuted,fontSize:10,marginBottom:5,textTransform:"uppercase",letterSpacing:"0.05em"}}>Repayment History</div>
                    {l.repayments.map((r,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:C.navyLight,borderRadius:8,padding:"7px 10px",marginBottom:3}}>
                      <div>
                        <div style={{fontSize:12,fontWeight:600}}>{fmtDate(r.date||r.payment_date)} — {disp(r.total||r.total_kes)}</div>
                        <div style={{fontSize:10,color:C.textMuted}}>Principal: {disp(r.principal||r.principal_kes||0)} · Interest: {disp(r.interest||r.interest_kes||0)}</div>
                        {r.attachments?.length>0&&<div style={{fontSize:10,color:C.blue,marginTop:2}}>📎 {r.attachments.join(", ")}</div>}
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <Badge color={C.teal}>Paid</Badge>
                        <button onClick={()=>openEditRepay(l,r)} style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:11,padding:"2px 4px"}} title="Edit repayment">✏️</button>
                        <button onClick={()=>askConfirm("Delete Repayment",`Delete this repayment of ${disp(r.total||r.total_kes||0)}? The amount will be returned to the wallet and loan balance restored.`,()=>deleteRepayment(l.id,r.id,r.total||r.total_kes||0,r.wallet||r.wallet_id))} style={{background:"none",border:"none",color:C.coral,cursor:"pointer",fontSize:11,padding:"2px 4px"}} title="Delete repayment">🗑</button>
                      </div>
                    </div>)}
                  </div>}
                  {!settled&&<div style={{marginTop:10}}><Btn onClick={()=>{setEditRepay(null);setFRepay({...blankRepay,loanId:l.id,wallet:wallets[0]?.id||""});setStatementNotice("");openM("repay");}} outline color={C.coral} style={{width:"100%",padding:"8px 0",fontSize:12}}>+ Record Repayment</Btn></div>}
                </Card>;
              };
              return <>
                {settledLoans.length>0&&<Divider label={`Active Loans${activeLoans.length?` (${activeLoans.length})`:""}`}/>}
                {activeLoans.length===0&&settledLoans.length>0&&<div style={{textAlign:"center",color:C.textFaint,fontSize:13,padding:"16px 0"}}>No active loans — everything's cleared 🎉</div>}
                {activeLoans.map(renderLoanCard)}
                {settledLoans.length>0&&<>
                  <Divider label={`Fully Repaid (${settledLoans.length})`}/>
                  {settledLoans.map(renderLoanCard)}
                </>}
              </>;
            })()}
          </div>
        )}

        {/* RECONCILE  */}
        {tab==="reconcile"&&(
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div><div style={{fontFamily:"'DM Serif Display',serif",fontSize:24}}>Statement Reconciliation</div><div style={{color:C.textMuted,fontSize:12}}>Upload a bank statement CSV to match and import transactions</div></div>
            <>
                <Card>
                  <Field label="Account to Reconcile" value={recoWallet} onChange={v=>{setRecoWallet(v);setRecoRows([]);setRecoFile(null);}} options={[{value:"",label:"Select account…"},...wOpts]}/>
                  <FileUpload label="Bank Statement (CSV)" accept=".csv,.txt" onFile={handleRecoFile} files={recoFile?[recoFile]:[]}/>
                  {recoBusy&&<div style={{color:C.textMuted,fontSize:12}}>Parsing statement…</div>}
                  {recoRows.length>0&&<div style={{background:C.navyLight,borderRadius:8,padding:"8px 12px",fontSize:12,color:C.textMuted}}>Found <strong style={{color:C.teal}}>{recoRows.length}</strong> rows · <strong style={{color:C.teal}}>{recoRows.filter(r=>r.status==="matched").length}</strong> matched · <strong style={{color:C.coral}}>{recoRows.filter(r=>r.status==="unmatched").length}</strong> to import</div>}
                </Card>
                {recoRows.length>0&&<>
                  <div style={{display:"flex",justifyContent:"flex-end"}}><Btn onClick={importAllReco} outline color={C.teal} small>Import All Unmatched</Btn></div>
                  <Card style={{padding:0}}>
                    <div className="reco-header-row" style={{padding:"10px 18px",borderBottom:`1px solid ${C.navyLight}`,display:"grid",gridTemplateColumns:"100px 1fr 120px 110px",gap:10}}>
                      {["Date","Description","Amount","Status"].map(h=><div key={h} style={{color:C.textFaint,fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em"}}>{h}</div>)}
                    </div>
                    {recoRows.map((row,idx)=><div key={idx} className="reco-grid-row" style={{borderBottom:`1px solid ${C.navyLight}`,alignItems:"center",background:row.status==="matched"?C.teal+"08":"transparent"}}>
                      <div className="reco-date" style={{fontSize:11,color:C.textMuted}}>{fmtDate(row.date)}</div>
                      <div className="reco-desc" style={{fontSize:12,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{row.desc||row.description}</div>
                      <div className="reco-amt" style={{fontSize:12,fontWeight:700,color:row.amount>0?C.teal:C.textPrimary}}>{row.amount>0?"+":""}{disp(Math.abs(row.amount))}</div>
                      <div className="reco-status" style={{display:"flex",alignItems:"center",gap:6}}>
                        <Badge color={row.status==="matched"?C.teal:C.coral}>{row.status}</Badge>
                        {row.status==="unmatched"&&<button onClick={()=>importRecoRow(idx)} style={{background:"none",border:"none",color:C.teal,cursor:"pointer",fontSize:11,fontWeight:600}}>Import</button>}
                      </div>
                    </div>)}
                  </Card>
                </>}
                {!recoFile&&<Card style={{textAlign:"center",padding:40}}><div style={{fontSize:36,marginBottom:12}}>📂</div><div style={{fontWeight:600,fontSize:15,marginBottom:6}}>No statement uploaded</div><div style={{color:C.textMuted,fontSize:12,lineHeight:1.7}}>Upload a CSV from KCB, Equity, Co-op, NCBA, or M-Pesa.</div></Card>}
            </>
          </div>
        )}

        {/* INSURANCE  */}
        {tab==="insurance"&&(()=>{
          const POLICY_META = {
            life:              {icon:"🛡️", label:"Life"},
            education:         {icon:"📚", label:"Education"},
            medical:           {icon:"🏥", label:"Medical / NHIF"},
            motor:             {icon:"🚗", label:"Motor"},
            property:          {icon:"🏠", label:"Property"},
            last_expense:      {icon:"🕊️", label:"Last Expense"},
            investment_linked: {icon:"📈", label:"Investment-linked"},
          };
          const toMonthly = (amt,freq) => freq==="monthly"?parseFloat(amt):freq==="quarterly"?parseFloat(amt)/3:parseFloat(amt)/12;
          const nextDue = (startDate,freq) => {
            if(!startDate) return null;
            const start = new Date(startDate); const today = new Date();
            if(today<start) return start;
            const months = freq==="monthly"?1:freq==="quarterly"?3:12;
            let d = new Date(start);
            while(d<=today) d=new Date(d.getFullYear(),d.getMonth()+months,d.getDate());
            return d;
          };
          const daysUntil = (d) => { if(!d) return null; return Math.ceil((d-new Date())/(1000*60*60*24)); };
          const monthsPaid = (startDate,freq) => {
            if(!startDate) return 0;
            const start=new Date(startDate); const today=new Date();
            if(today<start) return 0;
            const elapsed=(today.getFullYear()-start.getFullYear())*12+(today.getMonth()-start.getMonth());
            const freqMo=freq==="monthly"?1:freq==="quarterly"?3:12;
            return Math.floor(elapsed/freqMo)+1;
          };
          const totalMonths = (startDate,endDate) => {
            if(!startDate||!endDate) return null;
            const s=new Date(startDate),e=new Date(endDate);
            return Math.round((e-s)/(1000*60*60*24*30.44));
          };
          const active=policies.filter(p=>p.is_active!==false);
          const totalMonthly=active.reduce((s,p)=>s+toMonthly(p.premium_amount,p.premium_frequency),0);
          const totalAssured=active.reduce((s,p)=>s+(parseFloat(p.sum_assured)||0),0);
          const nearest=active.map(p=>({p,d:nextDue(p.start_date,p.premium_frequency)})).filter(x=>x.d).sort((a,b)=>a.d-b.d)[0];
          return(
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
                <div>
                  <div style={{fontFamily:"'DM Serif Display',serif",fontSize:24}}>Insurance & Protection</div>
                  <div style={{color:C.textMuted,fontSize:12}}>{active.length} active {active.length===1?"policy":"policies"}</div>
                </div>
                <Btn onClick={()=>{setEditPolicy(null);setFPolicy({...blankPolicy,walletId:wallets[0]?.id||""});openM("policy");}}>+ Add Policy</Btn>
              </div>

              {/* Summary strip */}
              {active.length>0&&<div className="grid-2" style={{gap:10}}>
                <Card style={{background:`linear-gradient(135deg,${C.teal}18,${C.teal}05)`}}>
                  <div style={{fontSize:10,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4}}>Monthly Premiums</div>
                  <div style={{fontFamily:"'DM Serif Display',serif",fontSize:22,color:C.teal}}>{disp(totalMonthly)}</div>
                </Card>
                <Card style={{background:`linear-gradient(135deg,${C.blue}18,${C.blue}05)`}}>
                  <div style={{fontSize:10,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4}}>Total Sum Assured</div>
                  <div style={{fontFamily:"'DM Serif Display',serif",fontSize:22,color:C.blue}}>{disp(totalAssured)}</div>
                </Card>
                {nearest&&<Card style={{gridColumn:"1/-1",borderLeft:`3px solid ${daysUntil(nearest.d)<=7?C.coral:C.gold}`}}>
                  <div style={{fontSize:10,color:C.textMuted,marginBottom:2}}>Nearest Premium Due</div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div style={{fontWeight:600,fontSize:13}}>{POLICY_META[nearest.p.policy_type]?.icon} {nearest.p.name} — {nearest.p.provider}</div>
                    <Badge color={daysUntil(nearest.d)<=7?C.coral:C.gold}>{daysUntil(nearest.d)} day{daysUntil(nearest.d)!==1?"s":""}</Badge>
                  </div>
                </Card>}
              </div>}

              {/* Policy cards */}
              {policies.length===0
                ?<Card style={{textAlign:"center",padding:32}}>
                  <div style={{fontSize:36,marginBottom:12}}>🛡️</div>
                  <div style={{fontWeight:600,fontSize:15,marginBottom:6}}>No policies yet</div>
                  <div style={{color:C.textMuted,fontSize:12,marginBottom:16}}>Track your life, education, medical and other insurance policies.</div>
                  <Btn onClick={()=>{setEditPolicy(null);setFPolicy({...blankPolicy,walletId:wallets[0]?.id||""});openM("policy");}}>+ Add Your First Policy</Btn>
                </Card>
                :policies.map(p=>{
                  const meta=POLICY_META[p.policy_type]||{icon:"🛡️",label:p.policy_type};
                  const nd=nextDue(p.start_date,p.premium_frequency);
                  const days=daysUntil(nd);
                  const paid=monthsPaid(p.start_date,p.premium_frequency);
                  const totMo=totalMonths(p.start_date,p.end_date);
                  const trackedPaid=(p.payments||[]).reduce((s,pm)=>s+parseFloat(pm.amount_kes||0),0);
                  const paidAmt=(p.amount_paid!=null?parseFloat(p.amount_paid):0)+trackedPaid;
                  const expectedDue=paid*(parseFloat(p.premium_amount)||0);
                  const balanceDue=Math.max(0,expectedDue-paidAmt);
                  const pct=totMo?Math.min((paid/totMo)*100,100):0;
                  const w=wallets.find(w=>w.id===p.wallet_id);
                  const lapseRisk=w&&parseFloat(w.balance)<parseFloat(p.premium_amount);
                  const freqLabel=p.premium_frequency==="monthly"?"/ mo":p.premium_frequency==="quarterly"?"/ qtr":"/ yr";
                  return(
                    <Card key={p.id} style={{borderLeft:lapseRisk?`3px solid ${C.coral}`:days!=null&&days<=7?`3px solid ${C.gold}`:"3px solid transparent"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                        <div style={{display:"flex",alignItems:"center",gap:10}}>
                          <div style={{width:42,height:42,borderRadius:12,background:C.teal+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>{meta.icon}</div>
                          <div>
                            <div style={{fontWeight:700,fontSize:14}}>{p.name}</div>
                            <div style={{color:C.textMuted,fontSize:11,marginTop:1}}>{meta.label} · {p.provider}</div>
                            {p.policy_number&&<div style={{color:C.textFaint,fontSize:10}}>#{p.policy_number}</div>}
                          </div>
                        </div>
                        <div style={{textAlign:"right",flexShrink:0}}>
                          <div style={{fontWeight:700,fontSize:15,color:C.coral}}>{disp(parseFloat(p.premium_amount)||0)}<span style={{fontSize:11,fontWeight:400,color:C.textMuted}}> {freqLabel}</span></div>
                          {nd&&<div style={{fontSize:10,color:days<=7?C.coral:C.textMuted,marginTop:2}}>Due in {days}d · {nd.toLocaleDateString("en-KE",{day:"numeric",month:"short"})}</div>}
                        </div>
                      </div>

                      {/* Stats row */}
                      <div style={{display:"flex",gap:16,marginBottom:totMo?10:0,flexWrap:"wrap"}}>
                        {p.sum_assured&&<div><div style={{fontSize:10,color:C.textMuted}}>Sum Assured</div><div style={{fontWeight:600,fontSize:12,color:C.blue}}>{disp(parseFloat(p.sum_assured))}</div></div>}
                        {(paidAmt>0)&&<div><div style={{fontSize:10,color:C.textMuted}}>Paid so far</div><div style={{fontWeight:600,fontSize:12,color:C.teal}}>{disp(paidAmt)}</div></div>}
                        {(balanceDue>0)&&<div><div style={{fontSize:10,color:C.textMuted}}>Balance Due</div><div style={{fontWeight:600,fontSize:12,color:C.coral}}>{disp(balanceDue)}</div></div>}
                        {p.surrender_value&&<div><div style={{fontSize:10,color:C.textMuted}}>Surrender Value</div><div style={{fontWeight:600,fontSize:12}}>{disp(parseFloat(p.surrender_value))}</div></div>}
                        {p.beneficiary&&<div><div style={{fontSize:10,color:C.textMuted}}>Beneficiary</div><div style={{fontWeight:600,fontSize:12}}>{p.beneficiary}</div></div>}
                      </div>

                      {/* Progress bar if start + end date known */}
                      {totMo>0&&<>
                        <Bar value={paid} max={totMo} color={C.teal}/>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:C.textFaint,marginTop:4}}>
                          <span>{paid} of {totMo} months paid · {pct.toFixed(0)}%</span>
                          {p.end_date&&<span>Matures {new Date(p.end_date).toLocaleDateString("en-KE",{month:"short",year:"numeric"})}</span>}
                        </div>
                      </>}

                      {lapseRisk&&<div style={{marginTop:8,padding:"6px 10px",background:C.coral+"18",borderRadius:8,fontSize:11,color:C.coral,fontWeight:600}}>⚠ Account balance below next premium — top up {w.name} to avoid lapse</div>}

                      {(p.payments||[]).length>0&&<div style={{marginTop:10}}>
                        <div style={{color:C.textMuted,fontSize:10,marginBottom:5,textTransform:"uppercase",letterSpacing:"0.05em"}}>Payment History</div>
                        {p.payments.map(pm=><div key={pm.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:C.navyLight,borderRadius:8,padding:"7px 10px",marginBottom:3}}>
                          <div>
                            <div style={{fontSize:12,fontWeight:600}}>{fmtDate(pm.payment_date)} — {disp(parseFloat(pm.amount_kes))}</div>
                            {pm.note&&<div style={{fontSize:10,color:C.textMuted}}>{pm.note}</div>}
                          </div>
                          <button onClick={()=>askConfirm("Delete Payment",`Delete this payment of ${disp(parseFloat(pm.amount_kes))}? The amount will be returned to the account.`,()=>deletePremiumPayment(p.id,pm.id,pm.amount_kes,pm.wallet_id))} style={{background:"none",border:"none",color:C.coral,cursor:"pointer",fontSize:11,padding:"2px 4px"}} title="Delete payment">🗑</button>
                        </div>)}
                      </div>}

                      <div style={{display:"flex",gap:6,marginTop:10,flexWrap:"wrap"}}>
                        <Btn onClick={()=>{setFPremiumPayment({...blankPremiumPayment,policyId:p.id,wallet:p.wallet_id||wallets[0]?.id||""});openM("premiumPayment");}} color={C.teal} small>💳 Record Payment</Btn>
                        <Btn onClick={()=>openEditPolicy(p)} outline color={C.blue} small>✏️ Edit</Btn>
                        <Btn onClick={()=>askConfirm("Delete Policy",`Remove "${p.name}"? This cannot be undone.`,()=>deletePolicy(p.id))} outline color={C.coral} small>🗑 Delete</Btn>
                      </div>
                    </Card>
                  );
                })
              }
            </div>
          );
        })()}

        {/* MORE MENU (MOBILE ONLY)  */}
        {tab==="settings"&&<SettingsTab
          user={user} C={C} theme={theme} toggleTheme={toggleTheme}
          baseCurrency={baseCurrency} setBase={setBase} currencies={currencies}
          updateUser={updateUser} showToast={showToast} logout={logout}
          exportTransactions={exportTransactions} openM={openM}
          askConfirm={askConfirm} deactivateAccount={deactivateAccount}
          loadData={loadData}
        />}

        {tab==="admin"&&user?.role==="admin"&&<Suspense fallback={<div style={{textAlign:"center",color:C.textMuted,padding:20,fontSize:13}}>Loading…</div>}><AdminPanel C={C} showToast={showToast}/></Suspense>}

        {tab==="more"&&(
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            <div>
              <div style={{fontFamily:"'DM Serif Display',serif",fontSize:24}}>More Modules</div>
              <div style={{color:C.textMuted,fontSize:12}}>Access other financial tools</div>
            </div>
            <div className="grid-2">
              {[
                { id: "goals",       label: "Savings Goals", icon: "🏆", desc: "Track savings targets" },
                { id: "recurring",   label: "Recurring",     icon: "🔁", desc: "Bills & subscriptions" },
                { id: "investments", label: "Investments",   icon: "📈", desc: "Asset portfolio" },
                { id: "loans",       label: "Loans & Debt",  icon: "🏦", desc: "Track borrowing" },
                { id: "insurance",   label: "Insurance",     icon: "🛡️", desc: "Policies & premiums" },
                { id: "reconcile",   label: "Reconcile",     icon: "✅", desc: "Import bank statement" },
              ].map(item => (
                <Card key={item.id} onClick={() => setTab(item.id)} style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  <div style={{ fontSize: 28 }}>{item.icon}</div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: C.textPrimary }}>{item.label}</div>
                  <div style={{ fontSize: 11, color: C.textMuted }}>{item.desc}</div>
                </Card>
              ))}
            </div>

            <Divider label="Actions & Tools"/>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <Btn onClick={getAI} color={C.gold} style={{width:"100%",padding:12}}>✦ AI Financial Advisor</Btn>
              <div className="grid-2">
                <Btn onClick={()=>{setFXfer({...blankXfer,from:wallets[0]?.id||"",to:wallets[1]?.id||""});openM("xfer");}} outline color={C.blue} style={{padding:12}}>⇄ Transfer</Btn>
                <Btn onClick={()=>openM("share")} outline color={C.purple} style={{padding:12}}>📤 Share App</Btn>
              </div>
              <div className="grid-2">
                <Btn onClick={()=>openM("importExport")} outline color={C.textMuted} style={{padding:12}}>⬆⬇ Import/Export</Btn>
                <button onClick={toggleTheme} style={{background:C.navyLight,border:`1px solid ${C.navyLight}`,borderRadius:10,color:C.textPrimary,padding:12,cursor:"pointer",fontSize:13,fontWeight:700}}>{theme==="dark"?"☀️ Light Mode":"🌙 Dark Mode"}</button>
                <button onClick={()=>setTab("settings")} style={{background:C.navyLight,border:`1px solid ${C.navyLight}`,borderRadius:10,color:C.textPrimary,padding:12,cursor:"pointer",fontSize:13,fontWeight:700}}>⚙️ Settings</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MODALS  */}

      {/* Add / Edit Transaction */}
      <Modal open={isOpen("tx")} onClose={()=>{closeM("tx");setEditTx(null);}} title={editTx?"✏️ Edit Transaction":"Add Transaction"}>
        <Field label="Type" value={fTx.type} onChange={v=>setFTx({...fTx,type:v,category:v==="income"?incCats[0]?.id||"":expCats[0]?.id||""})} options={[{value:"expense",label:"💸 Expense"},{value:"income",label:"💰 Income"}]}/>
        <CatPicker label="Category" value={fTx.category} onChange={v=>setFTx({...fTx,category:v})} categories={fTx.type==="expense"?expCats.filter(c=>c.allocationType!=="percent"&&!c.linkedWalletId):incCats} groupByParent={fTx.type==="expense"}/>
        <Field label="Account" value={fTx.wallet} onChange={v=>setFTx({...fTx,wallet:v})} options={wOpts}/>
        <div className="grid-2">
          <Field label="Date" type="date" value={fTx.date||todayStr()} onChange={v=>setFTx({...fTx,date:v})}/>
          <Field label="Time" type="time" value={fTx.time||nowTimeStr()} onChange={v=>setFTx({...fTx,time:v})}/>
        </div>
        <Field label={fTx.type==="expense"?"Vendor":"Merchant / Source"} value={fTx.merchant} onChange={v=>setFTx({...fTx,merchant:v})} placeholder="e.g. Naivas"/>
        <Field label="Note (optional)" value={fTx.note} onChange={v=>setFTx({...fTx,note:v})} placeholder="e.g. Weekly groceries"/>
        <Field label="Amount" type="number" value={fTx.amount} onChange={v=>setFTx({...fTx,amount:v})} placeholder="0.00" note="In wallet's native currency"/>
        {!editTx&&<><div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,padding:"10px 12px",background:C.navyLight,borderRadius:10}}>
          <input type="checkbox" id="isRecurChk" checked={!!fTx.isRecurring} onChange={e=>setFTx({...fTx,isRecurring:e.target.checked})} style={{accentColor:C.teal,width:16,height:16}}/>
          <label htmlFor="isRecurChk" style={{color:C.textMuted,fontSize:13,cursor:"pointer"}}>🔁 Make recurring</label>
        </div>
        {fTx.isRecurring&&<Field label="Frequency" value={fTx.freq} onChange={v=>setFTx({...fTx,freq:v})} options={[{value:"daily",label:"Daily"},{value:"weekly",label:"Weekly"},{value:"monthly",label:"Monthly"},{value:"yearly",label:"Yearly"}]}/>}</>}
        <Btn onClick={saveTx} style={{width:"100%",padding:13,fontSize:14}}>{editTx?"Save Changes":`Add ${fTx.type==="income"?"Income":"Expense"}`}</Btn>
      </Modal>

      {/* Transfer */}
      <Modal open={isOpen("xfer")} onClose={()=>closeM("xfer")} title="⇄ Transfer Between Accounts">
        <Field label="From" value={fXfer.from} onChange={v=>{
          const newTo = fXfer.to===v ? (wallets.find(w=>w.id!==v)?.id||"") : fXfer.to;
          setFXfer({...fXfer,from:v,to:newTo});
        }} options={wOpts}/>
        <Field label="To" value={fXfer.to} onChange={v=>setFXfer({...fXfer,to:v})} options={wallets.filter(w=>w.id!==fXfer.from).map(w=>({value:w.id,label:`${w.icon} ${w.name}`}))}/>
        <Field label="Amount" type="number" value={fXfer.amount} onChange={v=>setFXfer({...fXfer,amount:v})} placeholder="0.00" note="In source account's currency"/>
        <Field label="Note (optional)" value={fXfer.note} onChange={v=>setFXfer({...fXfer,note:v})} placeholder="e.g. Moving to savings"/>
        <Btn onClick={doTransfer} style={{width:"100%",padding:13,fontSize:14}}>Transfer Funds</Btn>
      </Modal>

      {/* Record Windfall */}
      <Modal open={isOpen("windfall")} onClose={()=>closeM("windfall")} title="🎁 Record Windfall">
        <div style={{fontSize:12,color:C.textMuted,marginBottom:14,lineHeight:1.5}}>Split a one-off amount (bonus, gift) using each category's Windfall %, separate from your monthly income rules.</div>
        <Field label="Source Account" value={fWindfall.fromWallet} onChange={v=>setFWindfall({...fWindfall,fromWallet:v})} options={wOpts}/>
        <Field label={`Windfall Amount (${baseCurrency})`} type="number" value={fWindfall.amount} onChange={v=>setFWindfall({...fWindfall,amount:v})} placeholder="e.g. 50000"/>
        {(()=>{
          const amt = parseFloat(fWindfall.amount)||0;
          const all = expCats.filter(c=>!c.parentId && c.windfallPercent>0);
          const linked = all.filter(c=>c.linkedWalletId);
          const unlinked = all.filter(c=>!c.linkedWalletId);
          if (!all.length) return <div style={{fontSize:11,color:C.coral,marginBottom:14}}>No Primary category has a Windfall % set yet — edit one and add it first.</div>;
          return <div style={{background:C.navyLight,borderRadius:10,padding:"10px 12px",marginBottom:14}}>
            <div style={{fontSize:10,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>Split preview</div>
            {linked.map(c=>(
              <div key={c.id} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"3px 0"}}>
                <span>{c.icon} {c.name} ({c.windfallPercent}%)</span>
                <strong style={{color:C.teal}}>{disp(amt*(c.windfallPercent/100))}</strong>
              </div>
            ))}
            {unlinked.length>0 && <div style={{fontSize:10,color:C.textFaint,marginTop:6}}>Reference only (no linked account, won't be transferred): {unlinked.map(c=>c.name).join(", ")}</div>}
          </div>;
        })()}
        <Btn onClick={recordWindfall} style={{width:"100%",padding:13,fontSize:14}}>Confirm & Split</Btn>
      </Modal>

      {/* Add / Edit Wallet */}
      <Modal open={isOpen("wallet")} onClose={()=>{closeM("wallet");setEditWal(null);}} title={editWal?"✏️ Edit Account":"🏦 Add Account"}>
        <Field label="Account Name" value={fWal.name} onChange={v=>setFWal({...fWal,name:v})} placeholder="e.g. Equity Bank Current"/>
        <Field label="Account Type" value={fWal.accountType} onChange={v=>setFWal({...fWal,accountType:v})} options={[{value:"current",label:"🏦 Current / Checking"},{value:"savings",label:"💰 Savings Account"},{value:"investment",label:"📈 Investment Account"},{value:"cash",label:"👛 Cash Wallet"},{value:"digital",label:"📱 Mobile Money"}]}/>
        <Field label="Currency" value={fWal.currency} onChange={v=>setFWal({...fWal,currency:v})} options={currencies.map(c=>({value:c.code,label:`${c.code} – ${c.name} (${c.symbol})`}))}/>
        <Field label={`Opening Balance (${fWal.currency})`} type="number" value={fWal.openingBalance} onChange={v=>setFWal({...fWal,openingBalance:v})} placeholder="0.00"/>
        {editWal&&<Field label={`Current Balance (${fWal.currency})`} type="number" value={fWal.currentBalance} onChange={v=>setFWal({...fWal,currentBalance:v})} placeholder="0.00"/>}
        <div className="grid-2">
          <Field label="Icon"   value={fWal.icon}  onChange={v=>setFWal({...fWal,icon:v})}  options={ICONS.map(i=>({value:i,label:i}))}/>
          <ColorPicker label="Colour" value={fWal.color} onChange={v=>setFWal({...fWal,color:v})} colors={CAT_COLORS}/>
        </div>
        <Btn onClick={saveWallet} style={{width:"100%",padding:13,fontSize:14}}>{editWal?"Save Changes":"Create Account"}</Btn>
      </Modal>

      {/* ── Install App Instructions Modal (iOS / Desktop) ── */}
      {showInstallModal&&(()=>{
        const isIOS    = /iphone|ipad|ipod/i.test(navigator.userAgent);
        const isAndroid= /android/i.test(navigator.userAgent);
        const steps = isIOS ? [
          { icon:"1️⃣", text: "Open this page in Safari (not Chrome or Firefox)" },
          { icon:"2️⃣", text: "Tap the Share button at the bottom of the screen  ⎙" },
          { icon:"3️⃣", text: 'Scroll down and tap "Add to Home Screen"' },
          { icon:"4️⃣", text: 'Tap "Add" in the top-right corner — done!' },
        ] : isAndroid ? [
          { icon:"1️⃣", text: "Open this page in Chrome" },
          { icon:"2️⃣", text: "Tap the three-dot menu ⋮ at the top-right" },
          { icon:"3️⃣", text: 'Tap "Add to Home screen" or "Install app"' },
          { icon:"4️⃣", text: 'Tap "Add" / "Install" to confirm — done!' },
        ] : [
          { icon:"1️⃣", text: "Open this page in Chrome or Edge" },
          { icon:"2️⃣", text: "Look for the install icon (⊕) in the address bar" },
          { icon:"3️⃣", text: 'Click "Install" in the popup — done!' },
          { icon:"4️⃣", text: "On Firefox: bookmark the page for quick access" },
        ];
        return(
          <Modal open title="📲 Download Pesa Yangu" onClose={()=>{setShowInstallModal(false);snoozeInstallBanner();}}>
            <div style={{textAlign:"center",marginBottom:20}}>
              <div style={{width:64,height:64,background:`linear-gradient(135deg,${C.teal},${C.blue})`,borderRadius:18,display:"flex",alignItems:"center",justifyContent:"center",fontSize:32,margin:"0 auto 12px"}}>◈</div>
              <div style={{fontFamily:"'DM Serif Display',serif",fontSize:20,marginBottom:6}}>Add to your Home Screen</div>
              <div style={{color:C.textMuted,fontSize:13,lineHeight:1.5}}>Pesa Yangu works as a full app on your phone — no app store download needed.</div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:20}}>
              {steps.map((s,i)=>(
                <div key={i} style={{display:"flex",alignItems:"flex-start",gap:12,background:C.navyLight,borderRadius:12,padding:"12px 14px"}}>
                  <span style={{fontSize:20,lineHeight:1,flexShrink:0}}>{s.icon}</span>
                  <span style={{fontSize:13,color:C.textPrimary,lineHeight:1.4}}>{s.text}</span>
                </div>
              ))}
            </div>
            <div style={{background:C.teal+"18",border:`1px solid ${C.teal}33`,borderRadius:12,padding:"10px 14px",fontSize:12,color:C.textMuted,marginBottom:16}}>
              ✅ Once installed, you'll get daily reminders, faster load times, and the app icon on your home screen.
            </div>
            <Btn onClick={()=>{setShowInstallModal(false);snoozeInstallBanner();}} style={{width:"100%",padding:13}}>Got it — I'll install it</Btn>
          </Modal>
        );
      })()}

      {/* Transaction Detail Modal */}
      {txDetail&&(()=>{
        const t=txDetail;
        const isT=t.type?.startsWith("transfer");
        const isRefund=t.type==="refund";
        const catId=t.category||t.category_id;
        const cat=isT?{icon:"⇄",name:"Transfer",color:C.blue}:isRefund?{icon:"↩️",name:"Refund",color:"#9B59B6"}:t.type==="expense"?expCats.find(c=>c.id===catId):incCats.find(c=>c.id===catId);
        const w=wallets.find(w=>w.id===(t.wallet||t.wallet_id));
        const isIn=t.type==="income"||t.type==="transfer_in"||isRefund;
        const amt=t.amount||parseFloat(t.amount_kes||0);
        const ts=txTime(t);
        const label=t.merchant||t.note||"Transaction";
        const hasNote=!!(t.note&&t.merchant);
        return(
          <Modal open={!!txDetail} onClose={()=>setTxDetail(null)} title="Transaction Detail">
            <div style={{textAlign:"center",marginBottom:22,paddingTop:4}}>
              <div style={{width:64,height:64,borderRadius:18,background:(cat?.color||C.teal)+"22",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:30,marginBottom:12}}>{cat?.icon||"💸"}</div>
              <div style={{fontFamily:"'DM Serif Display',serif",fontSize:32,color:isIn?C.teal:C.coral,lineHeight:1}}>{isIn?"+":"−"}{disp(amt)}</div>
              <div style={{fontWeight:600,fontSize:15,marginTop:8,color:C.textPrimary}}>{label}</div>
            </div>
            <div style={{background:C.navyLight,borderRadius:12,padding:"14px 16px",marginBottom:20,display:"flex",flexDirection:"column",gap:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:13}}>
                <span style={{color:C.textMuted}}>Category</span>
                <span style={{fontWeight:600,color:cat?.color||C.textPrimary}}>{cat?.icon} {cat?.name||"—"}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:13}}>
                <span style={{color:C.textMuted}}>Account</span>
                <span style={{fontWeight:600,color:C.textPrimary}}>{w?.name||"—"}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:13}}>
                <span style={{color:C.textMuted}}>Date</span>
                <span style={{fontWeight:600,color:C.textPrimary}}>{fmtDate(t.date||t.tx_date)}{ts?" · "+ts:""}</span>
              </div>
              {hasNote&&<div style={{display:"flex",justifyContent:"space-between",fontSize:13,gap:10}}>
                <span style={{color:C.textMuted,flexShrink:0}}>Note</span>
                <span style={{fontWeight:600,color:C.textPrimary,textAlign:"right"}}>{t.note}</span>
              </div>}
              {t.loanId&&<div style={{display:"flex",justifyContent:"space-between",fontSize:13}}>
                <span style={{color:C.textMuted}}>Linked To</span>
                <Badge color={C.coral}>Loan Repayment</Badge>
              </div>}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {!isT&&!isRefund&&<Btn onClick={()=>{openEditTx(t);setTxDetail(null);}} style={{width:"100%",padding:14,fontSize:14}}>✏️  Edit Transaction</Btn>}
              {isRefund&&<Btn onClick={()=>{openEditRefundModal(t);setTxDetail(null);}} style={{width:"100%",padding:14,fontSize:14}}>✏️  Edit Refund</Btn>}
              {t.type==="expense"&&<Btn onClick={()=>{openRefundModal(t);setTxDetail(null);}} color="#9B59B6" style={{width:"100%",padding:14,fontSize:14}}>↩  Record Refund</Btn>}
              <Btn onClick={()=>{askConfirm(isT?"Delete Transfer":"Delete Transaction",isT?"Both sides of this transfer will be deleted and wallet balances reversed. This cannot be undone.":"This transaction will be permanently deleted and your account balance will be adjusted. This cannot be undone.",()=>{deleteTx(t.id);setTxDetail(null);});}} color={C.coral} outline style={{width:"100%",padding:14,fontSize:14}}>🗑  Delete</Btn>
            </div>
          </Modal>
        );
      })()}

      {/* Category History Modal */}
      {catHistory&&(()=>{
        const {cat,type}=catHistory;
        const records=txs
          .filter(t=>(t.category||t.category_id)===cat.id)
          .sort((a,b)=>new Date(b.tx_date||b.date)-new Date(a.tx_date||a.date));
        const total=records.reduce((s,t)=>s+(t.amount||parseFloat(t.amount_kes||0)),0);
        const walletName=(t)=>wallets.find(w=>w.id===(t.wallet||t.wallet_id))?.name||"";
        return(
          <Modal open={!!catHistory} onClose={()=>setCatHistory(null)} title={`${cat.icon} ${cat.name}`}>
            <div style={{background:cat.color+"18",borderRadius:12,padding:"14px 16px",marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div>
                  <div style={{fontSize:10,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:2}}>Total {type==="expense"?"Spent":"Earned"}</div>
                  <div style={{fontFamily:"'DM Serif Display',serif",fontSize:26,color:type==="expense"?C.coral:C.teal,lineHeight:1}}>{type==="expense"?"-":""}{disp(total)}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:10,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:2}}>Transactions</div>
                  <div style={{fontWeight:700,fontSize:20,color:cat.color}}>{records.length}</div>
                </div>
              </div>
              {records.length>1&&<div style={{marginTop:8,paddingTop:8,borderTop:`1px solid ${cat.color}33`,display:"flex",gap:16}}>
                <div><div style={{fontSize:9,color:C.textMuted}}>AVERAGE</div><div style={{fontWeight:600,fontSize:12}}>{disp(total/records.length)}</div></div>
                <div><div style={{fontSize:9,color:C.textMuted}}>LARGEST</div><div style={{fontWeight:600,fontSize:12}}>{disp(Math.max(...records.map(t=>t.amount||parseFloat(t.amount_kes||0))))}</div></div>
              </div>}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:420,overflowY:"auto"}}>
              {records.map(t=>{
                const amt=t.amount||parseFloat(t.amount_kes||0);
                const wn=walletName(t);
                const ts=txTime(t);
                return(
                  <div key={t.id} onClick={()=>setTxDetail(t)}
                    onMouseEnter={e=>e.currentTarget.style.background=C.navyMid}
                    onMouseLeave={e=>e.currentTarget.style.background=C.navyLight}
                    style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:C.navyLight,borderRadius:10,cursor:"pointer"}}>
                    <div style={{width:6,height:36,borderRadius:3,background:cat.color,flexShrink:0}}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:600,fontSize:13,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{t.merchant||t.note||cat.name}</div>
                      <div style={{fontSize:10,color:C.textMuted,marginTop:2}}>
                        {fmtDate(t.date||t.tx_date)}{ts?" · "+ts:""}{wn?" · "+wn:""}
                        {t.note&&t.merchant&&<span style={{marginLeft:4,fontStyle:"italic"}}>— {t.note}</span>}
                      </div>
                    </div>
                    <div style={{fontWeight:700,fontSize:14,color:type==="expense"?C.coral:C.teal,flexShrink:0}}>{type==="expense"?"-":""}{disp(amt)}</div>
                  </div>
                );
              })}
              {records.length===0&&<div style={{textAlign:"center",color:C.textMuted,fontSize:13,padding:32}}>No transactions yet</div>}
            </div>
          </Modal>
        );
      })()}

      {/* Add / Edit Expense Category */}
      <Modal open={isOpen("expCat")} onClose={()=>{closeM("expCat");setFExpCat(blankExpCat);}} title={fExpCat.id?"✏️ Edit Category":"🏷️ New Expense Category"}>
        <Field label="Category Name" value={fExpCat.name} onChange={v=>setFExpCat({...fExpCat,name:v})} placeholder="e.g. Pet Care"/>
        <div className="grid-2">
          <Field label="Icon"   value={fExpCat.icon}  onChange={v=>setFExpCat({...fExpCat,icon:v})}  options={ICONS.map(i=>({value:i,label:i}))}/>
          <ColorPicker label="Colour" value={fExpCat.color} onChange={v=>setFExpCat({...fExpCat,color:v})} colors={CAT_COLORS}/>
        </div>
        {user.budget_mode==="percentage" && (()=>{
          // catKind is its own tracked field (not derived from allocationType/linkedWalletId) —
          // deriving it from linkedWalletId meant "Primary Allocation" could never be selected,
          // since no wallet is linked yet the moment you pick it, so it always snapped back to
          // "Parent Category". The wallet link is optional for Primary, so it must be possible
          // to be in the "primary" kind with no wallet chosen yet.
          const catKind = fExpCat.kind || "spending";
          const setKind = (kind) => setFExpCat({
            ...fExpCat,
            kind,
            allocationType: kind==="spending" ? "fixed" : "percent",
            linkedWalletId: kind==="primary" ? fExpCat.linkedWalletId : null,
          });
          return <>
            <div style={{display:"flex",gap:8,marginBottom:14}}>
              {[{key:"primary",label:"Primary Allocation"},{key:"parent",label:"Parent Category"},{key:"spending",label:"Spending Category"}].map(k=>(
                <button key={k.key} onClick={()=>setKind(k.key)} style={{flex:1,background:catKind===k.key?C.teal+"22":C.navyLight,border:`2px solid ${catKind===k.key?C.teal:"transparent"}`,borderRadius:10,padding:"8px 6px",cursor:"pointer",color:catKind===k.key?C.teal:C.textMuted,fontSize:10,fontWeight:600}}>{k.label}</button>
              ))}
            </div>
            <div style={{fontSize:11,color:C.textMuted,marginTop:-8,marginBottom:14}}>
              {catKind==="primary" && "A slice of income (e.g. Tithe, Tax Reserve) — optionally moved into its own account, not spent."}
              {catKind==="parent" && "Groups sub-categories together (e.g. Family & House) — its cap is a % of its own parent."}
              {catKind==="spending" && "Where you actually record transactions (e.g. Groceries, Rent) — a flat cap."}
            </div>
            {catKind==="primary" && (
              <Field label="Linked Account (optional)" value={fExpCat.linkedWalletId||""} onChange={v=>setFExpCat({...fExpCat,linkedWalletId:v||null})}
                options={[{value:"",label:"— None —"},...wallets.map(w=>({value:w.id,label:`${w.icon} ${w.name}`}))]}/>
            )}
            {catKind==="primary" && (
              <Field label="Windfall Share (%) — optional" type="number" value={fExpCat.windfallPercent} onChange={v=>setFExpCat({...fExpCat,windfallPercent:v})}
                placeholder="e.g. 30" note="Used only when you record a one-off windfall (bonus, gift) — a separate split from your monthly income rule."/>
            )}
            {catKind==="primary" && fExpCat.linkedWalletId && (
              <div className="grid-2">
                <Field label={`Savings Target (${baseCurrency}, optional)`} type="number" value={fExpCat.goalTarget} onChange={v=>setFExpCat({...fExpCat,goalTarget:v})} placeholder="e.g. 300000"/>
                <Field label="Target Date (optional)" type="date" value={fExpCat.goalDeadline} onChange={v=>setFExpCat({...fExpCat,goalDeadline:v})}/>
              </div>
            )}
            <CatPicker label="Parent Category (optional)" value={fExpCat.parentId||""} onChange={v=>setFExpCat({...fExpCat,parentId:v||null})}
              categories={[{id:"",name:"— None (top level) —",icon:"—",color:C.textMuted,parentId:null}, ...expCats.filter(c=>c.id!==fExpCat.id && !getDescendantIds(fExpCat.id||"__none__").includes(c.id))]}
              groupByParent/>
          </>;
        })()}
        {fExpCat.allocationType==="percent"
          ? <Field label={`Percent of ${fExpCat.parentId ? (catsById[fExpCat.parentId]?.name||"parent") : "Income"} (%)`} type="number" value={fExpCat.percentOfParent} onChange={v=>setFExpCat({...fExpCat,percentOfParent:v})} placeholder="e.g. 10"/>
          : <Field label={`Monthly Budget (${baseCurrency})`} type="number" value={fExpCat.budget} onChange={v=>setFExpCat({...fExpCat,budget:v})} placeholder="0 = no budget"/>}
        {user.budget_mode==="percentage" && fExpCat.parentId && fExpCat.allocationType==="fixed" && (
          <div style={{display:"flex",gap:8,marginBottom:14}}>
            {[{key:"fixed",label:"Fixed cost"},{key:"variable",label:"Variable cost"}].map(k=>(
              <button key={k.key} onClick={()=>setFExpCat({...fExpCat,spendKind:k.key})} style={{flex:1,background:fExpCat.spendKind===k.key?C.gold+"22":C.navyLight,border:`2px solid ${fExpCat.spendKind===k.key?C.gold:"transparent"}`,borderRadius:10,padding:"8px 10px",cursor:"pointer",color:fExpCat.spendKind===k.key?C.gold:C.textMuted,fontSize:11,fontWeight:600}}>{k.label}</button>
            ))}
          </div>
        )}
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,padding:"10px 12px",background:C.navyLight,borderRadius:10}}>
          <input type="checkbox" id="watchChk" checked={!!fExpCat.watch} onChange={e=>setFExpCat({...fExpCat,watch:e.target.checked})} style={{accentColor:C.gold,width:16,height:16}}/>
          <label htmlFor="watchChk" style={{color:C.textMuted,fontSize:13,cursor:"pointer"}}>👁 Watch on Dashboard</label>
        </div>
        <Btn onClick={addExpCat} style={{width:"100%",padding:13,fontSize:14}}>{fExpCat.id?"Save Changes":"Add Category"}</Btn>
      </Modal>

      {/* Add Income Category */}
      <Modal open={isOpen("incCat")} onClose={()=>closeM("incCat")} title="💵 New Income Category">
        <Field label="Category Name" value={fIncCat.name} onChange={v=>setFIncCat({...fIncCat,name:v})} placeholder="e.g. Consulting"/>
        <div className="grid-2">
          <Field label="Icon"   value={fIncCat.icon}  onChange={v=>setFIncCat({...fIncCat,icon:v})}  options={ICONS.map(i=>({value:i,label:i}))}/>
          <ColorPicker label="Colour" value={fIncCat.color} onChange={v=>setFIncCat({...fIncCat,color:v})} colors={CAT_COLORS}/>
        </div>
        <Field label={`Monthly Target (${baseCurrency})`} type="number" value={fIncCat.budget} onChange={v=>setFIncCat({...fIncCat,budget:v})} placeholder="0 = no target"/>
        <Btn onClick={addIncCat} style={{width:"100%",padding:13,fontSize:14}}>Add Category</Btn>
      </Modal>

      {/* Set Budget */}
      <Modal open={isOpen("budget")} onClose={()=>closeM("budget")} title={fBudget.catType==="expense"?"🎯 Set Budget":"🎯 Set Income Target"}>
        {(()=>{const cat=fBudget.catType==="expense"?expCats.find(c=>c.id===fBudget.catId):incCats.find(c=>c.id===fBudget.catId);return cat?<div style={{background:C.navyLight,borderRadius:10,padding:"10px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:22}}>{cat.icon}</span><div><div style={{fontWeight:600,fontSize:13}}>{cat.name}</div><div style={{fontSize:11,color:C.textMuted}}>Current: {cat.budget>0?disp(cat.budget):"None"}</div></div></div>:null;})()}
        <Field label={`${fBudget.catType==="expense"?"Budget":"Target"} (${baseCurrency})`} type="number" value={fBudget.amount} onChange={v=>setFBudget({...fBudget,amount:v})} placeholder="0.00" note="Set to 0 to remove"/>
        {fBudget.catType==="expense"&&<div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,padding:"10px 12px",background:C.navyLight,borderRadius:10}}>
          <input type="checkbox" id="everyMonthChk" checked={fBudget.everyMonth} onChange={e=>setFBudget({...fBudget,everyMonth:e.target.checked})} style={{accentColor:C.teal,width:16,height:16}}/>
          <label htmlFor="everyMonthChk" style={{color:C.textMuted,fontSize:12,cursor:"pointer"}}>Use this budget every month until I change it — uncheck to set it just for {MONTH_NAMES[budgetMonth-1]} {budgetYear}</label>
        </div>}
        <Btn onClick={saveBudget} style={{width:"100%",padding:13,fontSize:14}}>Save</Btn>
        {fBudget.catType==="expense"&&monthlyOverrides[fBudget.catId]!=null&&<Btn onClick={()=>clearMonthlyOverride(fBudget.catId)} outline color={C.textMuted} style={{width:"100%",padding:11,fontSize:13,marginTop:8}}>Remove {MONTH_NAMES[budgetMonth-1]} override — use the default every month</Btn>}
      </Modal>

      {/* Add / Edit Insurance Policy */}
      <Modal open={isOpen("policy")} onClose={()=>{closeM("policy");setEditPolicy(null);}} title={editPolicy?"✏️ Edit Policy":"🛡️ Add Insurance Policy"}>
        <Field label="Policy Name" value={fPolicy.name} onChange={v=>setFPolicy({...fPolicy,name:v})} placeholder="e.g. Britam Education Plan – Aisha"/>
        <Field label="Provider" value={fPolicy.provider} onChange={v=>setFPolicy({...fPolicy,provider:v})} placeholder="e.g. Britam, Jubilee, CIC, NHIF"/>
        <div className="grid-2">
          <Field label="Policy Type" value={fPolicy.policyType} onChange={v=>setFPolicy({...fPolicy,policyType:v})} options={[
            {value:"life",label:"🛡️ Life"},{value:"education",label:"📚 Education"},
            {value:"medical",label:"🏥 Medical / NHIF"},{value:"motor",label:"🚗 Motor"},
            {value:"property",label:"🏠 Property"},{value:"last_expense",label:"🕊️ Last Expense"},
            {value:"investment_linked",label:"📈 Investment-linked"},
          ]}/>
          <Field label="Policy Number (optional)" value={fPolicy.policyNumber} onChange={v=>setFPolicy({...fPolicy,policyNumber:v})} placeholder="e.g. BL-2024-001"/>
        </div>
        <div className="grid-2">
          <Field label={`Premium Amount (${fPolicy.currency})`} type="number" value={fPolicy.premiumAmount} onChange={v=>setFPolicy({...fPolicy,premiumAmount:v})} placeholder="0.00"/>
          <Field label="Frequency" value={fPolicy.premiumFreq} onChange={v=>setFPolicy({...fPolicy,premiumFreq:v})} options={[{value:"monthly",label:"Monthly"},{value:"quarterly",label:"Quarterly"},{value:"annually",label:"Annually"}]}/>
        </div>
        <div className="grid-2">
          <Field label="Start Date" type="date" value={fPolicy.startDate} onChange={v=>setFPolicy({...fPolicy,startDate:v})}/>
          <Field label="Maturity / Expiry Date" type="date" value={fPolicy.endDate} onChange={v=>setFPolicy({...fPolicy,endDate:v})}/>
        </div>
        <div className="grid-2">
          <Field label={`Sum Assured (${fPolicy.currency})`} type="number" value={fPolicy.sumAssured} onChange={v=>setFPolicy({...fPolicy,sumAssured:v})} placeholder="Payout on maturity/claim"/>
          <Field label={`Surrender Value (${fPolicy.currency})`} type="number" value={fPolicy.surrenderValue} onChange={v=>setFPolicy({...fPolicy,surrenderValue:v})} placeholder="Current cash-out value"/>
        </div>
        <Field label={`Opening Balance Paid (${fPolicy.currency})`} type="number" value={fPolicy.amountPaid} onChange={v=>setFPolicy({...fPolicy,amountPaid:v})} placeholder="Premiums paid before you started tracking here" note="Optional — a starting figure for payments made before this policy was added. New payments are recorded with the Record Payment button and added on top of this automatically."/>
        <Field label="Beneficiary (optional)" value={fPolicy.beneficiary} onChange={v=>setFPolicy({...fPolicy,beneficiary:v})} placeholder="e.g. Jane Mwangi (spouse)"/>
        <Field label="Linked Account (premium source)" value={fPolicy.walletId} onChange={v=>setFPolicy({...fPolicy,walletId:v})} options={[{value:"",label:"None"},...wallets.map(w=>({value:w.id,label:`${w.icon} ${w.name}`}))]}/>
        <Field label="Currency" value={fPolicy.currency} onChange={v=>setFPolicy({...fPolicy,currency:v})} options={currencies.map(c=>({value:c.code,label:`${c.code} – ${c.name}`}))}/>
        <Field label="Notes (optional)" value={fPolicy.notes} onChange={v=>setFPolicy({...fPolicy,notes:v})} placeholder="Any extra details"/>
        <Btn onClick={savePolicy} style={{width:"100%",padding:13,fontSize:14}}>{editPolicy?"Save Changes":"Add Policy"}</Btn>
      </Modal>

      {/* Record Premium Payment */}
      <Modal open={isOpen("premiumPayment")} onClose={()=>closeM("premiumPayment")} title="💳 Record Premium Payment">
        <Field label="Pay From Account" value={fPremiumPayment.wallet} onChange={v=>setFPremiumPayment({...fPremiumPayment,wallet:v})} options={wOpts}/>
        <Field label="Amount" type="number" value={fPremiumPayment.amount} onChange={v=>setFPremiumPayment({...fPremiumPayment,amount:v})} placeholder="e.g. 5000"/>
        <Field label="Payment Date" type="date" value={fPremiumPayment.date} onChange={v=>setFPremiumPayment({...fPremiumPayment,date:v})}/>
        <Field label="Note (optional)" value={fPremiumPayment.note} onChange={v=>setFPremiumPayment({...fPremiumPayment,note:v})} placeholder="e.g. July premium"/>
        <Btn onClick={recordPremiumPayment} style={{width:"100%",padding:13,fontSize:14}}>Record Payment</Btn>
      </Modal>

      {/* Add / Edit Loan */}
      <Modal open={isOpen("loan")} onClose={()=>{closeM("loan");setEditLoan(null);}} title={editLoan?"✏️ Edit Loan":"🏦 Add Loan"}>
        <Field label="Loan Name" value={fLoan.name}   onChange={v=>setFLoan({...fLoan,name:v})}   placeholder="e.g. KCB Personal Loan"/>
        <Field label="Lender"    value={fLoan.lender} onChange={v=>setFLoan({...fLoan,lender:v})} placeholder="e.g. KCB Bank"/>
        <Field label="Currency"  value={fLoan.currency} onChange={v=>setFLoan({...fLoan,currency:v})} options={currencies.map(c=>({value:c.code,label:`${c.code} – ${c.name}`}))}/>
        <div className="grid-2">
          <Field label={`Principal (${fLoan.currency})`} type="number" value={fLoan.principal} onChange={v=>setFLoan({...fLoan,principal:v,currentBalance:v})} placeholder="e.g. 500000"/>
          <Field label="Rate (%)" type="number" value={fLoan.rate} onChange={v=>setFLoan({...fLoan,rate:v})} placeholder="e.g. 10"/>
        </div>
        <div className="grid-2">
          <Field label={`Current Balance (${fLoan.currency})`} type="number" value={fLoan.currentBalance} onChange={v=>setFLoan({...fLoan,currentBalance:v})} placeholder="Outstanding amount" note={!editLoan?"Leave same as principal if no repayments yet":undefined}/>
          <Field label="Loan Term (months)" type="number" value={fLoan.termMonths} onChange={v=>setFLoan({...fLoan,termMonths:v})} placeholder="e.g. 36" note="e.g. 12 = 1 yr, 36 = 3 yrs"/>
        </div>
        {!editLoan&&<Field label="Interest Type" value={fLoan.interestType} onChange={v=>setFLoan({...fLoan,interestType:v})} options={[{value:"compound",label:"📈 Compound — interest accrues over time"},{value:"simple",label:"📋 Simple — fixed total from the start"}]}/>}
        {(()=>{
          const p=parseFloat(fLoan.principal), r=parseFloat(fLoan.rate);
          if(!p||!r) return null;
          if(fLoan.interestType==="simple") {
            const total=p*(1+r/100);
            return <div style={{background:"#00D4AA11",border:"1px solid #00D4AA33",borderRadius:10,padding:"10px 14px",marginBottom:12,fontSize:12,color:C.textMuted}}>
              📋 Simple interest: you will repay a fixed total of <strong style={{color:C.teal}}>{fLoan.currency} {total.toLocaleString("en-KE",{minimumFractionDigits:0,maximumFractionDigits:0})}</strong> ({fLoan.currency} {p.toLocaleString()} principal + {fLoan.currency} {(total-p).toLocaleString()} interest) — regardless of when you pay.
            </div>;
          }
          return null;
        })()}
        <div className="grid-2">
          <Field label={`Monthly Payment (${fLoan.currency})`} type="number" value={fLoan.monthlyPayment} onChange={v=>setFLoan({...fLoan,monthlyPayment:v})} placeholder="0"/>
          <Field label="Next Due Date" type="date" value={fLoan.nextDue} onChange={v=>setFLoan({...fLoan,nextDue:v})}/>
        </div>
        {fLoan.interestType!=="simple"&&fLoan.principal&&fLoan.monthlyPayment&&<div style={{background:C.navyLight,borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:12,color:C.textMuted}}>💡 Estimated payoff: <strong style={{color:C.teal}}>{Math.ceil(parseFloat(fLoan.principal)/parseFloat(fLoan.monthlyPayment))} months</strong></div>}
        <Btn onClick={saveLoan} style={{width:"100%",padding:13,fontSize:14}}>{editLoan?"Save Changes":"Add Loan"}</Btn>
      </Modal>

      {/* Record / Edit Repayment */}
      <Modal open={isOpen("repay")} onClose={()=>{closeM("repay");setEditRepay(null);setStatementNotice("");}} title={editRepay?"✏️ Edit Repayment":"💳 Record Loan Repayment"}>
        {!editRepay&&<Field label="Loan" value={fRepay.loanId} onChange={v=>setFRepay({...fRepay,loanId:v})} options={loanOpts}/>}
        {(()=>{
          const l=loans.find(ln=>ln.id===fRepay.loanId);
          if(!l) return null;
          const isSimple = l.interest_type==="simple";
          return <>
            <div style={{background:C.navyLight,borderRadius:8,padding:"8px 12px",marginBottom:12,fontSize:11,color:C.textMuted}}>
              Outstanding: <strong style={{color:C.coral}}>{disp(l.remaining)}</strong>
              {isSimple
                ? <span style={{marginLeft:8,color:"#00D4AA",fontWeight:600}}>📋 Simple interest — total is fixed</span>
                : <span> · Monthly: <strong style={{color:C.gold}}>{disp(l.monthlyPayment)}</strong></span>}
            </div>
            <Field label="Payment Date" type="date" value={fRepay.date} onChange={v=>setFRepay({...fRepay,date:v})}/>
            <Field label="Pay From Account" value={fRepay.wallet} onChange={v=>setFRepay({...fRepay,wallet:v})} options={wOpts}/>
            <Divider label="Payment Amount"/>
            <Field label="Amount Paid" type="number" value={fRepay.total} onChange={v=>setFRepay({...fRepay,total:v,principal:isSimple?"0":String((parseFloat(v)||0)-(parseFloat(fRepay.interest)||0)),interest:isSimple?"0":fRepay.interest})} placeholder={isSimple?`e.g. ${disp(l.remaining)} (full balance)`:"e.g. 15000"}/>
            {l.remaining>0&&<button onClick={()=>setFRepay({...fRepay,total:String(l.remaining),principal:isSimple?"0":String(l.remaining),interest:"0"})}
              style={{background:"none",border:`1px solid ${C.teal}`,borderRadius:8,color:C.teal,padding:"7px 14px",cursor:"pointer",fontSize:12,fontWeight:600,marginBottom:14}}>💯 Pay Full Balance ({disp(l.remaining)})</button>}
            {!isSimple&&<div className="grid-2">
              <Field label="Principal Portion" type="number" value={fRepay.principal} onChange={v=>setFRepay({...fRepay,principal:v})} placeholder="0.00"/>
              <Field label="Interest Portion"  type="number" value={fRepay.interest}  onChange={v=>{const int=parseFloat(v)||0,tot=parseFloat(fRepay.total)||0;setFRepay({...fRepay,interest:v,principal:String((tot-int).toFixed(2))});}} placeholder="0.00"/>
            </div>}
            {isSimple&&<div style={{background:"#00D4AA11",borderRadius:8,padding:"8px 12px",marginBottom:12,fontSize:11,color:C.textMuted}}>
              The amount you enter reduces your outstanding balance directly. No principal/interest split needed.
            </div>}
          </>;
        })()}
        <Field label="Note (optional)" value={fRepay.note} onChange={v=>setFRepay({...fRepay,note:v})} placeholder="e.g. June repayment"/>
        {!editRepay&&<><Divider label="Attachments"/>
          <FileUpload label="Repayment Plan / Statement" accept=".pdf,.csv,.jpg,.png" onFile={handleRepayStatementFile} files={fRepay.files}/>
          {parsingStatement&&<div style={{color:C.textMuted,fontSize:12,marginTop:-6,marginBottom:12}}>⏳ Reading statement…</div>}
          {!parsingStatement&&statementNotice&&<div style={{color:C.gold,fontSize:12,marginTop:-6,marginBottom:12}}>ℹ️ {statementNotice}</div>}
        </>}
        <Btn onClick={saveRepayment} style={{width:"100%",padding:13,fontSize:14}}>{editRepay?"Save Changes":"Record Repayment"}</Btn>
      </Modal>

      {/* Add / Edit Investment */}
      <Modal open={isOpen("inv")} onClose={()=>{closeM("inv");setEditInv(null);}} title={editInv?"✏️ Edit Investment":"📈 Add Investment"}>
        <Field label="Name" value={fInv.name} onChange={v=>setFInv({...fInv,name:v})} placeholder="e.g. Safaricom PLC"/>
        <div className="grid-2">
          <Field label="Ticker" value={fInv.ticker} onChange={v=>setFInv({...fInv,ticker:v})} placeholder="e.g. SCOM"/>
          <Field label="Type" value={fInv.type} onChange={v=>setFInv({...fInv,type:v})} options={[{value:"Stock",label:"📊 Stock"},{value:"ETF",label:"📦 ETF"},{value:"Bond",label:"📜 Bond"},{value:"Money Mkt",label:"🏦 Money Market"},{value:"REIT",label:"🏢 REIT"},{value:"Crypto",label:"₿ Crypto"},{value:"Other",label:"💼 Other"}]}/>
        </div>
        <Field label="Currency" value={fInv.currency} onChange={v=>setFInv({...fInv,currency:v})} options={currencies.map(c=>({value:c.code,label:`${c.code} – ${c.name}`}))}/>
        <div className="grid-2">
          <Field label="Units / Shares" type="number" value={fInv.units} onChange={v=>setFInv({...fInv,units:v})} placeholder="e.g. 1000"/>
          <Field label={`Buy Price (${fInv.currency})`} type="number" value={fInv.buyPrice} onChange={v=>setFInv({...fInv,buyPrice:v})} placeholder="e.g. 22.50"/>
        </div>
        {editInv&&<Field label={`Current Price (${fInv.currency})`} type="number" value={fInv.currentPrice||""} onChange={v=>setFInv({...fInv,currentPrice:v})} placeholder="e.g. 24.00" note="Updates portfolio value"/>}
        <Field label="Linked Account" value={fInv.wallet} onChange={v=>setFInv({...fInv,wallet:v})} options={wOpts}/>
        <Btn onClick={saveInvestment} style={{width:"100%",padding:13,fontSize:14}}>{editInv?"Save Changes":"Add Investment"}</Btn>
      </Modal>

      {/* Record Return */}
      <Modal open={isOpen("ret")} onClose={()=>closeM("ret")} title="💹 Record Investment Return">
        <Field label="Investment" value={fRet.investmentId} onChange={v=>setFRet({...fRet,investmentId:v})} options={invOpts}/>
        <Field label="Return Type" value={fRet.type} onChange={v=>setFRet({...fRet,type:v})} options={[{value:"interest",label:"💰 Interest"},{value:"dividend",label:"💹 Dividend"},{value:"capital_gain",label:"📈 Capital Gain"},{value:"coupon",label:"📜 Coupon"},{value:"other",label:"💵 Other"}]}/>
        <div className="grid-2">
          <Field label="Amount" type="number" value={fRet.amount} onChange={v=>setFRet({...fRet,amount:v})} placeholder="0.00"/>
          <Field label="Date" type="date" value={fRet.date} onChange={v=>setFRet({...fRet,date:v})}/>
        </div>
        <Field label="Credit to Account" value={fRet.wallet} onChange={v=>setFRet({...fRet,wallet:v})} options={wOpts}/>
        <Field label="Note (optional)" value={fRet.note} onChange={v=>setFRet({...fRet,note:v})} placeholder="e.g. Q2 dividend"/>
        <Btn onClick={addReturn} style={{width:"100%",padding:13,fontSize:14}}>Record Return</Btn>
      </Modal>

      {/* New / Edit Goal */}
      <Modal open={isOpen("goal")} onClose={()=>{closeM("goal");setEditGoal(null);}} title={editGoal?"✏️ Edit Goal":"🏆 New Savings Goal"}>
        <Field label="Goal Name" value={fGoal.name} onChange={v=>setFGoal({...fGoal,name:v})} placeholder="e.g. Emergency Fund"/>
        <div className="grid-2">
          <Field label="Icon"   value={fGoal.icon}  onChange={v=>setFGoal({...fGoal,icon:v})}  options={ICONS.map(i=>({value:i,label:i}))}/>
          <ColorPicker label="Colour" value={fGoal.color} onChange={v=>setFGoal({...fGoal,color:v})} colors={CAT_COLORS}/>
        </div>
        <Field label={`Target Amount (${baseCurrency})`} type="number" value={fGoal.target} onChange={v=>setFGoal({...fGoal,target:v})} placeholder="e.g. 450000"/>
        <Field label="Receiving Account" value={fGoal.wallet} onChange={v=>setFGoal({...fGoal,wallet:v})} options={wOpts} note="Where money for this goal actually sits — top-ups move money into this account from wherever you choose."/>
        {!editGoal&&(
          <div style={{background:"#00D4AA11",border:"1px solid #00D4AA33",borderRadius:10,padding:"10px 14px",marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,color:"#00D4AA",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6}}>Already saving for this goal?</div>
            <Field label={`Opening Balance (${baseCurrency}) — optional`} type="number" value={fGoal.openingBalance||""} onChange={v=>setFGoal({...fGoal,openingBalance:v})} placeholder="e.g. 15000" note="Bookkeeping only — for money you already have sitting in the receiving account. Nothing moves and no transaction is created."/>
          </div>
        )}
        <Field label="Target Date" type="date" value={fGoal.deadline} onChange={v=>setFGoal({...fGoal,deadline:v})}/>
        <Btn onClick={saveGoal} style={{width:"100%",padding:13,fontSize:14}}>{editGoal?"Save Changes":"Create Goal"}</Btn>
      </Modal>

      {/* Add Recurring */}
      <Modal open={isOpen("recur")} onClose={()=>closeM("recur")} title="➕ Add Recurring Transaction">
        <Field label="Type" value={fRecur.type} onChange={v=>setFRecur({...fRecur,type:v,category:v==="income"?incCats[0]?.id||"":expCats[0]?.id||""})} options={[{value:"expense",label:"💸 Expense"},{value:"income",label:"💰 Income"}]}/>
        <Field label="Category" value={fRecur.category} onChange={v=>setFRecur({...fRecur,category:v})} options={(fRecur.type==="expense"?expCats:incCats).slice().sort((a,b)=>a.name.localeCompare(b.name)).map(c=>({value:c.id,label:`${c.icon} ${c.name}`}))}/>
        <div className="grid-2">
          <Field label="Amount" type="number" value={fRecur.amount} onChange={v=>setFRecur({...fRecur,amount:v})} placeholder="0.00"/>
          <Field label="Frequency" value={fRecur.freq} onChange={v=>setFRecur({...fRecur,freq:v})} options={[{value:"daily",label:"Daily"},{value:"weekly",label:"Weekly"},{value:"monthly",label:"Monthly"},{value:"yearly",label:"Yearly"}]}/>
        </div>
        <Field label="Merchant / Name" value={fRecur.merchant} onChange={v=>setFRecur({...fRecur,merchant:v})} placeholder="e.g. Spotify"/>
        <Field label="Account" value={fRecur.wallet} onChange={v=>setFRecur({...fRecur,wallet:v})} options={wOpts}/>
        <Field label="Next Date" type="date" value={fRecur.nextDate} onChange={v=>setFRecur({...fRecur,nextDate:v})}/>
        <Btn onClick={addRecurring} style={{width:"100%",padding:13,fontSize:14}}>Add Recurring</Btn>
      </Modal>

      {/* Record / Edit Refund */}
      <Modal open={isOpen("refund")} onClose={()=>{closeM("refund");setEditRefund(null);setFRefund(blankRefund);}} title={editRefund?"✏️ Edit Refund":"↩️ Record Refund"}>
        <Field label="Linked Expense" value={fRefund.refundOf} onChange={v=>setFRefund({...fRefund,refundOf:v})}
          options={[{value:"",label:"— Select original expense —"},...txs.filter(t=>t.type==="expense").slice(0,100).map(t=>({value:t.id,label:`${fmtDate(t.date||t.tx_date)} · ${t.merchant||t.note||"Expense"} · ${disp(t.amount||parseFloat(t.amount_kes||0))}`}))]}/>
        {fRefund.refundOf&&(()=>{
          const orig=txs.find(t=>t.id===fRefund.refundOf);
          if(!orig) return null;
          const cat=expCats.find(c=>c.id===(orig.category||orig.category_id));
          return<div style={{background:C.navyLight,borderRadius:10,padding:"10px 14px",marginBottom:12,fontSize:12,color:C.textMuted}}>
            <span style={{fontSize:16,marginRight:6}}>{cat?.icon||"💸"}</span>
            <strong style={{color:C.textPrimary}}>{orig.merchant||orig.note||"Expense"}</strong>{" · "}{cat?.name||"—"}{" · "}<strong style={{color:C.coral}}>{disp(orig.amount||parseFloat(orig.amount_kes||0))}</strong>{" on "}{fmtDate(orig.date||orig.tx_date)}
          </div>;
        })()}
        <div className="grid-2">
          <Field label="Refund Amount" type="number" value={fRefund.amount} onChange={v=>setFRefund({...fRefund,amount:v})} placeholder="0.00" note="In wallet's currency"/>
          <Field label="Date" type="date" value={fRefund.date} onChange={v=>setFRefund({...fRefund,date:v})}/>
        </div>
        <Field label="Credit to Account" value={fRefund.wallet} onChange={v=>setFRefund({...fRefund,wallet:v})} options={wOpts}/>
        <Field label="Note (optional)" value={fRefund.note} onChange={v=>setFRefund({...fRefund,note:v})} placeholder="e.g. Returned damaged item"/>
        <div style={{background:C.navyLight,borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:11,color:C.textMuted,lineHeight:1.7}}>
          ↩ Refund will be <strong style={{color:C.teal}}>credited to your wallet</strong> and <strong style={{color:C.teal}}>deducted from category spend</strong>.
        </div>
        <Btn onClick={saveRefund} disabled={!fRefund.refundOf||!fRefund.amount||!fRefund.wallet} style={{width:"100%",padding:13,fontSize:14}}>
          {editRefund?"Save Changes":"Record Refund"}
        </Btn>
      </Modal>

      {/* Import / Export */}
      <Modal open={isOpen("importExport")} onClose={()=>{closeM("importExport");resetImport();}} title="⬆⬇ Import & Export" wide>

        {/* ── EXPORT SECTION ── */}
        <div style={{marginBottom:22}}>
          <div style={{fontWeight:700,fontSize:14,marginBottom:10,color:C.teal}}>⬇ Export</div>
          <div className="grid-3" style={{gap:8}}>
            <Btn onClick={exportTransactions} outline color={C.teal} small style={{width:"100%"}}>📋 Transactions</Btn>
            <Btn onClick={exportAll} color={C.teal} small style={{width:"100%"}}>📦 Full Export (3 CSVs)</Btn>
            <Btn onClick={()=>downloadBlob(new Blob([TX_TEMPLATE]),`pesa-yangu-template.csv`)} outline color={C.textMuted} small style={{width:"100%",fontSize:11}}>📄 Transactions Template</Btn>
          </div>
          <div style={{marginTop:8}}>
            <Btn onClick={()=>downloadBlob(new Blob([WALLETS_TEMPLATE]),`pesa-yangu-wallets-template.csv`)} outline color={C.blue} small style={{fontSize:11}}>🏦 Accounts Template (with Opening Balance)</Btn>
          </div>
          <div style={{marginTop:8,background:C.navyLight,borderRadius:8,padding:"8px 12px",fontSize:10,color:C.textFaint,lineHeight:1.7}}>
            Full export downloads 3 files: <strong style={{color:C.textMuted}}>transactions</strong>, <strong style={{color:C.textMuted}}>wallets</strong>, and <strong style={{color:C.textMuted}}>goals</strong>.
          </div>
        </div>

        <div style={{height:1,background:C.navyLight,margin:"0 0 18px"}}/>

        {/* ── IMPORT SECTION ── */}
        <div style={{fontWeight:700,fontSize:14,marginBottom:12,color:C.gold}}>⬆ Import Transactions</div>

        {/* ── NEW ITEMS STEP ── */}
        {importStep === "new-items" && (
          <>
            <div style={{background:C.gold+"18",border:`1px solid ${C.gold}44`,borderRadius:12,padding:"12px 16px",marginBottom:16,fontSize:13,color:C.gold}}>
              Your CSV contains accounts or categories that don't exist yet. Create them before importing?
            </div>

            {importNewWallets.length > 0 && (
              <div style={{marginBottom:16}}>
                <div style={{fontWeight:700,fontSize:12,color:C.teal,marginBottom:8,textTransform:"uppercase",letterSpacing:"0.06em"}}>New Accounts</div>
                {importNewWallets.map((w,i) => (
                  <div key={i} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8,background:C.navyLight,borderRadius:10,padding:"10px 14px",flexWrap:"wrap"}}>
                    <input type="checkbox" checked={w.selected} onChange={()=>setImportNewWallets(p=>p.map((x,j)=>j===i?{...x,selected:!x.selected}:x))} style={{accentColor:C.teal,width:16,height:16,cursor:"pointer"}}/>
                    <span style={{flex:1,fontWeight:600,fontSize:13,minWidth:80}}>{w.name}</span>
                    <select value={w.type} onChange={e=>setImportNewWallets(p=>p.map((x,j)=>j===i?{...x,type:e.target.value}:x))}
                      style={{background:C.navyMid,border:`1px solid ${C.navyLight}`,borderRadius:7,color:C.textMuted,padding:"4px 8px",fontSize:11,cursor:"pointer"}}>
                      <option value="current">Current</option>
                      <option value="savings">Savings</option>
                      <option value="cash">Cash</option>
                      <option value="digital">Digital / M-Pesa</option>
                      <option value="investment">Investment</option>
                    </select>
                    <input type="number" value={w.openingBalance} onChange={e=>setImportNewWallets(p=>p.map((x,j)=>j===i?{...x,openingBalance:e.target.value}:x))}
                      placeholder="Opening balance (KES)" style={{background:C.navyMid,border:`1px solid ${C.navyLight}`,borderRadius:7,color:C.textPrimary,padding:"4px 8px",fontSize:11,width:160}}/>
                  </div>
                ))}
              </div>
            )}

            {importNewCats.length > 0 && (
              <div style={{marginBottom:16}}>
                <div style={{fontWeight:700,fontSize:12,color:C.blue,marginBottom:8,textTransform:"uppercase",letterSpacing:"0.06em"}}>New Categories</div>
                {importNewCats.map((c,i) => (
                  <div key={i} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8,background:C.navyLight,borderRadius:10,padding:"10px 14px"}}>
                    <input type="checkbox" checked={c.selected} onChange={()=>setImportNewCats(p=>p.map((x,j)=>j===i?{...x,selected:!x.selected}:x))} style={{accentColor:C.teal,width:16,height:16,cursor:"pointer"}}/>
                    <span style={{flex:1,fontWeight:600,fontSize:13}}>{c.name}</span>
                    <span style={{fontSize:11,color:c.type==="income"?C.teal:C.coral,background:(c.type==="income"?C.teal:C.coral)+"22",borderRadius:6,padding:"2px 8px",fontWeight:600}}>{c.type}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{display:"flex",gap:10}}>
              <Btn outline color={C.textMuted} style={{flex:1}} onClick={()=>{
                // Skip creating new items; validate as-is (some rows will be invalid)
                const validated = validateImportRows(importParsedRows, wallets, expCats, incCats);
                setImportRows(validated);
                setImportErrors(validated.filter(r=>!r._valid).map(r=>`Row ${r._row}: ${r._errors.join(", ")}`));
                setImportStep("preview");
              }}>Skip, continue anyway</Btn>
              <Btn style={{flex:2}} disabled={importBusy} onClick={confirmNewItems}>
                {importBusy ? "Creating…" : `Create ${[...importNewWallets,...importNewCats].filter(x=>x.selected).length} item(s) & Continue`}
              </Btn>
            </div>
          </>
        )}

        {importStep === "upload" && (
          <>
            <FileUpload label="Upload CSV File" accept=".csv" onFile={handleImportFile} files={[]}/>
            <div style={{background:C.navyLight,borderRadius:10,padding:"12px 14px",fontSize:11,color:C.textMuted,lineHeight:1.9}}>
              <strong style={{color:C.textPrimary}}>Supported columns:</strong><br/>
              <code style={{color:C.teal}}>date, type, amount_kes, wallet</code> — required<br/>
              <code style={{color:C.blue}}>time, category, merchant, note</code> — optional<br/>
              <code style={{color:C.purple}}>from_wallet, to_wallet</code> — for transfers<br/>
              <div style={{marginTop:6,color:C.textFaint}}>date format: YYYY-MM-DD · time format: HH:MM · Types: expense · income · transfer · refund</div>
              <div style={{marginTop:4,color:C.gold}}>⚠ Set correct opening balances on your accounts before importing to get accurate final balances.</div>
            </div>
          </>
        )}

        {importStep === "preview" && (
          <>
            {/* Summary bar */}
            <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}>
              <div style={{background:C.teal+"22",borderRadius:8,padding:"6px 14px",fontSize:12,color:C.teal,fontWeight:700}}>
                ✓ {importRows.filter(r=>r._valid).length} valid
              </div>
              {importErrors.length > 0 && (
                <div style={{background:C.coral+"22",borderRadius:8,padding:"6px 14px",fontSize:12,color:C.coral,fontWeight:700}}>
                  ✗ {importErrors.length} skipped
                </div>
              )}
              <div style={{flex:1}}/>
              <Btn outline color={C.textMuted} small>← Back</Btn>
            </div>

            {/* Error log */}
            {importErrors.length > 0 && (
              <div style={{background:C.coral+"11",border:`1px solid ${C.coral}33`,borderRadius:10,padding:"10px 14px",marginBottom:14,maxHeight:100,overflowY:"auto"}}>
                <div style={{color:C.coral,fontSize:11,fontWeight:700,marginBottom:5}}>Skipped rows:</div>
                {importErrors.map((e,i)=>(
                  <div key={i} style={{color:C.textMuted,fontSize:11,marginBottom:2}}>• {e}</div>
                ))}
              </div>
            )}

            {/* Preview table */}
            <div style={{border:`1px solid ${C.navyLight}`,borderRadius:12,overflow:"hidden",marginBottom:14,maxHeight:280,overflowY:"auto"}}>
              {/* Header */}
              <div style={{display:"grid",gridTemplateColumns:"90px 80px 1fr 90px 90px",gap:8,padding:"8px 14px",background:C.navyLight,position:"sticky",top:0}}>
                {["Date","Type","Merchant / Note","Amount","Account"].map(h=>(
                  <div key={h} style={{color:C.textFaint,fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em"}}>{h}</div>
                ))}
              </div>
              {importRows.filter(r=>r._valid).map((r,i)=>(
                <div key={i} style={{display:"grid",gridTemplateColumns:"90px 80px 1fr 90px 90px",gap:8,padding:"8px 14px",borderBottom:`1px solid ${C.navyLight}`,alignItems:"center"}}>
                  <div style={{fontSize:11,color:C.textMuted}}>{r._date}</div>
                  <div>
                    <span style={{
                      background:(r._type==="income"?C.teal:r._type==="transfer"?C.blue:r._type==="refund"?C.purple:C.coral)+"22",
                      color:(r._type==="income"?C.teal:r._type==="transfer"?C.blue:r._type==="refund"?C.purple:C.coral),
                      borderRadius:6,padding:"2px 7px",fontSize:10,fontWeight:600,
                    }}>{r._type}</span>
                  </div>
                  <div style={{fontSize:12,color:C.textPrimary,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {r.merchant||r.note||r.category||"—"}
                  </div>
                  <div style={{fontSize:12,fontWeight:700,color:r._type==="income"?C.teal:r._type==="transfer"?C.blue:C.textPrimary}}>
                    {r._type==="income"?"+":"−"}KSh {r._amount.toLocaleString()}
                  </div>
                  <div style={{fontSize:11,color:C.textMuted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {r._type==="transfer"?`${r.from_wallet}→${r.to_wallet}`:r.wallet||"—"}
                  </div>
                </div>
              ))}
              {importRows.filter(r=>r._valid).length === 0 && (
                <div style={{padding:"24px",textAlign:"center",color:C.textFaint,fontSize:13}}>No valid rows to import.</div>
              )}
            </div>

            <Btn
              onClick={confirmImport}
              disabled={importBusy || importRows.filter(r=>r._valid).length===0}
              style={{width:"100%",padding:13,fontSize:14}}
            >
              {importBusy ? "Importing…" : `Import ${importRows.filter(r=>r._valid).length} Transaction${importRows.filter(r=>r._valid).length!==1?"s":""}`}
            </Btn>
          </>
        )}

      </Modal>

      {/* Share */}
      <Modal open={isOpen("share")} onClose={()=>closeM("share")} title="📤 Share Pesa Yangu">
        <div style={{textAlign:"center",marginBottom:20}}>
          <div style={{fontSize:40,marginBottom:8}}>◈</div>
          <div style={{fontWeight:700,fontSize:16,marginBottom:4}}>Invite someone to Pesa Yangu</div>
          <div style={{color:C.textMuted,fontSize:12}}>Share the app with friends, family or a partner.</div>
        </div>
        <div style={{background:C.navyLight,borderRadius:10,padding:"12px 16px",marginBottom:16,fontSize:12,color:C.textMuted,textAlign:"center"}}>https://pesayangu.africa</div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <Btn onClick={()=>shareApp("whatsapp")} color="#25D366" style={{width:"100%",fontSize:14}}>💬 Share on WhatsApp</Btn>
          <Btn onClick={()=>shareApp("email")} outline color={C.blue} style={{width:"100%",fontSize:14}}>📧 Share via Email</Btn>
          <Btn onClick={()=>shareApp("copy")} outline color={C.textMuted} style={{width:"100%",fontSize:14}}>🔗 Copy Link</Btn>
        </div>
      </Modal>

      {/* Billing — placeholder, all features currently unlocked */}
      <Modal open={isOpen("billing")} onClose={()=>closeM("billing")} title="Pesa Yangu">
        <div style={{textAlign:"center",padding:"24px 0"}}>
          <div style={{fontSize:40,marginBottom:12}}>◈</div>
          <div style={{fontWeight:700,fontSize:16,marginBottom:8,color:C.teal}}>All Features Unlocked</div>
          <div style={{color:C.textMuted,fontSize:13,lineHeight:1.7}}>
            You have full access to all Pesa Yangu features including<br/>
            unlimited accounts, AI advisor, reconciliation, and more.
          </div>
        </div>
      </Modal>

      {/* AI Advisor */}
      {/* ── Idle warning overlay ── */}
      {idleWarning&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:C.navyMid,border:`1px solid ${C.coral}`,borderRadius:20,padding:"32px 28px",maxWidth:380,width:"90%",textAlign:"center",boxShadow:`0 20px 60px rgba(0,0,0,0.5)`}}>
            <div style={{fontSize:36,marginBottom:12}}>🏦</div>
            <div style={{fontWeight:700,fontSize:17,color:C.textPrimary,marginBottom:8}}>Still there?</div>
            <div style={{color:C.textMuted,fontSize:13,marginBottom:24,lineHeight:1.6}}>
              You'll be signed out in <strong style={{color:C.coral}}>1 minute</strong> due to inactivity.
            </div>
            <button
              onClick={()=>setIdleWarning(false)}
              style={{background:C.teal,color:"#fff",border:"none",borderRadius:12,padding:"12px 32px",fontSize:14,fontWeight:700,cursor:"pointer",width:"100%"}}>
              Yes, keep me signed in
            </button>
          </div>
        </div>
      )}

      <Modal open={isOpen("ai")} onClose={()=>closeM("ai")} title="✦ AI Financial Advisor" wide>
        {aiLoading
          ? <div style={{textAlign:"center",padding:"48px 0",color:C.textMuted}}>
              <div style={{fontSize:34,marginBottom:14,display:"inline-block",animation:"spin 1.2s linear infinite",color:C.gold}}>✦</div>
              <div style={{fontSize:13}}>Analysing your finances…</div>
            </div>
          : <div style={{color:C.textMuted,fontSize:14,lineHeight:1.9,whiteSpace:"pre-wrap"}}>{aiText}</div>
        }
      </Modal>

      {/* Confirm Dialog */}
      <ConfirmModal
        open={confirm.open}
        onClose={closeConfirm}
        onConfirm={confirm.onConfirm}
        title={confirm.title}
        message={confirm.message}
      />

      {/* Bottom Navigation for Mobile */}
      <div className="mobile-bottom-nav" style={{
        display: "none",
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        background: C.navyMid,
        borderTop: `1px solid ${C.navyLight}`,
        height: 60,
        zIndex: 100,
        justifyContent: "space-around",
        alignItems: "center",
        boxShadow: "0 -4px 16px rgba(0,0,0,0.3)"
      }}>
        {[
          { id: "dashboard",    label: "Home",    icon: "◈" },
          { id: "accounts",     label: "Accounts", icon: "🏦" },
          { id: "transactions", label: "Records", icon: "📋" },
          { id: "budgets",      label: "Budgets", icon: "📊" },
          { id: "more",         label: "More",    icon: "☰" },
        ].map(item => {
          const isActive = tab === item.id || (item.id === "more" && ["goals", "recurring", "investments", "loans", "insurance", "reconcile"].includes(tab));
          return (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              style={{
                background: "none",
                border: "none",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                color: isActive ? C.teal : C.textMuted,
                fontSize: 11,
                fontWeight: isActive ? 700 : 500,
                cursor: "pointer",
                padding: "4px 8px",
                flex: 1,
                minWidth: 50,
                transition: "color 0.2s"
              }}
            >
              <span style={{ fontSize: 20, marginBottom: 2 }}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
    </ThemeCtx.Provider>
  );
}
