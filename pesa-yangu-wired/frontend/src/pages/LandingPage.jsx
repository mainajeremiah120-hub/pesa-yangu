/**
 * frontend/src/pages/LandingPage.jsx
 * Marketing entry point shown to signed-out visitors before AuthPage.
 * Deep-green palette (Jeremy's preferred direction for this page
 * specifically — the main app itself stays neutral/no-tint, this is a
 * deliberate exception). Flat throughout regardless: hairline borders only,
 * no box-shadow, no gradient glow — nothing "shaded".
 */
import { useState, useEffect } from "react";

const TEAL    = "#2ABFAA";
const GOLD    = "#D4A843";
const CORAL   = "#E07070";
const INK     = "#0F2419";
const PANEL   = "#153323";
const PANEL2  = "#1A3D2B";
const TEXT    = "#F2EFE6";
const MUTED   = "#8A9E8F";
const FAINT   = "#5A7268";
const HAIRLINE = "rgba(255,255,255,0.08)";

const display = "'Sora', 'Inter', -apple-system, sans-serif";
const sans    = "'Inter', -apple-system, sans-serif";

// ── Icons — all stroke=currentColor, no emoji anywhere on this page ────────
const IconTarget = (p) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/></svg>;
const IconFlag   = (p) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M6 3v18"/><path d="M6 4h11l-2.5 3.5L17 11H6"/></svg>;
const IconLoan   = (p) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M5 4h11l3 3v13H5z"/><path d="M9 10h6M9 14h6"/></svg>;
const IconTrend  = (p) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 17l5-5 4 4 7-8"/><path d="M15 8h5v5"/></svg>;
const IconShield = (p) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>;
const IconRepeat = (p) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 12a8 8 0 0114-5.3M20 5v5h-5"/><path d="M20 12a8 8 0 01-14 5.3M4 19v-5h5"/></svg>;
const IconBank   = (p) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 10l9-6 9 6"/><path d="M5 10v9M19 10v9M9 10v9M15 10v9"/><path d="M3 19h18"/></svg>;
const IconUndo   = (p) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M9 14l-4-4 4-4"/><path d="M5 10h9a5 5 0 015 5v1"/></svg>;
const IconPulse  = (p) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="8.5"/><path d="M8 12h2l1.5 3L14 9l1.5 3H16"/></svg>;
const IconLink   = (p) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M9 15l6-6"/><path d="M11 5.5l1-1a3.5 3.5 0 015 5l-1 1"/><path d="M13 18.5l-1 1a3.5 3.5 0 01-5-5l1-1"/></svg>;
const IconX      = (p) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" {...p}><path d="M6 6l12 12M18 6L6 18"/></svg>;
const IconCheck  = (p) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 12l5 5L20 6"/></svg>;
const IconArrow  = (p) => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M9 6l6 6-6 6"/></svg>;
const IconUp     = (p) => <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 19V5M5 12l7-7 7 7"/></svg>;

const FEATURES = [
  { icon: IconTarget, name: "Budget Tracking",   desc: "Set monthly limits by category — rent, food, transport, utilities. See what's left in real time before you spend it." },
  { icon: IconFlag,   name: "Savings Goals",      desc: "Emergency fund, school fees, a car — set a target and deadline, and fund it straight from an account." },
  { icon: IconLoan,   name: "Loans & Debt",       desc: "Track every loan with compound interest and full repayment history. See exactly how much is left and where it's going." },
  { icon: IconTrend,  name: "Investments",        desc: "Log returns as they come in. Portfolio value and gains update on your dashboard automatically." },
  { icon: IconShield, name: "Insurance Tracker",  desc: "Every policy, every premium payment, in one place — so you always know what's paid and what's due." },
  { icon: IconRepeat, name: "Recurring Bills",    desc: "DSTV, rent, power, internet — set it up once and Pesa Yangu keeps it on your budget automatically." },
  { icon: IconBank,   name: "Multi-Account",      desc: "Every wallet, bank and mobile-money account in one view. Net worth calculated across all of them." },
  { icon: IconUndo,   name: "Refund Tracking",    desc: "Log an overcharge or refund and it credits back to your wallet, adjusting your category spend automatically." },
  { icon: IconPulse,  name: "Financial Health Score", desc: "One score built from your savings rate, debt and goals — so you always know where you actually stand." },
];

const STEPS = [
  { title: "Create your account",   desc: "Sign up with your email in under a minute. Free, no card required." },
  { title: "Add your accounts",     desc: "Add your wallets, bank and mobile-money accounts with their current balances." },
  { title: "See your full picture", desc: "Your dashboard shows net worth, spending, savings progress and debt — all in one view." },
];

