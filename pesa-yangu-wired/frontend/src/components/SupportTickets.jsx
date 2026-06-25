/**
 * SupportTickets.jsx
 * User-facing support ticket UI: list, new ticket form, detail/conversation view.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { ticketsApi } from "../lib/api.js";

const STATUS_STEPS  = ["open", "in_progress", "resolved", "closed"];
const STATUS_LABELS = { open:"Open", in_progress:"In Progress", resolved:"Resolved", closed:"Closed" };
const STATUS_COLOR  = { open:"#E67E22", in_progress:"#4A90E2", resolved:"#00D4AA", closed:"#888" };
const PRIORITY_COLOR  = { low:"#888", normal:"#4A90E2", high:"#E67E22", urgent:"#E74C3C" };
const PRIORITY_LABELS = { low:"Low", normal:"Normal", high:"High", urgent:"Urgent" };
const CAT_LABELS = {
  general:"General Enquiry", bug:"Bug / Something broken",
  account:"Account Issue", data:"Data / Import", billing:"Billing", other:"Other",
};

const _M = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtDate = (d) => {
  if (!d) return "—";
  const s = String(d).slice(0,10).split("-");
  if (s.length !== 3) return String(d);
  return `${parseInt(s[2])}-${_M[parseInt(s[1])-1]}-${s[0]}`;
};

function relTime(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)  return `${d}d ago`;
  return fmtDate(dateStr);
}

function StatusTracker({ status, C }) {
  const cur = STATUS_STEPS.indexOf(status);
  return (
    <div style={{ display:"flex", alignItems:"flex-start", marginBottom:18 }}>
      {STATUS_STEPS.map((step, i) => (
        <div key={step} style={{ display:"flex", alignItems:"center", flex: i < STATUS_STEPS.length - 1 ? 1 : 0 }}>
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
            <div style={{
              width:22, height:22, borderRadius:"50%",
              background: i <= cur ? STATUS_COLOR[status] : C.navyLight,
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:9, fontWeight:800,
              color: i <= cur ? "#0B1120" : C.textFaint,
              boxShadow: i === cur ? `0 0 0 4px ${STATUS_COLOR[status]}33` : "none",
              flexShrink:0,
            }}>
              {i < cur ? "✓" : i+1}
            </div>
            <div style={{
              fontSize:8, marginTop:4, fontWeight: i === cur ? 700 : 400,
              color: i <= cur ? STATUS_COLOR[status] : C.textFaint,
              whiteSpace:"nowrap", textAlign:"center",
            }}>
              {STATUS_LABELS[step]}
            </div>
          </div>
          {i < STATUS_STEPS.length - 1 && (
            <div style={{
              flex:1, height:2, marginBottom:14, margin:"0 4px 14px 4px",
              background: i < cur ? STATUS_COLOR[status] : C.navyLight,
            }}/>
          )}
        </div>
      ))}
    </div>
  );
}

function StarRating({ value, onChange, C, readonly }) {
  const [hover, setHover] = useState(0);
  return (
    <div style={{ display:"flex", gap:6 }}>
      {[1,2,3,4,5].map(s => (
        <span key={s}
          onClick={readonly ? undefined : () => onChange(s)}
          onMouseEnter={readonly ? undefined : () => setHover(s)}
          onMouseLeave={readonly ? undefined : () => setHover(0)}
          style={{
            fontSize:26, cursor: readonly ? "default" : "pointer",
            color: s <= (hover || value) ? "#F5A623" : C.navyLight,
            transition:"color 0.15s", lineHeight:1,
          }}>★</span>
      ))}
    </div>
  );
}

export function SupportTickets({ user, C, showToast }) {
  const [open,    setOpen]    = useState(false);
  const [view,    setView]    = useState("list");   // list | new | detail
  const [tickets, setTickets] = useState([]);
  const [selected, setSelected] = useState(null);  // { ticket, messages }
  const [listBusy,   setListBusy]   = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [busy,    setBusy]    = useState(false);

  // new ticket form
  const [subject,  setSubject]  = useState("");
  const [message,  setMessage]  = useState("");
  const [category, setCategory] = useState("general");
  const [priority, setPriority] = useState("normal");

  // detail reply
  const [replyText, setReplyText] = useState("");

  // rating
  const [rating, setRating] = useState(0);
  const [rated,  setRated]  = useState(false);

  const threadEndRef = useRef(null);

  const loadTickets = useCallback(async () => {
    setListBusy(true);
    try { const d = await ticketsApi.list(); setTickets(d.tickets || []); }
    catch { /* ignore */ }
    finally { setListBusy(false); }
  }, []);

  useEffect(() => { if (open) loadTickets(); }, [open, loadTickets]);

  // Scroll to bottom of thread when messages update
  useEffect(() => {
    if (view === "detail" && threadEndRef.current)
      threadEndRef.current.scrollIntoView({ behavior:"smooth" });
  }, [selected?.messages?.length, view]);

  const openDetail = async (ticket) => {
    setView("detail");
    setDetailBusy(true);
    setSelected(null);
    try {
      const d = await ticketsApi.get(ticket.id);
      setSelected(d);
      setRating(d.ticket.satisfaction_rating || 0);
      setRated(!!d.ticket.satisfaction_rating);
    } catch { showToast("Could not load ticket", C.coral); setView("list"); }
    finally { setDetailBusy(false); }
  };

  const goBack = () => { setView("list"); setSelected(null); setReplyText(""); };

  const submitNew = async (e) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return;
    setBusy(true);
    try {
      await ticketsApi.create({ subject, message, category, priority });
      showToast("Ticket submitted! We'll get back to you shortly.", C.teal, 4000);
      setSubject(""); setMessage(""); setCategory("general"); setPriority("normal");
      setView("list"); loadTickets();
    } catch(err) { showToast(err?.response?.data?.error || "Failed to submit", C.coral); }
    finally { setBusy(false); }
  };

  const submitReply = async (e) => {
    e.preventDefault();
    if (!replyText.trim() || !selected) return;
    setBusy(true);
    try {
      const d = await ticketsApi.addMessage(selected.ticket.id, replyText);
      const newMsg = {
        ...d.message,
        sender_role: "user",
        full_name: user?.full_name,
        email: user?.email,
      };
      setSelected(s => ({ ...s, messages: [...s.messages, newMsg] }));
      setReplyText("");
      loadTickets();
    } catch(err) { showToast(err?.response?.data?.error || "Failed to send", C.coral); }
    finally { setBusy(false); }
  };

  const handleReopen = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const d = await ticketsApi.reopen(selected.ticket.id);
      setSelected(s => ({ ...s, ticket: d.ticket }));
      showToast("Ticket reopened", C.teal);
      loadTickets();
    } catch(err) { showToast(err?.response?.data?.error || "Failed", C.coral); }
    finally { setBusy(false); }
  };

  const handleRate = async (stars) => {
    if (rated || !selected) return;
    setRating(stars);
    try {
      await ticketsApi.rate(selected.ticket.id, stars);
      setRated(true);
      showToast("Thanks for your feedback!", C.teal);
    } catch { setRating(0); }
  };

  const openCount = tickets.filter(t => t.status === "open" || t.status === "in_progress").length;

  const inp = {
    width:"100%", background:C.navyLight, border:`1px solid ${C.navyLight}`,
    borderRadius:10, padding:"10px 14px", color:C.textPrimary, fontSize:13,
    outline:"none", boxSizing:"border-box", fontFamily:"inherit",
  };

  const card = {
    background:C.navyMid, borderRadius:16, padding:"18px 16px",
    border:`1px solid ${C.navyLight}`, marginBottom:12,
  };

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <div style={card}>
      {/* Collapsible toggle */}
      <button onClick={() => setOpen(o => !o)}
        style={{ background:"none", border:"none", cursor:"pointer", width:"100%",
          textAlign:"left", padding:0, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:16 }}>🎫</span>
          <span style={{ fontWeight:700, fontSize:13, color:C.blue, textTransform:"uppercase", letterSpacing:"0.06em" }}>
            Help & Support
          </span>
          {openCount > 0 && (
            <span style={{ background:C.coral, color:"#fff", borderRadius:"50%", width:16, height:16,
              fontSize:9, fontWeight:800, display:"flex", alignItems:"center", justifyContent:"center" }}>
              {openCount}
            </span>
          )}
        </div>
        <span style={{ color:C.textFaint, fontSize:12 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ marginTop:14 }}>

          {/* ── LIST VIEW ──────────────────────────────────────────────────── */}
          {view === "list" && (
            <>
              <button onClick={() => setView("new")}
                style={{ width:"100%", padding:11, borderRadius:10, border:`1px solid ${C.blue}`,
                  background:C.blue+"18", color:C.blue, cursor:"pointer", fontWeight:700,
                  fontSize:13, marginBottom:14 }}>
                + New Ticket
              </button>

              {listBusy && <div style={{ textAlign:"center", color:C.textFaint, fontSize:12, padding:16 }}>Loading…</div>}

              {!listBusy && tickets.length === 0 && (
                <div style={{ textAlign:"center", color:C.textFaint, fontSize:12, padding:"20px 0" }}>
                  No tickets yet. Raise one if you need help!
                </div>
              )}

              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {tickets.map(t => (
                  <div key={t.id} onClick={() => openDetail(t)}
                    style={{ background:C.navyLight, borderRadius:10, padding:"12px 14px", cursor:"pointer",
                      border:`1px solid ${C.navyLight}`, transition:"border-color 0.15s" }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = STATUS_COLOR[t.status]+"66"}
                    onMouseLeave={e => e.currentTarget.style.borderColor = C.navyLight}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8, marginBottom:6 }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontWeight:600, fontSize:12, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {t.subject}
                        </div>
                        <div style={{ fontSize:10, color:C.textFaint, marginTop:2 }}>
                          #{t.id.slice(0,8)} · {CAT_LABELS[t.category] || t.category}
                        </div>
                      </div>
                      <span style={{
                        fontSize:9, fontWeight:700,
                        background:STATUS_COLOR[t.status]+"22",
                        color:STATUS_COLOR[t.status],
                        borderRadius:5, padding:"2px 7px", flexShrink:0,
                        textTransform:"capitalize", whiteSpace:"nowrap",
                      }}>
                        {STATUS_LABELS[t.status]}
                      </span>
                    </div>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <div style={{ fontSize:10, color:C.textFaint }}>
                        {relTime(t.created_at)}
                        {t.updated_at !== t.created_at && ` · updated ${relTime(t.updated_at)}`}
                      </div>
                      {t.satisfaction_rating ? (
                        <span style={{ fontSize:11, color:"#F5A623" }}>{"★".repeat(t.satisfaction_rating)}</span>
                      ) : (
                        <span style={{ fontSize:9, color:PRIORITY_COLOR[t.priority], fontWeight:700, textTransform:"uppercase" }}>
                          {PRIORITY_LABELS[t.priority]}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── NEW TICKET FORM ────────────────────────────────────────────── */}
          {view === "new" && (
            <form onSubmit={submitNew}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16 }}>
                <button type="button" onClick={() => setView("list")}
                  style={{ background:"none", border:"none", color:C.textMuted, cursor:"pointer", fontSize:12, padding:0 }}>
                  ← Back
                </button>
                <div style={{ fontWeight:700, fontSize:14 }}>New Support Ticket</div>
              </div>

              <div style={{ display:"flex", gap:8, marginBottom:10 }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:11, color:C.textMuted, marginBottom:4 }}>Category</div>
                  <select value={category} onChange={e => setCategory(e.target.value)}
                    style={{ ...inp }}>
                    <option value="general">General Enquiry</option>
                    <option value="bug">Bug / Something broken</option>
                    <option value="account">Account Issue</option>
                    <option value="data">Data / Import</option>
                    <option value="billing">Billing</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:11, color:C.textMuted, marginBottom:4 }}>Priority</div>
                  <select value={priority} onChange={e => setPriority(e.target.value)}
                    style={{ ...inp }}>
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>

              <div style={{ fontSize:11, color:C.textMuted, marginBottom:4 }}>Subject</div>
              <input value={subject} onChange={e => setSubject(e.target.value)}
                placeholder="Brief description of your issue" required
                style={{ ...inp, marginBottom:10 }}
                onFocus={e => e.target.style.borderColor = C.blue}
                onBlur={e  => e.target.style.borderColor = C.navyLight}/>

              <div style={{ fontSize:11, color:C.textMuted, marginBottom:4 }}>Description</div>
              <textarea value={message} onChange={e => setMessage(e.target.value)}
                placeholder="Describe your issue in detail — the more info you give, the faster we can help."
                rows={5} required
                style={{ ...inp, resize:"vertical", marginBottom:14 }}
                onFocus={e => e.target.style.borderColor = C.blue}
                onBlur={e  => e.target.style.borderColor = C.navyLight}/>

              <button type="submit" disabled={busy || !subject.trim() || !message.trim()}
                style={{ width:"100%", padding:12, borderRadius:10, border:"none", background:C.blue,
                  color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer",
                  opacity: busy || !subject.trim() || !message.trim() ? 0.6 : 1 }}>
                {busy ? "Submitting…" : "Submit Ticket"}
              </button>
            </form>
          )}

          {/* ── DETAIL VIEW ────────────────────────────────────────────────── */}
          {view === "detail" && (
            <div>
              {/* Header */}
              <div style={{ display:"flex", alignItems:"flex-start", gap:8, marginBottom:14 }}>
                <button onClick={goBack}
                  style={{ background:"none", border:"none", color:C.textMuted, cursor:"pointer", fontSize:12, padding:0, flexShrink:0, marginTop:2 }}>
                  ← Back
                </button>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:700, fontSize:13, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {selected?.ticket?.subject || "Loading…"}
                  </div>
                  {selected?.ticket && (
                    <div style={{ fontSize:10, color:C.textFaint, marginTop:2 }}>
                      #{selected.ticket.id.slice(0,8)} · {CAT_LABELS[selected.ticket.category] || selected.ticket.category}
                    </div>
                  )}
                </div>
                {selected?.ticket && (
                  <span style={{
                    fontSize:9, fontWeight:700, flexShrink:0,
                    background:STATUS_COLOR[selected.ticket.status]+"22",
                    color:STATUS_COLOR[selected.ticket.status],
                    borderRadius:6, padding:"3px 8px", textTransform:"capitalize",
                  }}>
                    {STATUS_LABELS[selected.ticket.status]}
                  </span>
                )}
              </div>

              {detailBusy && (
                <div style={{ textAlign:"center", color:C.textFaint, padding:32, fontSize:13 }}>
                  Loading conversation…
                </div>
              )}

              {!detailBusy && selected && (
                <>
                  {/* Status tracker */}
                  <StatusTracker status={selected.ticket.status} C={C} />

                  {/* Meta row */}
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:14 }}>
                    <span style={{
                      fontSize:10, fontWeight:700, textTransform:"uppercase",
                      background:PRIORITY_COLOR[selected.ticket.priority]+"22",
                      color:PRIORITY_COLOR[selected.ticket.priority],
                      borderRadius:5, padding:"2px 8px",
                    }}>
                      {PRIORITY_LABELS[selected.ticket.priority]} Priority
                    </span>
                    <span style={{ fontSize:10, color:C.textFaint }}>
                      Opened {relTime(selected.ticket.created_at)}
                    </span>
                    {selected.ticket.reopened_at && (
                      <span style={{ fontSize:10, color:C.gold }}>
                        · Reopened {relTime(selected.ticket.reopened_at)}
                      </span>
                    )}
                  </div>

                  {/* Conversation thread */}
                  <div style={{
                    background:C.navy, borderRadius:12, padding:12, marginBottom:12,
                    maxHeight:340, overflowY:"auto",
                    display:"flex", flexDirection:"column", gap:12,
                  }}>
                    {selected.messages.map(msg => {
                      const isUser = msg.sender_role === "user";
                      return (
                        <div key={msg.id} style={{ display:"flex", flexDirection:"column", alignItems: isUser ? "flex-end" : "flex-start" }}>
                          <div style={{ fontSize:9, color:C.textFaint, marginBottom:3, paddingLeft:4, paddingRight:4 }}>
                            {isUser ? "You" : "Pesa Yangu Support"} · {relTime(msg.created_at)}
                          </div>
                          <div style={{
                            maxWidth:"85%",
                            background: isUser ? C.blue+"2A" : C.teal+"20",
                            border: `1px solid ${isUser ? C.blue+"44" : C.teal+"33"}`,
                            borderRadius: isUser ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                            padding:"10px 14px", fontSize:13, color:C.textPrimary,
                            lineHeight:1.55, whiteSpace:"pre-wrap", wordBreak:"break-word",
                          }}>
                            {!isUser && (
                              <div style={{ fontSize:9, fontWeight:700, color:C.teal, marginBottom:4, letterSpacing:"0.04em" }}>
                                SUPPORT TEAM
                              </div>
                            )}
                            {msg.message}
                          </div>
                        </div>
                      );
                    })}
                    <div ref={threadEndRef}/>
                  </div>

                  {/* Satisfaction rating (resolved / closed) */}
                  {(selected.ticket.status === "resolved" || selected.ticket.status === "closed") && (
                    <div style={{
                      background:C.teal+"11", border:`1px solid ${C.teal}22`,
                      borderRadius:10, padding:"14px 16px", marginBottom:12, textAlign:"center",
                    }}>
                      <div style={{ fontSize:12, fontWeight:600, color:C.teal, marginBottom:10 }}>
                        {rated ? "Thanks for your rating! 🙏" : "How was your support experience?"}
                      </div>
                      <StarRating value={rating} onChange={handleRate} C={C} readonly={rated}/>
                      {!rated && (
                        <div style={{ fontSize:10, color:C.textFaint, marginTop:6 }}>Tap a star to rate</div>
                      )}
                    </div>
                  )}

                  {/* Reopen button */}
                  {(selected.ticket.status === "resolved" || selected.ticket.status === "closed") && (
                    <button onClick={handleReopen} disabled={busy}
                      style={{
                        width:"100%", padding:10, borderRadius:10,
                        border:`1px solid ${C.gold}`, background:"none",
                        color:C.gold, cursor:"pointer", fontWeight:700, fontSize:12, marginBottom:10,
                        opacity: busy ? 0.6 : 1,
                      }}>
                      🔄 Reopen Ticket
                    </button>
                  )}

                  {/* Reply form (if not closed) */}
                  {selected.ticket.status !== "closed" && (
                    <form onSubmit={submitReply}>
                      <div style={{ fontSize:11, color:C.textMuted, marginBottom:5 }}>Add a reply</div>
                      <textarea value={replyText} onChange={e => setReplyText(e.target.value)}
                        placeholder="Type your message…" rows={3}
                        style={{ ...inp, resize:"vertical", marginBottom:8 }}
                        onFocus={e => e.target.style.borderColor = C.blue}
                        onBlur={e  => e.target.style.borderColor = C.navyLight}/>
                      <button type="submit" disabled={busy || !replyText.trim()}
                        style={{
                          width:"100%", padding:10, borderRadius:10, border:"none",
                          background:C.blue, color:"#fff", cursor:"pointer",
                          fontWeight:700, fontSize:13,
                          opacity: busy || !replyText.trim() ? 0.6 : 1,
                        }}>
                        {busy ? "Sending…" : "Send Reply"}
                      </button>
                    </form>
                  )}

                  {selected.ticket.status === "closed" && (
                    <div style={{ textAlign:"center", color:C.textFaint, fontSize:11, padding:"8px 0" }}>
                      This ticket is closed. Tap "Reopen Ticket" above to continue the conversation.
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
