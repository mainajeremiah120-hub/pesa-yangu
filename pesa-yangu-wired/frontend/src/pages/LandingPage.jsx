/**
 * frontend/src/pages/LandingPage.jsx
 * Marketing entry point shown to signed-out visitors before AuthPage.
 * Palette matches the in-app system: neutral dark surfaces, teal as the
 * primary accent, gold reserved for one secondary highlight — same as
 * theme.js's DARK tokens, so this page and the real app read as one thing.
 */
import { useState, useEffect } from "react";

const TEAL    = "#00D4AA";
const GOLD    = "#F5C842";
const INK     = "#0A0A0B";
const PANEL   = "#141414";
const TEXT    = "#F5F5F5";
const MUTED   = "#9B9B9B";
const FAINT   = "#5A5A5A";
const BAD     = "#FF6B6B";
const HAIRLINE = "rgba(255,255,255,0.1)";

const serif = "'DM Serif Display', Georgia, serif";
const mono  = "'Inter', -apple-system, sans-serif";

const IconLink = (props) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={TEAL} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M9 15l6-6"/><path d="M11 5.5l1-1a3.5 3.5 0 015 5l-1 1"/><path d="M13 18.5l-1 1a3.5 3.5 0 01-5-5l1-1"/>
  </svg>
);
const IconTarget = (props) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={TEAL} strokeWidth="1.6" {...props}>
    <circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>
  </svg>
);
const IconLoan = (props) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={TEAL} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M5 4h11l3 3v13H5z"/><path d="M9 10h6M9 14h6"/>
  </svg>
);
const IconCheck = (props) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={TEAL} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.5l2.3 2.3L16 9.5"/>
  </svg>
);
const IconArrow = (props) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M9 6l6 6-6 6"/>
  </svg>
);
const IconArrowTeal = (props) => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={TEAL} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M9 6l6 6-6 6"/>
  </svg>
);
const TriUp = () => <svg width="8" height="8" viewBox="0 0 10 10"><path d="M5 1l4 7H1z" fill={TEAL}/></svg>;

