/**
 * ChatWidget.jsx
 * Floating support chat bubble (bottom-right). Sends straight into the same
 * support_tickets / ticket_messages tables the full Support Tickets screen
 * and the admin dashboard already use — this is just a lightweight always-
 * visible front door onto that existing conversation thread.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { ticketsApi } from "../lib/api.js";

const LIST_POLL_MS   = 25000; // refresh ticket list (cheap) while mounted
const THREAD_POLL_MS = 12000; // refresh open thread while panel is open
const SEEN_KEY = "py_chat_last_seen";
const ACTIVE_STATUSES = ["open", "in_progress"];

function relTime(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function ChatWidget({ user, C, showToast }) {
  const [open,        setOpen]        = useState(false);
  const [tickets,     setTickets]     = useState([]);
  const [activeId,    setActiveId]    = useState(null);
  const [messages,    setMessages]    = useState([]);
  const [input,       setInput]       = useState("");
  const [sending,     setSending]     = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [lastSeenAt,  setLastSeenAt]  = useState(() => localStorage.getItem(SEEN_KEY) || "");
  const scrollRef = useRef(null);

  const active = tickets.find(t => t.id === activeId) || null;

  const markSeen = useCallback(() => {
    const now = new Date().toISOString();
    localStorage.setItem(SEEN_KEY, now);
    setLastSeenAt(now);
  }, []);

  const refreshList = useCallback(async () => {
    try {
      const { tickets: rows } = await ticketsApi.list();
      setTickets(rows || []);
      if (!activeId) {
        const mostRecentActive = rows?.find(t => ACTIVE_STATUSES.includes(t.status));
        if (mostRecentActive) setActiveId(mostRecentActive.id);
      }
    } catch { /* silent — this is a background poll */ }
  }, [activeId]);

  const loadThread = useCallback(async (id) => {
    if (!id) return;
    setLoadingThread(true);
    try {
      const { messages: msgs } = await ticketsApi.get(id);
      setMessages(msgs || []);
    } catch { /* ignore */ }
    finally { setLoadingThread(false); }
  }, []);

  useEffect(() => { refreshList(); }, []); // eslint-disable-line
  useEffect(() => {
    const id = setInterval(refreshList, LIST_POLL_MS);
    return () => clearInterval(id);
  }, [refreshList]);

  useEffect(() => {
    if (open && activeId) {
      loadThread(activeId);
      markSeen();
      const id = setInterval(() => loadThread(activeId), THREAD_POLL_MS);
      return () => clearInterval(id);
    }
  }, [open, activeId, loadThread, markSeen]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open]);

  const unread = !open && active && new Date(active.updated_at) > new Date(lastSeenAt || 0);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      if (active && ACTIVE_STATUSES.includes(active.status)) {
        const { message } = await ticketsApi.addMessage(active.id, text);
        setMessages(m => [...m, message]);
        setTickets(ts => ts.map(t => t.id === active.id ? { ...t, updated_at: new Date().toISOString() } : t));
      } else {
        const { ticket } = await ticketsApi.create({ subject: "Live chat", message: text, category: "general", priority: "normal" });
        setTickets(ts => [ticket, ...ts]);
        setActiveId(ticket.id);
        setMessages([{ id: `${ticket.id}_init`, message: text, sender_role: "user", created_at: ticket.created_at, full_name: user?.full_name }]);
      }
      setInput("");
      markSeen();
    } catch (err) {
      showToast?.(err?.response?.data?.error || "Couldn't send — please try again.", C.coral);
    } finally {
      setSending(false);
    }
  };

  const showWaitingNotice = active
    && ACTIVE_STATUSES.includes(active.status)
    && messages.length > 0
    && !messages.some(m => m.sender_role === "admin");

  if (!user || user.role === "admin") return null;

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Support chat"
        style={{
          position: "fixed", right: 18, bottom: 18, zIndex: 1400,
          width: 54, height: 54, borderRadius: "50%",
          background: `linear-gradient(135deg,${C.teal},${C.blue})`,
          border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 24, boxShadow: "0 6px 20px #0006",
        }}
      >
        {open ? "✕" : "💬"}
        {unread && !open && (
          <span style={{
            position: "absolute", top: -2, right: -2, width: 14, height: 14, borderRadius: "50%",
            background: C.coral, border: `2px solid ${C.navy||"#0B1120"}`,
          }}/>
        )}
      </button>

      {open && (
        <div style={{
          position: "fixed", right: 18, bottom: 82, zIndex: 1400,
          width: "min(340px, calc(100vw - 36px))", height: "min(460px, calc(100vh - 140px))",
          background: C.navyMid, border: `1px solid ${C.navyLight}`, borderRadius: 16,
          display: "flex", flexDirection: "column", overflow: "hidden",
          boxShadow: "0 12px 40px #0008",
        }}>
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.navyLight}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: C.textPrimary }}>Support Chat</div>
              <div style={{ fontSize: 10, color: C.textMuted }}>We usually reply within a day</div>
            </div>
            <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: C.textMuted, cursor: "pointer", fontSize: 16 }}>✕</button>
          </div>

          <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
            {!active && (
              <div style={{ color: C.textMuted, fontSize: 12, textAlign: "center", marginTop: 30 }}>
                👋 Send us a message and we'll get back to you here.
              </div>
            )}
            {loadingThread && messages.length === 0 && (
              <div style={{ color: C.textMuted, fontSize: 12, textAlign: "center", marginTop: 30 }}>Loading…</div>
            )}
            {messages.map(m => {
              const mine = m.sender_role === "user";
              return (
                <div key={m.id} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
                  <div style={{
                    maxWidth: "80%", padding: "8px 12px", borderRadius: 12,
                    background: mine ? C.teal : C.navyLight,
                    color: mine ? "#0B1120" : C.textPrimary,
                    fontSize: 12.5, lineHeight: 1.4,
                  }}>
                    {!mine && <div style={{ fontSize: 10, fontWeight: 700, color: C.teal, marginBottom: 2 }}>Support</div>}
                    <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.message}</div>
                    <div style={{ fontSize: 9, opacity: 0.7, marginTop: 3, textAlign: "right" }}>{relTime(m.created_at)}</div>
                  </div>
                </div>
              );
            })}
            {showWaitingNotice && (
              <div style={{ alignSelf: "center", background: C.gold + "22", color: C.gold, fontSize: 11, padding: "6px 12px", borderRadius: 10, textAlign: "center", marginTop: 4 }}>
                🙏 Thanks for reaching out — please bear with us while we take a look into it. We'll reply right here.
              </div>
            )}
            {active?.status === "resolved" && (
              <div style={{ alignSelf: "center", color: C.textMuted, fontSize: 11, padding: "6px 12px", textAlign: "center" }}>
                This conversation was marked resolved. Sending a new message will reopen it.
              </div>
            )}
          </div>

          <div style={{ padding: 10, borderTop: `1px solid ${C.navyLight}`, display: "flex", gap: 8 }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Type a message…"
              style={{ flex: 1, background: C.navyLight, border: "none", borderRadius: 10, color: C.textPrimary, padding: "9px 12px", fontSize: 12.5, outline: "none" }}
            />
            <button
              onClick={send}
              disabled={!input.trim() || sending}
              style={{
                background: C.teal, border: "none", borderRadius: 10, padding: "0 14px",
                color: "#0B1120", fontWeight: 700, fontSize: 12.5,
                cursor: (!input.trim() || sending) ? "not-allowed" : "pointer",
                opacity: (!input.trim() || sending) ? 0.5 : 1,
              }}
            >
              {sending ? "…" : "Send"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