const CTAButton = ({ children, onClick, small, style }) => (
  <button onClick={onClick} className="py-cta"
    style={{ fontFamily:sans, fontWeight:700, fontSize:small?12.5:14, color:INK, background:TEAL,
      border:"none", borderRadius:10, padding:small?"11px 20px":"15px 28px", display:"inline-flex", alignItems:"center", gap:8,
      cursor:"pointer", ...style }}>
    {children}
  </button>
);

export default function LandingPage({ onGetStarted, onSignIn }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", h);
    return () => window.removeEventListener("scroll", h);
  }, []);

  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div style={{ background:INK, color:TEXT, fontFamily:sans, minHeight:"100vh" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@700;800&family=Inter:wght@400;500;600;700;800&display=swap');
        *{box-sizing:border-box;}
        .py-cta{transition:opacity .15s;}
        .py-cta:hover{opacity:.85;}
        .py-navlink{cursor:pointer; transition:color .15s;}
        .py-navlink:hover{color:${TEXT};}
        .py-feat-card{transition:background .15s;}
        .py-feat-card:hover{background:${PANEL2};}
        .py-hero{display:flex; gap:56px; align-items:center;}
        .py-problem{display:grid; grid-template-columns:1fr 1fr; gap:64px; align-items:center;}
        .py-feat-grid{display:grid; grid-template-columns:repeat(3,1fr); gap:1px; background:${HAIRLINE}; border:1px solid ${HAIRLINE}; border-radius:16px; overflow:hidden;}
        .py-steps{display:grid; grid-template-columns:repeat(3,1fr); gap:40px;}
        .py-spotlight{display:flex; gap:56px;}
        @media (max-width:900px){
          .py-hero{flex-direction:column;}
          .py-problem{grid-template-columns:1fr; gap:36px;}
          .py-feat-grid{grid-template-columns:1fr 1fr;}
          .py-steps{grid-template-columns:1fr; gap:28px;}
          .py-spotlight{flex-direction:column; gap:32px;}
          .py-navlinks{display:none !important;}
        }
        @media (max-width:560px){ .py-feat-grid{grid-template-columns:1fr;} }
      `}</style>

      {/* Nav */}
      <div style={{ position:"sticky", top:0, zIndex:10, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"18px 24px",
        background: scrolled ? "rgba(10,10,11,0.94)" : "transparent",
        backdropFilter: scrolled ? "blur(10px)" : "none",
        borderBottom: scrolled ? `1px solid ${HAIRLINE}` : "1px solid transparent", transition:"all .2s" }}>
        <div style={{ display:"flex", alignItems:"center", gap:11 }}>
          <div style={{ width:32, height:32, background:`linear-gradient(135deg,${TEAL},${GOLD})`, borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, fontWeight:800, color:INK }}>◈</div>
          <div style={{ fontFamily:display, fontWeight:800, fontSize:17 }}>Pesa Yangu</div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:30 }}>
          <div className="py-navlinks" style={{ display:"flex", alignItems:"center", gap:30 }}>
            <span className="py-navlink" onClick={()=>scrollTo("features")} style={{ fontSize:13, fontWeight:600, color:MUTED }}>Features</span>
            <span className="py-navlink" onClick={()=>scrollTo("household")} style={{ fontSize:13, fontWeight:600, color:MUTED }}>Household</span>
            <span className="py-navlink" onClick={()=>scrollTo("how")} style={{ fontSize:13, fontWeight:600, color:MUTED }}>How it works</span>
            <span className="py-navlink" onClick={onSignIn} style={{ fontSize:13, fontWeight:600, color:MUTED }}>Sign In</span>
          </div>
          <CTAButton onClick={onGetStarted} small>Get Started <IconArrow/></CTAButton>
        </div>
      </div>

      {/* Hero */}
      <div className="py-hero" style={{ maxWidth:1120, margin:"0 auto", padding:"64px 24px 88px" }}>
        <div style={{ flex:1.05 }}>
          <div style={{ display:"inline-flex", alignItems:"center", gap:8, background:TEAL+"14", border:`1px solid ${TEAL}44`, color:TEAL, fontSize:12, fontWeight:700, padding:"6px 14px", borderRadius:100, marginBottom:26 }}>
            <span style={{ width:6, height:6, borderRadius:"50%", background:TEAL }}/>
            Built for Kenya
          </div>
          <h1 style={{ fontFamily:display, fontWeight:800, fontSize:"clamp(34px,5vw,54px)", lineHeight:1.08, letterSpacing:"-0.02em", margin:"0 0 22px", textWrap:"balance" }}>
            Your money,<br/><span style={{ color:TEAL }}>finally making sense.</span>
          </h1>
          <p style={{ fontSize:16.5, color:MUTED, lineHeight:1.5, maxWidth:440, marginBottom:24 }}>
            Budgets, goals, loans, investments and insurance — one clean app built for how people actually manage money, with a shared ledger two partners can hold the pen on together.
          </p>
          <div style={{ display:"flex", alignItems:"center", gap:20, flexWrap:"wrap" }}>
            <CTAButton onClick={onGetStarted}>Start Free Today <IconArrow/></CTAButton>
            <span className="py-navlink" onClick={()=>scrollTo("features")} style={{ fontSize:13.5, color:MUTED, fontWeight:600, display:"flex", alignItems:"center", gap:6 }}>See what it does <IconArrow/></span>
          </div>
          <div style={{ display:"flex", gap:36, marginTop:44, flexWrap:"wrap" }}>
            <div><div style={{ fontFamily:display, fontSize:20, fontWeight:800, color:TEAL }}>KES</div><div style={{ fontSize:11.5, color:MUTED, marginTop:2 }}>Native currency</div></div>
            <div><div style={{ fontFamily:display, fontSize:20, fontWeight:800, color:TEAL }}>Free</div><div style={{ fontSize:11.5, color:MUTED, marginTop:2 }}>To get started</div></div>
            <div><div style={{ fontFamily:display, fontSize:20, fontWeight:800, color:TEAL }}>2</div><div style={{ fontSize:11.5, color:MUTED, marginTop:2 }}>Logins, one ledger</div></div>
          </div>
        </div>

        {/* Sample dashboard panel */}
        <div style={{ flex:0.95, display:"flex", justifyContent:"center" }}>
          <div style={{ width:280, background:PANEL, border:`1px solid ${HAIRLINE}`, borderRadius:20, padding:"18px 16px 20px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
              <span style={{ fontFamily:display, fontSize:12.5, fontWeight:700 }}>Dashboard</span>
              <span style={{ fontSize:9.5, color:TEAL, fontWeight:700, background:TEAL+"18", padding:"3px 9px", borderRadius:100 }}>SAMPLE · SCORE 84</span>
            </div>
            <div style={{ background:PANEL2, border:`1px solid ${HAIRLINE}`, borderRadius:14, padding:14, marginBottom:10 }}>
              <div style={{ fontSize:9.5, color:MUTED, marginBottom:3 }}>Total balance</div>
              <div style={{ fontFamily:display, fontSize:20, fontWeight:800 }}>KSh 239,800</div>
              <div style={{ display:"flex", alignItems:"center", gap:4, fontSize:9.5, color:TEAL, marginTop:4 }}><IconUp/> KSh 12,400 this month</div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10 }}>
              {[["Income","110,000",TEAL],["Expenses","37,100",TEXT],["Debt left","368,000",CORAL],["Goal saved","62%",GOLD]].map(([l,v,c])=>(
                <div key={l} style={{ background:PANEL2, border:`1px solid ${HAIRLINE}`, borderRadius:11, padding:"9px 10px" }}>
                  <div style={{ fontSize:8.5, color:MUTED, textTransform:"uppercase", letterSpacing:"0.04em", marginBottom:3 }}>{l}</div>
                  <div style={{ fontFamily:display, fontSize:12.5, fontWeight:700, color:c }}>{v}</div>
                </div>
              ))}
            </div>
            {[["Food","9,800","15,000",65,GOLD],["Rent","25,000","25,000",100,TEAL]].map(([l,a,b,pct,c])=>(
              <div key={l} style={{ marginBottom:8 }}>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:9.5, color:MUTED, marginBottom:4 }}><span>{l}</span><span>{a} / {b}</span></div>
                <div style={{ height:5, background:PANEL2, borderRadius:3, overflow:"hidden" }}><div style={{ width:`${pct}%`, height:"100%", background:c }}/></div>
              </div>
            ))}
            <div style={{ marginTop:12, paddingTop:10, borderTop:`1px solid ${HAIRLINE}` }}>
              <div style={{ fontSize:9, color:MUTED, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:8 }}>Recent</div>
              {[["Salary","Income · Bank",TEAL,"+95,000"],["Groceries","Food · M-Pesa",TEXT,"−4,800"],["Transport","Uber · M-Pesa",TEXT,"−2,100"]].map(([n,s,c,a])=>(
                <div key={n} style={{ display:"flex", alignItems:"center", gap:9, padding:"7px 0", borderBottom:`1px solid ${HAIRLINE}` }}>
                  <div style={{ width:26, height:26, borderRadius:8, background:PANEL2, flexShrink:0 }}/>
                  <div style={{ flex:1, minWidth:0 }}><div style={{ fontSize:11, fontWeight:600 }}>{n}</div><div style={{ fontSize:9, color:MUTED }}>{s}</div></div>
                  <div style={{ fontSize:11, fontWeight:700, color:c }}>{a}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Problem */}
      <div style={{ borderTop:`1px solid ${HAIRLINE}`, borderBottom:`1px solid ${HAIRLINE}`, background:PANEL }}>
        <div className="py-problem" style={{ maxWidth:1120, margin:"0 auto", padding:"80px 24px" }}>
          <div>
            <div style={{ fontSize:12.5, fontWeight:700, color:GOLD, marginBottom:14 }}>SOUND FAMILIAR?</div>
            <h2 style={{ fontFamily:display, fontWeight:800, fontSize:"clamp(26px,3.6vw,36px)", lineHeight:1.15, marginBottom:30, textWrap:"balance" }}>You earn well. But where does it go?</h2>
            <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
              {[
                ["Salary arrives, disappears.", "By the 20th you're wondering where it all went."],
                ["Several accounts, zero visibility.", "Bank, mobile money, SACCO — no idea what the combined total is."],
                ["Loans feel endless.", "Repayments every month, but no idea when you'll actually be free."],
                ["Insurance, investments and goals", "scattered across apps, statements and notebooks."],
              ].map(([b,t]) => (
                <div key={b} style={{ display:"flex", gap:13, alignItems:"flex-start" }}>
                  <div style={{ width:26, height:26, flexShrink:0, borderRadius:7, background:CORAL+"14", border:`1px solid ${CORAL}33`, color:CORAL, display:"flex", alignItems:"center", justifyContent:"center", marginTop:1 }}><IconX/></div>
                  <div style={{ fontSize:14.5, color:MUTED, lineHeight:1.6 }}><strong style={{ color:TEXT, fontWeight:600 }}>{b}</strong> {t}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ background:INK, border:`1px solid ${HAIRLINE}`, borderRadius:18, padding:"38px 34px" }}>
            <p style={{ fontSize:17, color:TEXT, lineHeight:1.5, marginBottom:10 }}>Most people are not bad with money. They just have <span style={{ color:TEAL, fontWeight:600 }}>no single place to see all of it</span> at once.</p>
            <p style={{ fontSize:14.5, color:MUTED, lineHeight:1.55 }}>Pesa Yangu puts your entire financial picture — income, spending, debt, savings, investments, insurance — in one clean view, so you can make smarter decisions with what you already earn.</p>
          </div>
        </div>
      </div>

      {/* Features */}
      <div id="features" style={{ maxWidth:1120, margin:"0 auto", padding:"88px 24px" }}>
        <div style={{ fontSize:12.5, fontWeight:700, color:GOLD, marginBottom:14 }}>WHAT PESA YANGU DOES</div>
        <h2 style={{ fontFamily:display, fontWeight:800, fontSize:"clamp(26px,3.6vw,36px)", marginBottom:14 }}>Everything, in one app</h2>
        <p style={{ fontSize:15.5, color:MUTED, lineHeight:1.5, maxWidth:480, marginBottom:28 }}>Built around how people actually manage money — mobile money, bank accounts, and everything in between.</p>
        <div className="py-feat-grid">
          {FEATURES.map(f => (
            <div key={f.name} className="py-feat-card" style={{ background:PANEL, padding:"30px 26px" }}>
              <div style={{ color:TEAL, marginBottom:16 }}><f.icon/></div>
              <div style={{ fontFamily:display, fontSize:15.5, fontWeight:700, marginBottom:8 }}>{f.name}</div>
              <div style={{ fontSize:13, color:MUTED, lineHeight:1.6 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Household spotlight */}
      <div id="household" style={{ borderTop:`1px solid ${HAIRLINE}`, borderBottom:`1px solid ${HAIRLINE}`, background:PANEL }}>
        <div className="py-spotlight" style={{ maxWidth:1120, margin:"0 auto", padding:"80px 24px" }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:12.5, fontWeight:700, color:GOLD, marginBottom:14 }}>FEATURED</div>
            <h2 style={{ fontFamily:display, fontWeight:800, fontSize:"clamp(24px,3.2vw,32px)", lineHeight:1.2, marginBottom:16 }}>Household Accounts</h2>
            <p style={{ fontSize:14.5, color:MUTED, lineHeight:1.5, maxWidth:440, marginBottom:14 }}>
              Two people, two logins, one shared financial life. Generate a code, your partner enters it once, and every wallet, loan, goal and shift in net worth is visible to both — instantly.
            </p>
            <span className="py-navlink" onClick={onGetStarted} style={{ display:"inline-flex", alignItems:"center", gap:8, fontSize:13.5, fontWeight:700, color:TEAL }}>See how it works <IconArrow/></span>
          </div>
          <div style={{ flex:0.85, background:INK, border:`1px solid ${HAIRLINE}`, borderRadius:16, padding:26, display:"flex", flexDirection:"column", alignItems:"center", minWidth:240 }}>
            <div style={{ color:TEAL, marginBottom:14 }}><IconLink/></div>
            <div style={{ fontSize:10, letterSpacing:"0.06em", color:MUTED, marginBottom:12 }}>YOUR INVITE CODE</div>
            <div style={{ fontFamily:display, fontWeight:800, fontSize:24, letterSpacing:"0.06em", color:TEAL, marginBottom:18 }}>7XK4&#8209;9PLM</div>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ width:28, height:28, borderRadius:"50%", background:TEAL+"18", border:`1px solid ${TEAL}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color:TEAL }}>A</div>
              <div style={{ width:18, height:1, background:TEAL }}/>
              <div style={{ width:28, height:28, borderRadius:"50%", border:`1px dashed ${FAINT}` }}/>
            </div>
          </div>
        </div>
      </div>

      {/* How it works */}
      <div id="how" style={{ maxWidth:1120, margin:"0 auto", padding:"88px 24px" }}>
        <div style={{ fontSize:12.5, fontWeight:700, color:GOLD, marginBottom:14 }}>GETTING STARTED</div>
        <h2 style={{ fontFamily:display, fontWeight:800, fontSize:"clamp(26px,3.6vw,36px)", marginBottom:46 }}>Up and running in minutes</h2>
        <div className="py-steps">
          {STEPS.map((s,i) => (
            <div key={s.title}>
              <div style={{ width:44, height:44, borderRadius:12, background:PANEL, border:`1px solid ${HAIRLINE}`, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:display, fontSize:17, fontWeight:800, color:TEAL, marginBottom:18 }}>{i+1}</div>
              <div style={{ fontFamily:display, fontSize:15.5, fontWeight:700, marginBottom:8 }}>{s.title}</div>
              <div style={{ fontSize:13.5, color:MUTED, lineHeight:1.65 }}>{s.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div style={{ borderTop:`1px solid ${HAIRLINE}`, background:PANEL }}>
        <div style={{ maxWidth:620, margin:"0 auto", padding:"88px 24px", textAlign:"center" }}>
          <h2 style={{ fontFamily:display, fontWeight:800, fontSize:"clamp(26px,3.6vw,38px)", marginBottom:16 }}>Take control of your money today.</h2>
          <p style={{ fontSize:15, color:MUTED, lineHeight:1.5, marginBottom:22 }}>Start budgeting smarter, saving with purpose, and understanding your financial health for the first time — free, with no card required.</p>
          <div style={{ display:"flex", gap:14, justifyContent:"center", flexWrap:"wrap" }}>
            <CTAButton onClick={onGetStarted} style={{ padding:"15px 30px" }}>Get Started Free <IconArrow/></CTAButton>
            <span className="py-navlink" onClick={()=>scrollTo("features")} style={{ fontSize:14, color:MUTED, fontWeight:600, padding:"15px 22px", border:`1px solid ${HAIRLINE}`, borderRadius:10 }}>See all features</span>
          </div>
          <div style={{ fontSize:12, color:FAINT, marginTop:20 }}>Free to use · No card required · Built for Kenya</div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"30px 24px", flexWrap:"wrap", gap:12, maxWidth:1120, margin:"0 auto" }}>
        <div style={{ display:"flex", alignItems:"center", gap:9 }}>
          <div style={{ width:20, height:20, background:`linear-gradient(135deg,${TEAL},${GOLD})`, borderRadius:6, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:800, color:INK }}>◈</div>
          <span style={{ fontSize:12, color:FAINT }}>Pesa Yangu · Private Ledger</span>
        </div>
        <div style={{ display:"flex", gap:24 }}>
          <span className="py-navlink" onClick={()=>scrollTo("features")} style={{ fontSize:12.5, color:MUTED }}>Features</span>
          <span className="py-navlink" onClick={()=>scrollTo("how")} style={{ fontSize:12.5, color:MUTED }}>How it works</span>
          <span className="py-navlink" onClick={onSignIn} style={{ fontSize:12.5, color:MUTED }}>Sign In</span>
        </div>
        <span style={{ fontSize:12, color:FAINT }}>pesayangu.africa</span>
      </div>
    </div>
  );
}
