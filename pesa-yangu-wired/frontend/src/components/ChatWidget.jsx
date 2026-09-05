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
const DISMISS_KEY = "py_chat_dismissed"; // sessionStorage — clears on next login/session, same pattern as py_unlocked
const ACTIVE_STATUSES = ["open", "in_progress"]; // statuses a follow-up message can be added to

// Lightweight local FAQ layer — instant answers for common "how do I use X"
// questions, so someone isn't stuck waiting a day for something we already
// know how to explain. These replies are client-side only (never sent to
// the backend); anything that doesn't match still goes to the real support
// queue exactly as before.
const FAQ = [
  { keywords: ["goal", "goals", "target", "save for"], reply: "Tap Goals in the sidebar, then \"+ New Savings Goal\". Set a target amount and the account to fund it from — you can add money to it any time from there." },
  { keywords: ["budget", "budgets", "overspend", "category limit"], reply: "Open Budgets to set a flat cap per category, or switch to Percentage mode in Settings → Budgeting Style so your caps recalculate automatically from your income each month." },
  { keywords: ["saving", "savings rate"], reply: "Your Dashboard shows your savings rate automatically (income minus expenses, as a %). To save toward something specific, set up a Goal — tap Goals → \"+ New Savings Goal\"." },
  { keywords: ["loan", "loans", "repayment", "interest"], reply: "Open Loans → \"+ Add Loan\". Record repayments as you make them — Pesa Yangu tracks compound interest and your remaining balance automatically." },
  { keywords: ["invest", "investment", "portfolio", "returns"], reply: "Open Invest → \"+ Add Investment\". Log returns as they come in and your portfolio value updates on the Dashboard automatically." },
  { keywords: ["insurance", "premium", "policy"], reply: "Open Insurance → \"+ Add Policy\". Record each premium payment as you make it so you can see what's paid and what's due." },
  { keywords: ["recurring", "subscription", "every month"], reply: "Open Recurring → \"+ Add Recurring\" to set up a transaction that repeats on its own schedule." },
  { keywords: ["reconcile", "statement", "mpesa statement", "m-pesa statement", "bank statement"], reply: "Open Reconcile, upload your bank or M-Pesa statement, and match it line by line against what you've already recorded." },
  { keywords: ["household", "partner", "spouse", "wife", "husband", "link account", "linked account", "invite code"], reply: "Go to Settings → Household, generate an invite code, and share it with your partner. Once they join, you'll share every wallet, transaction, budget and goal — with separate logins." },
  { keywords: ["account", "wallet", "bank account", "mobile money"], reply: "Go to Accounts → \"+ Add Account\" to add a wallet, mobile-money, or bank account. You can transfer between accounts from there too." },
  { keywords: ["transaction", "record", "expense", "income", "history"], reply: "Tap \"+ Add Transaction\" anywhere in the app to log one, or open Records to see your full history and filter by date or category." },
];
function matchFaq(text) {
  const t = text.toLowerCase();
  return FAQ.find(f => f.keywords.some(k => t.includes(k))) || null;
}
const GREETING = "Hi! I'm the Pesa Yangu assistant. Ask me how to use Budgets, Goals, Loans, Investments, Insurance, Recurring, Reconcile, or Household sharing — I can help right away. For anything else, I'll bring in our support team.";
const HANDOFF  = "Thanks for reaching out — I'll hand this over to our support team, please bear with us a little while they take a look. They'll reply right here.";

function XIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="6" y1="6" x2="18" y2="18"/>
      <line x1="18" y1="6" x2="6" y2="18"/>
    </svg>
  );
}

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
  const [dismissed,   setDismissed]   = useState(() => sessionStorage.getItem(DISMISS_KEY) === "1");
  const [tickets,     setTickets]     = useState([]);
  const [messages,    setMessages]    = useState([]);
  const [input,       setInput]       = useState("");
  const [sending,     setSending]     = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [lastSeenAt,  setLastSeenAt]  = useState(() => localStorage.getItem(SEEN_KEY) || "");
  const [botMessages, setBotMessages] = useState([]); // local-only assistant replies (greeting, FAQ, hand-off notice)
  const scrollRef = useRef(null);
  const seenAdminReplyRef = useRef(new Map()); // ticketId -> last admin_reply text we've already reacted to
  const hasPolledOnceRef = useRef(false); // avoid toasting for a reply that arrived before this tab was open

  // Server already orders GET /tickets by updated_at DESC — the most
  // recently active conversation (of ANY status) is what the widget shows.
  // A ticket being "resolved" must not make its reply disappear from view.
  const active = tickets[0] || null;

  const markSeen = useCallback(() => {
    const now = new Date().toISOString();
    localStorage.setItem(SEEN_KEY, now);
    setLastSeenAt(now);
  }, []);

  const loadThread = useCallback(async (id) => {
    if (!id) return;
    setLoadingThread(true);
    try {
      const { messages: msgs } = await ticketsApi.get(id);
      setMessages(msgs || []);
    } catch { /* ignore */ }
    finally { setLoadingThread(false); }
  }, []);

  const refreshList = useCallback(async () => {
    try {
      const { tickets: rows } = await ticketsApi.list();
      setTickets(rows || []);
      // Best-effort live nudge: only for a reply that changes *during this
      // tab's session* (not one that already existed when it was opened) —
      // the persistent unread dot (driven by lastSeenAt) covers the rest.
      (rows || []).forEach(t => {
        const seen = seenAdminReplyRef.current.get(t.id);
        if (hasPolledOnceRef.current && t.admin_reply && t.admin_reply !== seen && !open) {
          showToast?.("💬 Support replied to your message", C.teal);
        }
        if (t.admin_reply) seenAdminReplyRef.current.set(t.id, t.admin_reply);
      });
      hasPolledOnceRef.current = true;
    } catch { /* silent — this is a background poll */ }
  }, [open, showToast, C.teal]);

  useEffect(() => { refreshList(); }, []); // eslint-disable-line
  useEffect(() => {
    const id = setInterval(refreshList, LIST_POLL_MS);
    return () => clearInterval(id);
  }, [refreshList]);

  useEffect(() => {
    if (open && active) {
      loadThread(active.id);
      markSeen();
      const id = setInterval(() => loadThread(active.id), THREAD_POLL_MS);
      return () => clearInterval(id);
    }
  }, [open, active?.id, loadThread, markSeen]); // eslint-disable-line

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, botMessages, open]);

  // Greet once per fresh (ticket-less) visit to the panel.
  useEffect(() => {
    if (open && !active && botMessages.length === 0) {
      setBotMessages([{ id: "bot-greeting", message: GREETING, sender_role: "bot", created_at: new Date().toISOString() }]);
    }
  }, [open, active, botMessages.length]);

  const unread = !open && active && new Date(active.updated_at) > new Date(lastSeenAt || 0);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    const isFreshConversation = !(active && ACTIVE_STATUSES.includes(active.status));
    try {
      if (active && ACTIVE_STATUSES.includes(active.status)) {
        const { message } = await ticketsApi.addMessage(active.id, text);
        setMessages(m => [...m, message]);
        setTickets(ts => ts.map(t => t.id === active.id ? { ...t, updated_at: new Date().toISOString() } : t)
          .sort((a,b) => new Date(b.updated_at) - new Date(a.updated_at)));
      } else {
        const { ticket } = await ticketsApi.create({ subject: "Live chat", message: text, category: "general", priority: "normal" });
        setTickets(ts => [ticket, ...ts]);
        setMessages([{ id: `${ticket.id}_init`, message: text, sender_role: "user", created_at: ticket.created_at, full_name: user?.full_name }]);
      }
      setInput("");
      markSeen();

      // Instant local assistant reply — a matched FAQ answers right away;
      // anything unmatched gets a one-time hand-off notice (only for the
      // first message of a fresh conversation — an ongoing thread already
      // shows the persistent "waiting" banner below).
      const faq = matchFaq(text);
      if (faq) {
        setBotMessages(b => [...b, { id: `bot-${Date.now()}`, message: faq.reply, sender_role: "bot", created_at: new Date().toISOString() }]);
      } else if (isFreshConversation) {
        setBotMessages(b => [...b, { id: `bot-${Date.now()}`, message: HANDOFF, sender_role: "bot", created_at: new Date().toISOString() }]);
      }
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

  if (!user || user.role === "admin" || dismissed) return null;

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  return (
    <>
      {/* Mobile has a fixed 60px bottom nav bar (see .mobile-bottom-nav in
          App.jsx) sitting in this same bottom-right corner — push the widget
          up above it on narrow screens so it doesn't cover the "More" tab. */}
      <style>{`
        @media (max-width: 640px) {
          .chat-widget-btn   { bottom: 78px !important; }
          .chat-widget-panel { bottom: 142px !important; }
        }
      `}</style>
      <div className="chat-widget-btn" style={{ position: "fixed", right: 18, bottom: 18, zIndex: 1400, width: 54, height: 54 }}>
        <button
          onClick={() => setOpen(o => !o)}
          aria-label="Support chat"
          style={{
            width: "100%", height: "100%", borderRadius: "50%",
            background: `linear-gradient(135deg,${C.teal},${C.blue})`,
            border: "none", cursor: "pointer", color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 24, boxShadow: "0 6px 20px #0006",
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4"/>
            <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8"/>
          </svg>
          {unread && !open && (
            <span style={{
              position: "absolute", top: -2, right: -2, width: 14, height: 14, borderRadius: "50%",
              background: C.coral, border: `2px solid ${C.navy||"#0B1120"}`,
            }}/>
          )}
        </button>
        {/* Small dismiss badge riding on top of the bubble, separate from the
            open/close tap target — closing the panel and dismissing the
            widget for the session are two different actions now, not one
            button that means different things depending on state. */}
        <button
          onClick={dismiss}
          aria-label="Dismiss support chat"
          title="Dismiss — it'll be back next time you log in"
          style={{
            position: "absolute", top: -6, left: -6, width: 20, height: 20, borderRadius: "50%",
            background: C.navyMid, border: `1.5px solid ${C.navyLight}`, color: C.textMuted,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", padding: 0, boxShadow: "0 2px 6px #0006",
          }}
        >
          <XIcon size={11}/>
        </button>
      </div>

      {open && (
        <div className="chat-widget-panel" style={{
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
            {loadingThread && messages.length === 0 && (
              <div style={{ color: C.textMuted, fontSize: 12, textAlign: "center", marginTop: 30 }}>Loading…</div>
            )}
            {[...messages, ...botMessages].map(m => {
              const mine = m.sender_role === "user";
              const bot = m.sender_role === "bot";
              return (
                <div key={m.id} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
                  <div style={{
                    maxWidth: "80%", padding: "8px 12px", borderRadius: 12,
                    background: mine ? C.teal : C.navyLight,
                    color: mine ? C.navy : C.textPrimary,
                    fontSize: 12.5, lineHeight: 1.4,
                  }}>
                    {!mine && <div style={{ fontSize: 10, fontWeight: 700, color: bot ? C.gold : C.teal, marginBottom: 2 }}>{bot ? "Pesa Yangu Assistant" : "Support"}</div>}
                    <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.message}</div>
                    <div style={{ fontSize: 9, opacity: 0.7, marginTop: 3, textAlign: "right" }}>{relTime(m.created_at)}</div>
                  </div>
                </div>
              );
            })}
            {showWaitingNotice && (
              <div style={{ alignSelf: "center", background: C.gold + "22", color: C.gold, fontSize: 11, padding: "6px 12px", borderRadius: 10, textAlign: "center", marginTop: 4 }}>
                🙏 Thanks for reaching out, please bear with us while we take a look into it. We'll reply right here.
              </div>
            )}
            {active && !ACTIVE_STATUSES.includes(active.status) && (
              <div style={{ alignSelf: "center", color: C.textMuted, fontSize: 11, padding: "6px 12px", textAlign: "center" }}>
                This conversation is {active.status.replace("_"," ")}. Sending a new message will start a fresh one.
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
                color: C.navy, fontWeight: 700, fontSize: 12.5,
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
