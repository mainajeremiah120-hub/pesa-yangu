/**
 * AdminDashboard.jsx
 * All admin-only UI components: AdminApp (separate layout) and AdminPanel (embedded).
 */

import { useState, useEffect, useCallback } from "react";
import { adminApi } from "./lib/api.js";

const _M = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtDate = (d) => {
  if (!d) return "—";
  const s = String(d).slice(0,10).split("-");
  if (s.length !== 3) return String(d);
  return `${parseInt(s[2])}-${_M[parseInt(s[1])-1]}-${s[0]}`;
};
const fmtDateTime = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  return `${fmtDate(d)} ${dt.toLocaleTimeString("en-KE",{hour:"2-digit",minute:"2-digit"})}`;
};

// ─── shared constants ─────────────────────────────────────────────────────────
export const STATUS_COLOR   = { open:"#E67E22", in_progress:"#4A90E2", resolved:"#00D4AA", closed:"#888" };
export const PRIORITY_COLOR = { urgent:"#E74C3C", high:"#E67E22", normal:"#4A90E2", low:"#888" };

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN APP — completely separate layout for admin users
// ─────────────────────────────────────────────────────────────────────────────
export function AdminApp({ user, logout, C, theme, toggleTheme }) {
  const [tab,       setTab]     = useState("dashboard");
  const [stats,     setStats]   = useState(null);
  const [users,     setUsers]   = useState([]);
  const [tickets,   setTickets] = useState([]);
  const [userSearch,setUSearch] = useState("");
  const [ticketFilter,setTFilter]=useState("open");
  const [busy,      setBusy]    = useState(null);
  const [loading,   setLoading] = useState(true);
  const [activeTicket, setActiveTicket] = useState(null);
  const [replyText, setReplyText] = useState("");
  const [replyStatus, setReplyStatus] = useState("resolved");
  const [replying,  setReplying] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [s, u, t] = await Promise.all([
        adminApi.stats(),
        adminApi.users(""),
        adminApi.tickets("open"),
      ]);
      setStats(s); setUsers(u.users||[]); setTickets(t.tickets||[]);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(()=>{ loadAll(); }, [loadAll]);

  const loadTickets = async (status) => {
    setTFilter(status);
    try { const d = await adminApi.tickets(status); setTickets(d.tickets||[]); } catch {}
  };

  const loadUsers = async (q) => {
    setUSearch(q);
    try { const d = await adminApi.users(q); setUsers(d.users||[]); } catch {}
  };

  const patchUser = async (id, update) => {
    setBusy(id);
    try {
      const { user: u } = await adminApi.updateUser(id, update);
      setUsers(p => p.map(x => x.id===id ? {...x,...u} : x));
    } catch(e) { alert(e?.response?.data?.error||"Failed"); }
    finally { setBusy(null); }
  };

  const deleteUser = async (id, email) => {
    if (!window.confirm(`Permanently delete ${email}?\n\nThis removes all their data and cannot be undone.`)) return;
    setBusy(id);
    try {
      await adminApi.deleteUser(id);
      setUsers(p => p.filter(x => x.id !== id));
    } catch(e) { alert(e?.response?.data?.error||"Failed"); }
    finally { setBusy(null); }
  };

  const submitReply = async () => {
    if (!activeTicket) return;
    setReplying(true);
    try {
      const { ticket } = await adminApi.replyTicket(activeTicket.id, {
        admin_reply: replyText, status: replyStatus,
      });
      setTickets(p => p.map(t => t.id===ticket.id ? {...t,...ticket} : t));
      setActiveTicket(null); setReplyText(""); setReplyStatus("resolved");
    } catch(e) { alert(e?.response?.data?.error||"Failed"); }
    finally { setReplying(false); }
  };

  const inp = { width:"100%", background:C.navyLight, border:`1px solid ${C.navyLight}`,
    borderRadius:10, padding:"10px 14px", color:C.textPrimary, fontSize:13,
    outline:"none", boxSizing:"border-box" };

  const StatCard = ({label, value, color=C.teal}) => (
    <div style={{background:C.navyMid,borderRadius:14,padding:"14px 16px",border:`1px solid ${C.navyLight}`,flex:"1 1 80px",minWidth:80}}>
      <div style={{fontSize:10,color:C.textFaint,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:3}}>{label}</div>
      <div style={{fontSize:20,fontWeight:800,color}}>{value??"-"}</div>
    </div>
  );

  const openTickets = tickets.filter(t=>t.status==="open"||t.status==="in_progress");

  return (
    <div style={{minHeight:"100vh",background:C.navy,fontFamily:"'Inter',-apple-system,sans-serif",color:C.textPrimary}}>
      <style>{`*{box-sizing:border-box;margin:0;padding:0;}input,select,textarea{font-family:inherit;}`}</style>

      {/* Header */}
      <div style={{background:C.navyMid,borderBottom:`1px solid ${C.navyLight}`,padding:"12px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:100}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:30,height:30,background:`linear-gradient(135deg,${C.purple},${C.blue})`,borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>🛡️</div>
          <div>
            <div style={{fontWeight:800,fontSize:14,letterSpacing:"-0.02em"}}>Pesa Yangu</div>
            <div style={{fontSize:9,color:C.purple,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",marginTop:-2}}>Admin Console</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {openTickets.length>0&&<div style={{background:C.coral,color:"#fff",borderRadius:"50%",width:20,height:20,fontSize:10,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center"}}>{openTickets.length}</div>}
          <button onClick={toggleTheme} style={{background:C.navyLight,border:"none",borderRadius:8,padding:"6px 10px",cursor:"pointer",fontSize:14}}>{theme==="dark"?"☀️":"🌙"}</button>
          <button onClick={logout} style={{background:"none",border:`1px solid ${C.coral}44`,borderRadius:8,padding:"6px 12px",cursor:"pointer",color:C.coral,fontSize:11,fontWeight:700}}>Sign out</button>
        </div>
      </div>

      {/* Content */}
      <div style={{maxWidth:800,margin:"0 auto",padding:"20px 16px 100px"}}>

        {/* ── DASHBOARD TAB ── */}
        {tab==="dashboard"&&(
          <div>
            <div style={{marginBottom:20}}>
              <div style={{fontWeight:800,fontSize:20,marginBottom:4}}>Welcome, {user.full_name||"Admin"} 👋</div>
              <div style={{color:C.textMuted,fontSize:12}}>Here's what's happening on Pesa Yangu today.</div>
            </div>

            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:20}}>
              <StatCard label="Total Users"  value={stats?.total_users}  color={C.teal}/>
              <StatCard label="Today"        value={stats?.today}        color={C.blue}/>
              <StatCard label="This Week"    value={stats?.this_week}    color={C.purple}/>
              <StatCard label="This Month"   value={stats?.this_month}   color={C.gold}/>
              <StatCard label="Active"       value={stats?.active_users} color={C.teal}/>
              <StatCard label="Pro"          value={stats?.pro_users}    color={C.gold}/>
            </div>

            {openTickets.length>0&&(
              <div onClick={()=>setTab("tickets")} style={{background:C.coral+"18",border:`1px solid ${C.coral}44`,borderRadius:14,padding:"14px 18px",marginBottom:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div>
                  <div style={{fontWeight:700,color:C.coral,fontSize:13}}>🎫 {openTickets.length} open ticket{openTickets.length!==1?"s":""} need attention</div>
                  <div style={{fontSize:11,color:C.textMuted,marginTop:2}}>Tap to view and respond</div>
                </div>
                <span style={{color:C.coral,fontSize:18}}>→</span>
              </div>
            )}

            <div style={{background:C.navyMid,borderRadius:14,border:`1px solid ${C.navyLight}`,padding:"16px"}}>
              <div style={{fontWeight:700,fontSize:13,marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                Recent Signups
                <button onClick={()=>setTab("users")} style={{fontSize:11,color:C.teal,background:"none",border:"none",cursor:"pointer",fontWeight:600}}>View all →</button>
              </div>
              {loading?<div style={{color:C.textFaint,fontSize:12,textAlign:"center",padding:16}}>Loading…</div>:
              users.slice(0,8).map(u=>(
                <div key={u.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:`1px solid ${C.navyLight}`}}>
                  <div style={{width:32,height:32,borderRadius:"50%",background:`linear-gradient(135deg,${C.teal},${C.blue})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:"#0B1120",flexShrink:0}}>
                    {(u.full_name||u.email||"?")[0].toUpperCase()}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.full_name||"(no name)"}</div>
                    <div style={{fontSize:10,color:C.textFaint,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.email}</div>
                  </div>
                  <div style={{fontSize:10,color:C.textFaint,flexShrink:0}}>{fmtDate(u.created_at)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── USERS TAB ── */}
        {tab==="users"&&(
          <div>
            <div style={{fontWeight:800,fontSize:18,marginBottom:16}}>Users</div>
            <input value={userSearch} onChange={e=>loadUsers(e.target.value)} placeholder="Search by name or email…"
              style={{...inp,marginBottom:14}} onFocus={e=>e.target.style.borderColor=C.purple} onBlur={e=>e.target.style.borderColor=C.navyLight}/>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {users.map(u=>(
                <div key={u.id} style={{background:C.navyMid,border:`1px solid ${C.navyLight}`,borderRadius:14,padding:"14px 16px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                    <div style={{width:38,height:38,borderRadius:"50%",background:`linear-gradient(135deg,${C.teal},${C.blue})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:800,color:"#0B1120",flexShrink:0}}>
                      {(u.full_name||u.email||"?")[0].toUpperCase()}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>
                        <span style={{fontWeight:700,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:150}}>{u.full_name||"(no name)"}</span>
                        {u.role==="admin"&&<span style={{fontSize:9,fontWeight:700,background:C.purple+"33",color:C.purple,borderRadius:5,padding:"1px 5px"}}>ADMIN</span>}
                        <span style={{fontSize:9,fontWeight:700,background:(u.plan==="pro"?C.gold+"33":C.navyLight),color:u.plan==="pro"?C.gold:C.textFaint,borderRadius:5,padding:"1px 5px"}}>{u.plan.toUpperCase()}</span>
                        {!u.is_active&&<span style={{fontSize:9,fontWeight:700,background:C.coral+"22",color:C.coral,borderRadius:5,padding:"1px 5px"}}>INACTIVE</span>}
                      </div>
                      <div style={{fontSize:10,color:C.textMuted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.email}</div>
                      <div style={{fontSize:10,color:C.textFaint,marginTop:1}}>Joined {fmtDate(u.created_at)} · {u.tx_count} txns · {u.wallet_count} accounts</div>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    <button disabled={busy===u.id} onClick={()=>patchUser(u.id,{role:u.role==="admin"?"user":"admin"})}
                      style={{fontSize:10,padding:"5px 12px",borderRadius:8,border:`1px solid ${C.purple}`,background:"none",color:C.purple,cursor:"pointer",fontWeight:700}}>
                      {u.role==="admin"?"Remove Admin":"Make Admin"}
                    </button>
                    <button disabled={busy===u.id} onClick={()=>patchUser(u.id,{is_active:!u.is_active})}
                      style={{fontSize:10,padding:"5px 12px",borderRadius:8,border:`1px solid ${u.is_active?C.coral:C.teal}`,background:"none",color:u.is_active?C.coral:C.teal,cursor:"pointer",fontWeight:700}}>
                      {u.is_active?"Deactivate":"Activate"}
                    </button>
                    <button disabled={busy===u.id} onClick={()=>patchUser(u.id,{plan:u.plan==="pro"?"free":"pro"})}
                      style={{fontSize:10,padding:"5px 12px",borderRadius:8,border:`1px solid ${C.gold}`,background:"none",color:C.gold,cursor:"pointer",fontWeight:700}}>
                      {u.plan==="pro"?"→ Free":"→ Pro"}
                    </button>
                    <button disabled={busy===u.id} onClick={()=>deleteUser(u.id, u.email)}
                      style={{fontSize:10,padding:"5px 12px",borderRadius:8,border:`1px solid ${C.coral}`,background:"none",color:C.coral,cursor:"pointer",fontWeight:700}}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {users.length===0&&<div style={{textAlign:"center",color:C.textFaint,padding:40,fontSize:13}}>No users found.</div>}
            </div>
          </div>
        )}

        {/* ── TICKETS TAB ── */}
        {tab==="tickets"&&(
          <div>
            <div style={{fontWeight:800,fontSize:18,marginBottom:14}}>Support Tickets</div>
            <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>
              {["open","in_progress","resolved","closed"].map(s=>(
                <button key={s} onClick={()=>loadTickets(s)}
                  style={{fontSize:11,padding:"5px 14px",borderRadius:20,border:`1px solid ${ticketFilter===s?STATUS_COLOR[s]:C.navyLight}`,
                    background:ticketFilter===s?STATUS_COLOR[s]+"22":"none",color:ticketFilter===s?STATUS_COLOR[s]:C.textMuted,cursor:"pointer",fontWeight:600,textTransform:"capitalize"}}>
                  {s.replace("_"," ")}
                </button>
              ))}
              <button onClick={()=>loadTickets("")}
                style={{fontSize:11,padding:"5px 14px",borderRadius:20,border:`1px solid ${ticketFilter===""?C.teal:C.navyLight}`,
                  background:ticketFilter===""?C.teal+"22":"none",color:ticketFilter===""?C.teal:C.textMuted,cursor:"pointer",fontWeight:600}}>
                All
              </button>
            </div>

            {activeTicket&&(
              <div style={{position:"fixed",inset:0,background:"#000A",zIndex:500,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
                <div style={{background:C.navyMid,borderRadius:"20px 20px 0 0",padding:24,width:"100%",maxWidth:600,maxHeight:"85vh",overflowY:"auto"}}>
                  <div style={{fontWeight:800,fontSize:15,marginBottom:4}}>{activeTicket.subject}</div>
                  <div style={{fontSize:11,color:C.textMuted,marginBottom:12}}>from {activeTicket.full_name} · {activeTicket.email}</div>
                  <div style={{background:C.navyLight,borderRadius:10,padding:"10px 14px",fontSize:13,color:C.textPrimary,marginBottom:16,whiteSpace:"pre-wrap"}}>{activeTicket.message}</div>
                  {activeTicket.admin_reply&&(
                    <div style={{background:C.teal+"18",border:`1px solid ${C.teal}33`,borderRadius:10,padding:"10px 14px",fontSize:12,color:C.textMuted,marginBottom:16}}>
                      <strong style={{color:C.teal}}>Previous reply:</strong><br/>{activeTicket.admin_reply}
                    </div>
                  )}
                  <textarea value={replyText} onChange={e=>setReplyText(e.target.value)} placeholder="Type your reply…" rows={4}
                    style={{...inp,resize:"vertical",marginBottom:12}}/>
                  <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center"}}>
                    <div style={{fontSize:12,color:C.textMuted}}>Set status:</div>
                    <select value={replyStatus} onChange={e=>setReplyStatus(e.target.value)}
                      style={{...inp,width:"auto",flex:1}}>
                      <option value="in_progress">In Progress</option>
                      <option value="resolved">Resolved</option>
                      <option value="closed">Closed</option>
                    </select>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={()=>{setActiveTicket(null);setReplyText("");}} style={{flex:1,padding:12,borderRadius:10,border:`1px solid ${C.navyLight}`,background:"none",color:C.textMuted,cursor:"pointer",fontWeight:600}}>Cancel</button>
                    <button onClick={submitReply} disabled={replying||!replyText.trim()}
                      style={{flex:2,padding:12,borderRadius:10,border:"none",background:C.teal,color:"#0B1120",cursor:"pointer",fontWeight:700,opacity:replying||!replyText.trim()?0.6:1}}>
                      {replying?"Sending…":"Send Reply"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {tickets.map(t=>(
                <div key={t.id} style={{background:C.navyMid,border:`1px solid ${C.navyLight}`,borderRadius:14,padding:"14px 16px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6,gap:8}}>
                    <div style={{fontWeight:700,fontSize:13,flex:1}}>{t.subject}</div>
                    <div style={{display:"flex",gap:4,flexShrink:0}}>
                      <span style={{fontSize:9,fontWeight:700,background:PRIORITY_COLOR[t.priority]+"22",color:PRIORITY_COLOR[t.priority],borderRadius:5,padding:"2px 6px",textTransform:"uppercase"}}>{t.priority}</span>
                      <span style={{fontSize:9,fontWeight:700,background:STATUS_COLOR[t.status]+"22",color:STATUS_COLOR[t.status],borderRadius:5,padding:"2px 6px",textTransform:"capitalize"}}>{t.status.replace("_"," ")}</span>
                    </div>
                  </div>
                  <div style={{fontSize:11,color:C.textMuted,marginBottom:4}}>{t.full_name} · {t.email}</div>
                  <div style={{fontSize:12,color:C.textPrimary,marginBottom:8,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{t.message}</div>
                  <div style={{fontSize:10,color:C.textFaint,marginBottom:10}}>{fmtDateTime(t.created_at)}</div>
                  {t.admin_reply&&<div style={{background:C.teal+"11",borderRadius:8,padding:"8px 12px",fontSize:11,color:C.textMuted,marginBottom:8}}>✓ Replied: {t.admin_reply.slice(0,80)}{t.admin_reply.length>80?"…":""}</div>}
                  <button onClick={()=>{setActiveTicket(t);setReplyText(t.admin_reply||"");setReplyStatus("resolved");}}
                    style={{fontSize:11,padding:"6px 14px",borderRadius:8,border:`1px solid ${C.teal}`,background:"none",color:C.teal,cursor:"pointer",fontWeight:700}}>
                    {t.admin_reply?"Update Reply":"Reply"}
                  </button>
                </div>
              ))}
              {tickets.length===0&&<div style={{textAlign:"center",color:C.textFaint,padding:40,fontSize:13}}>No tickets in this category.</div>}
            </div>
          </div>
        )}

        {/* ── SETTINGS TAB ── */}
        {tab==="settings"&&(
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            <div style={{fontWeight:800,fontSize:18}}>Admin Settings</div>
            <div style={{background:C.navyMid,borderRadius:14,border:`1px solid ${C.navyLight}`,padding:20}}>
              <div style={{fontSize:11,color:C.textMuted,marginBottom:4}}>Signed in as</div>
              <div style={{fontWeight:700,fontSize:14}}>{user.full_name||user.email}</div>
              <div style={{fontSize:12,color:C.textFaint,marginBottom:16}}>{user.email}</div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={toggleTheme} style={{flex:1,padding:12,borderRadius:10,border:`1px solid ${C.navyLight}`,background:C.navyLight,color:C.textPrimary,cursor:"pointer",fontWeight:600,fontSize:12}}>
                  {theme==="dark"?"☀️ Light Mode":"🌙 Dark Mode"}
                </button>
                <button onClick={logout} style={{flex:1,padding:12,borderRadius:10,border:`1px solid ${C.coral}44`,background:"none",color:C.coral,cursor:"pointer",fontWeight:700,fontSize:12}}>
                  🚪 Sign Out
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,background:C.navyMid,borderTop:`1px solid ${C.navyLight}`,display:"flex",zIndex:100}}>
        {[
          {id:"dashboard", icon:"◈",  label:"Dashboard"},
          {id:"users",     icon:"👥", label:"Users"},
          {id:"tickets",   icon:"🎫", label:"Tickets"},
          {id:"settings",  icon:"⚙️", label:"Settings"},
        ].map(n=>(
          <button key={n.id} onClick={()=>setTab(n.id)} style={{flex:1,padding:"10px 4px 14px",background:"none",border:"none",cursor:"pointer",
            color:tab===n.id?C.teal:C.textFaint,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
            <span style={{fontSize:18,position:"relative"}}>
              {n.icon}
              {n.id==="tickets"&&openTickets.length>0&&<span style={{position:"absolute",top:-4,right:-6,background:C.coral,color:"#fff",borderRadius:"50%",width:14,height:14,fontSize:8,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center"}}>{openTickets.length}</span>}
            </span>
            <span style={{fontSize:9,fontWeight:tab===n.id?700:400}}>{n.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN PANEL — embedded in the regular app's admin tab
// ─────────────────────────────────────────────────────────────────────────────
export function AdminPanel({ C, showToast }) {
  const [stats,   setStats]   = useState(null);
  const [users,   setUsers]   = useState([]);
  const [search,  setSearch]  = useState("");
  const [loading, setLoading] = useState(true);
  const [busy,    setBusy]    = useState(null);

  const load = useCallback(async (q="") => {
    setLoading(true);
    try {
      const [s, u] = await Promise.all([adminApi.stats(), adminApi.users(q)]);
      setStats(s); setUsers(u.users||[]);
    } catch { /* silently ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(()=>{ load(); }, [load]);

  const patch = async (id, update, label) => {
    setBusy(id);
    try {
      const { user: updated } = await adminApi.updateUser(id, update);
      setUsers(p => p.map(u => u.id===id ? {...u,...updated} : u));
      showToast(label, C.teal);
    } catch(e) { showToast(e?.response?.data?.error||"Failed", C.coral); }
    finally { setBusy(null); }
  };

  const statCard = (label, value, color=C.teal) => (
    <div style={{background:C.navyMid,borderRadius:14,padding:"14px 18px",border:`1px solid ${C.navyLight}`,flex:1,minWidth:110}}>
      <div style={{fontSize:11,color:C.textFaint,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:4}}>{label}</div>
      <div style={{fontSize:22,fontWeight:800,color}}>{value??"-"}</div>
    </div>
  );

  return (
    <div style={{padding:"0 0 80px"}}>
      <div style={{fontWeight:800,fontSize:18,marginBottom:16,color:C.textPrimary}}>
        🛡️ Admin Panel
      </div>

      <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:20}}>
        {statCard("Total Users",  stats?.total_users,  C.teal)}
        {statCard("Today",        stats?.today,        C.blue)}
        {statCard("This Week",    stats?.this_week,    C.purple)}
        {statCard("This Month",   stats?.this_month,   C.gold)}
        {statCard("Active",       stats?.active_users, C.teal)}
        {statCard("Pro",          stats?.pro_users,    C.gold)}
      </div>

      <div style={{position:"relative",marginBottom:16}}>
        <input
          value={search}
          onChange={e=>{setSearch(e.target.value);load(e.target.value);}}
          placeholder="Search by name or email…"
          style={{width:"100%",background:C.navyMid,border:`1px solid ${C.navyLight}`,borderRadius:12,
            padding:"11px 16px",color:C.textPrimary,fontSize:13,outline:"none",boxSizing:"border-box"}}
        />
        {loading && <div style={{position:"absolute",right:14,top:"50%",transform:"translateY(-50%)",fontSize:11,color:C.textFaint}}>loading…</div>}
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {users.map(u => (
          <div key={u.id} style={{background:C.navyMid,border:`1px solid ${C.navyLight}`,borderRadius:14,padding:"14px 16px"}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
              <div style={{width:40,height:40,borderRadius:"50%",background:`linear-gradient(135deg,${C.teal},${C.blue})`,
                display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:800,flexShrink:0,color:"#0B1120"}}>
                {(u.full_name||u.email||"?")[0].toUpperCase()}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                  <span style={{fontWeight:700,fontSize:13,color:C.textPrimary,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:160}}>
                    {u.full_name||"(no name)"}
                  </span>
                  {u.role==="admin" && (
                    <span style={{fontSize:9,fontWeight:700,background:C.purple+"33",color:C.purple,borderRadius:5,padding:"2px 6px",textTransform:"uppercase"}}>Admin</span>
                  )}
                  <span style={{fontSize:9,fontWeight:700,background:(u.plan==="pro"?C.gold:C.navyLight)+"44",color:u.plan==="pro"?C.gold:C.textFaint,borderRadius:5,padding:"2px 6px",textTransform:"uppercase"}}>
                    {u.plan}
                  </span>
                  {!u.is_active && (
                    <span style={{fontSize:9,fontWeight:700,background:C.coral+"22",color:C.coral,borderRadius:5,padding:"2px 6px",textTransform:"uppercase"}}>Inactive</span>
                  )}
                </div>
                <div style={{fontSize:11,color:C.textMuted,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.email}</div>
                <div style={{fontSize:10,color:C.textFaint,marginTop:3,display:"flex",gap:10,flexWrap:"wrap"}}>
                  <span>Joined {fmtDate(u.created_at)}</span>
                  <span>{u.tx_count} txns</span>
                  <span>{u.wallet_count} accounts</span>
                </div>
              </div>
            </div>

            <div style={{display:"flex",gap:6,marginTop:10,flexWrap:"wrap"}}>
              <button
                disabled={busy===u.id}
                onClick={()=>patch(u.id,{is_active:!u.is_active}, u.is_active?"User deactivated":"User activated")}
                style={{fontSize:11,padding:"5px 12px",borderRadius:8,border:`1px solid ${u.is_active?C.coral:C.teal}`,
                  background:"none",color:u.is_active?C.coral:C.teal,cursor:"pointer",fontWeight:600}}>
                {u.is_active?"Deactivate":"Activate"}
              </button>
              <button
                disabled={busy===u.id}
                onClick={()=>patch(u.id,{plan:u.plan==="pro"?"free":"pro"}, u.plan==="pro"?"Downgraded to free":"Upgraded to Pro")}
                style={{fontSize:11,padding:"5px 12px",borderRadius:8,border:`1px solid ${C.gold}`,
                  background:"none",color:C.gold,cursor:"pointer",fontWeight:600}}>
                {u.plan==="pro"?"→ Free":"→ Pro"}
              </button>
              <button
                disabled={busy===u.id}
                onClick={()=>patch(u.id,{role:u.role==="admin"?"user":"admin"}, u.role==="admin"?"Admin removed":"Admin granted")}
                style={{fontSize:11,padding:"5px 12px",borderRadius:8,border:`1px solid ${C.purple}`,
                  background:"none",color:C.purple,cursor:"pointer",fontWeight:600}}>
                {u.role==="admin"?"→ User":"→ Admin"}
              </button>
            </div>
          </div>
        ))}
        {!loading && users.length===0 && (
          <div style={{textAlign:"center",color:C.textFaint,fontSize:13,padding:40}}>No users found.</div>
        )}
      </div>
    </div>
  );
}