const CTAButton = ({ children, onClick, small }) => (
  <button onClick={onClick} className="py-cta"
    style={{ fontFamily:mono, fontWeight:700, fontSize:small?12:13, letterSpacing:"0.02em", color:INK, background:TEAL,
      border:"none", borderRadius:10, padding:small?"11px 20px":"14px 28px", display:"inline-flex", alignItems:"center", gap:9,
      cursor:"pointer" }}>
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

  const scrollTo = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div style={{ background:INK, color:TEXT, fontFamily:mono, minHeight:"100vh" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=DM+Serif+Display&display=swap');
        *{box-sizing:border-box;}
        .py-cta{transition:opacity .15s;}
        .py-cta:hover{opacity:.85;}
        .py-navlink{cursor:pointer; transition:color .15s;}
        .py-navlink:hover{color:${TEXT};}
        .py-hero{display:flex; gap:50px;}
        .py-benefits{display:flex;}
        .py-benefit{flex:1;}
        .py-benefit + .py-benefit{border-left:1px solid ${HAIRLINE}; padding-left:26px; margin-left:26px;}
        .py-spotlight{display:flex; gap:60px;}
        .py-ticker-item{display:none;}
        @media (min-width:720px){ .py-ticker-item{display:flex;} }
        @media (max-width:900px){
          .py-hero{flex-direction:column;}
          .py-benefits{flex-direction:column; gap:28px;}
          .py-benefit + .py-benefit{border-left:none; padding-left:0; margin-left:0; border-top:1px solid ${HAIRLINE}; padding-top:22px;}
          .py-spotlight{flex-direction:column; gap:32px;}
          .py-navlinks{display:none !important;}
        }
      `}</style>

      {/* Ticker strip — each label jumps to the section that actually covers it */}
      <div style={{ display:"flex", alignItems:"center", gap:0, padding:"9px 24px", borderBottom:`1px solid ${HAIRLINE}`, background:PANEL, overflowX:"auto", whiteSpace:"nowrap" }}>
        {["BUDGETS","GOALS","INVESTMENTS","LOANS","INSURANCE"].map((label,i) => (
          <span key={label} className="py-ticker-item py-navlink" onClick={()=>scrollTo("features")}
            style={{ fontSize:9.5, letterSpacing:"0.12em", color:MUTED,
            padding: i===0 ? "0 20px 0 0" : "0 20px", borderRight:`1px solid ${HAIRLINE}` }}>{label}</span>
        ))}
        <span className="py-navlink" onClick={()=>scrollTo("household")} style={{ fontSize:9.5, letterSpacing:"0.12em", color:TEAL, padding:"0 20px" }}>HOUSEHOLD SHARING</span>
        <div style={{ flex:1 }} />
        <span style={{ fontSize:9.5, letterSpacing:"0.1em", color:FAINT }}>PESAYANGU.AFRICA</span>
      </div>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"22px 24px",
        position:"sticky", top:0, zIndex:10, background: scrolled ? "rgba(10,10,11,0.92)" : "transparent",
        backdropFilter: scrolled ? "blur(8px)" : "none", borderBottom: scrolled ? `1px solid ${HAIRLINE}` : "1px solid transparent",
        transition:"all .2s" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ width:30, height:30, background:`linear-gradient(135deg,${TEAL},${GOLD})`, borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, fontWeight:800, color:INK }}>◈</div>
          <div style={{ fontWeight:800, fontSize:17, letterSpacing:"-0.02em" }}>Pesa Yangu</div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:28 }}>
          <div className="py-navlinks" style={{ display:"flex", alignItems:"center", gap:28 }}>
            <span className="py-navlink" onClick={()=>scrollTo("features")} style={{ fontSize:12.5, fontWeight:600, color:MUTED }}>Features</span>
            <span className="py-navlink" onClick={()=>scrollTo("household")} style={{ fontSize:12.5, fontWeight:600, color:MUTED }}>Household</span>
            <span className="py-navlink" onClick={onSignIn} style={{ fontSize:12.5, fontWeight:600, color:MUTED }}>Sign In</span>
          </div>
          <CTAButton onClick={onGetStarted} small>Create Free Account <IconArrow/></CTAButton>
        </div>
      </div>

      {/* Hero */}
      <div className="py-hero" style={{ padding:"50px 24px 60px", borderBottom:`1px solid ${HAIRLINE}`, maxWidth:1216, margin:"0 auto" }}>
        <div style={{ flex:1.1 }}>
          <div style={{ fontSize:12.5, fontWeight:700, letterSpacing:"0.06em", color:TEAL, marginBottom:20 }}>PERSONAL FINANCE · KENYA</div>
          <div style={{ fontFamily:serif, fontWeight:400, fontSize:"clamp(30px,5vw,48px)", lineHeight:1.12, color:GOLD, textWrap:"balance" }}>
            Your household's money, in one private ledger.
          </div>
          <div style={{ fontSize:14, color:MUTED, lineHeight:1.7, marginTop:22, maxWidth:"46ch" }}>
            Budgets, loans, investments, insurance and goals — plus a shared ledger two partners can both hold the pen on, without sharing a password.
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:18, marginTop:32, flexWrap:"wrap" }}>
            <CTAButton onClick={onGetStarted}>Create Free Account <IconArrow/></CTAButton>
            <span style={{ fontSize:12, color:FAINT }}>Free to use · No card required</span>
          </div>
        </div>

        {/* Hero sample panel */}
        <div style={{ flex:1, border:`1px solid ${HAIRLINE}`, borderRadius:14, background:PANEL, minWidth:280, overflow:"hidden" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 18px", borderBottom:`1px solid ${HAIRLINE}` }}>
            <span style={{ fontSize:10, letterSpacing:"0.06em", color:MUTED }}>SAMPLE ACCOUNT — ILLUSTRATIVE</span>
            <TriUp/>
          </div>
          <div style={{ padding:"22px 18px 18px" }}>
            <div style={{ fontFamily:serif, fontWeight:400, fontSize:34, fontVariantNumeric:"tabular-nums" }}>KSh 482,300</div>
            <svg width="100%" height="34" viewBox="0 0 280 34" style={{ marginTop:12, display:"block" }}>
              <polyline points="0,28 45,25 90,26 135,17 180,14 225,7 280,4" fill="none" stroke={TEAL} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div style={{ display:"flex", borderTop:`1px solid ${HAIRLINE}` }}>
            {[["SCORE","82 / 100",TEAL],["SAVINGS","34%",TEXT],["LINKED","YES",TEAL]].map(([label,val,color],i)=>(
              <div key={label} style={{ flex:1, padding:"13px 18px", borderRight: i<2 ? `1px solid ${HAIRLINE}` : "none" }}>
                <div style={{ fontSize:9, letterSpacing:"0.06em", color:MUTED, marginBottom:5 }}>{label}</div>
                <div style={{ fontSize:13, fontWeight:700, color }}>{val}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Benefits */}
      <div id="features" className="py-benefits" style={{ padding:"50px 24px", borderBottom:`1px solid ${HAIRLINE}`, maxWidth:1216, margin:"0 auto" }}>
        <div className="py-benefit">
          <IconTarget/>
          <div style={{ fontSize:12.5, color:TEXT, fontWeight:700, marginTop:16, marginBottom:8 }}>Budgets that match how you plan</div>
          <div style={{ fontSize:12.5, color:MUTED, lineHeight:1.65 }}>Set a flat cap per category, or define percentage rules once and let the caps recalculate from your income every month.</div>
        </div>
        <div className="py-benefit">
          <IconLoan/>
          <div style={{ fontSize:12.5, color:TEXT, fontWeight:700, marginTop:16, marginBottom:8 }}>Loans &amp; insurance, tracked properly</div>
          <div style={{ fontSize:12.5, color:MUTED, lineHeight:1.65 }}>Compound interest accrual, full repayment history, and premium due dates — the details a bank tracks, kept in your own ledger.</div>
        </div>
        <div className="py-benefit">
          <IconCheck/>
          <div style={{ fontSize:12.5, color:TEXT, fontWeight:700, marginTop:16, marginBottom:8 }}>Reconcile against the real statement</div>
          <div style={{ fontSize:12.5, color:MUTED, lineHeight:1.65 }}>Import your bank or M-Pesa statement and match it, line by line, against what you actually recorded.</div>
        </div>
        <div className="py-benefit">
          <IconLink/>
          <div style={{ fontSize:12.5, color:TEXT, fontWeight:700, marginTop:16, marginBottom:8 }}>One ledger, two signatures</div>
          <div style={{ fontSize:12.5, color:MUTED, lineHeight:1.65 }}>Link with a partner and share every wallet, transaction and goal — while keeping separate logins.</div>
        </div>
      </div>

      {/* Household spotlight */}
      <div id="household" className="py-spotlight" style={{ padding:"56px 24px", borderBottom:`1px solid ${HAIRLINE}`, maxWidth:1216, margin:"0 auto" }}>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:12, fontWeight:700, letterSpacing:"0.08em", color:GOLD, marginBottom:16 }}>FEATURED</div>
          <div style={{ fontFamily:serif, fontWeight:400, fontSize:32, lineHeight:1.2, marginBottom:18 }}>Household Accounts</div>
          <div style={{ fontSize:13.5, color:MUTED, lineHeight:1.75, maxWidth:"44ch", marginBottom:20 }}>
            Two people, two logins, one shared financial life. Generate a code, your partner enters it once, and from that moment every wallet, loan, goal and shift in net worth is visible to both — instantly, not on a delay.
          </div>
          <div className="py-navlink" onClick={onGetStarted} style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontSize:12.5, fontWeight:700, color:TEAL }}>See how it works</span>
            <IconArrowTeal/>
          </div>
        </div>
        <div style={{ flex:0.9, border:`1px solid ${HAIRLINE}`, borderRadius:14, background:PANEL, padding:26, display:"flex", flexDirection:"column", alignItems:"center", minWidth:260 }}>
          <div style={{ fontSize:10, letterSpacing:"0.06em", color:MUTED, marginBottom:16 }}>YOUR INVITE CODE</div>
          <div style={{ fontFamily:serif, fontWeight:400, fontSize:26, letterSpacing:"0.06em", color:TEAL, marginBottom:8 }}>7XK4&#8209;9PLM</div>
          <div style={{ fontSize:10.5, color:FAINT, marginBottom:20 }}>Expires in 7 days</div>
          <div style={{ display:"flex", alignItems:"center", gap:10, paddingTop:18, borderTop:`1px solid ${HAIRLINE}`, width:"100%", justifyContent:"center" }}>
            <div style={{ width:28, height:28, borderRadius:"50%", background:TEAL+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color:TEAL }}>A</div>
            <div style={{ width:18, height:1, background:TEAL }} />
            <div style={{ width:28, height:28, borderRadius:"50%", border:`1px dashed ${FAINT}` }} />
          </div>
        </div>
      </div>

      {/* Secondary CTA */}
      <div style={{ textAlign:"center", padding:"70px 24px", borderBottom:`1px solid ${HAIRLINE}` }}>
        <div style={{ fontFamily:serif, fontWeight:400, fontSize:28, marginBottom:22 }}>Open your ledger.</div>
        <CTAButton onClick={onGetStarted}>Create Free Account <IconArrow/></CTAButton>
      </div>

      {/* Footer */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"26px 24px", flexWrap:"wrap", gap:10 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:18, height:18, background:`linear-gradient(135deg,${TEAL},${GOLD})`, borderRadius:5, display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:800, color:INK }}>◈</div>
          <span style={{ fontSize:11, color:FAINT }}>Pesa Yangu · Private Ledger</span>
        </div>
        <span style={{ fontSize:11, color:FAINT }}>Free to use · No card required · Built for Kenya</span>
      </div>
    </div>
  );
}
