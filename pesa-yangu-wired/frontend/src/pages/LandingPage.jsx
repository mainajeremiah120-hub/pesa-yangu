/**
 * frontend/src/pages/LandingPage.jsx
 * Marketing entry point shown to signed-out visitors before AuthPage.
 * Visual direction: "Bloomberg-meets-luxury-banking" — gold hairlines on
 * near-black, Playfair Display serif for headline figures, IBM Plex Mono
 * for data and labels, sharp zero-radius panels.
 */
import { useState, useEffect } from "react";

const GOLD    = "#C9A227";
const GOLD_HL = "#E0BC4E";
const INK     = "#0A0A0C";
const PANEL   = "#0F0F12";
const TEXT    = "#EDEAE2";
const MUTED   = "#8A8578";
const FAINT   = "#5C584D";
const GOOD    = "#5C8A6E";
const BAD     = "#A85A5A";
const HAIRLINE = "rgba(201,162,39,0.2)";

const serif = "'Playfair Display', Georgia, serif";
const mono  = "'IBM Plex Mono', 'SF Mono', Consolas, monospace";

const IconLink = (props) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M9 15l6-6"/><path d="M11 5.5l1-1a3.5 3.5 0 015 5l-1 1"/><path d="M13 18.5l-1 1a3.5 3.5 0 01-5-5l1-1"/>
  </svg>
);
const IconTarget = (props) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.6" {...props}>
    <circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>
  </svg>
);
const IconLoan = (props) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M5 4h11l3 3v13H5z"/><path d="M9 10h6M9 14h6"/>
  </svg>
);
const IconCheck = (props) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.5l2.3 2.3L16 9.5"/>
  </svg>
);
const IconArrow = (props) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M9 6l6 6-6 6"/>
  </svg>
);
const IconArrowGold = (props) => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M9 6l6 6-6 6"/>
  </svg>
);
const TriUp = () => <svg width="8" height="8" viewBox="0 0 10 10"><path d="M5 1l4 7H1z" fill={GOOD}/></svg>;

const CTAButton = ({ children, onClick, small }) => (
  <button onClick={onClick} className="py-cta"
    style={{ fontFamily:mono, fontSize:small?10.5:11, letterSpacing:"0.1em", color:INK, background:GOLD,
      border:"none", padding:small?"11px 20px":"14px 28px", display:"inline-flex", alignItems:"center", gap:9,
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
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;}
        .py-cta{transition:opacity .15s;}
        .py-cta:hover{opacity:.85;}
        .py-navlink{cursor:pointer; transition:color .15s;}
        .py-navlink:hover{color:${TEXT};}
        .py-hero{display:flex; gap:50px;}
        .py-benefits{display:flex;}
        .py-benefit{flex:1;}
        .py-benefit + .py-benefit{border-left:1px solid rgba(201,162,39,0.14); padding-left:26px; margin-left:26px;}
        .py-spotlight{display:flex; gap:60px;}
        .py-ticker-item{display:none;}
        @media (min-width:720px){ .py-ticker-item{display:flex;} }
        @media (max-width:900px){
          .py-hero{flex-direction:column;}
          .py-benefits{flex-direction:column; gap:28px;}
          .py-benefit + .py-benefit{border-left:none; padding-left:0; margin-left:0; border-top:1px solid rgba(201,162,39,0.14); padding-top:22px;}
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
        <span className="py-navlink" onClick={()=>scrollTo("household")} style={{ fontSize:9.5, letterSpacing:"0.12em", color:GOLD, padding:"0 20px" }}>HOUSEHOLD SHARING</span>
        <div style={{ flex:1 }} />
        <span style={{ fontSize:9.5, letterSpacing:"0.1em", color:FAINT }}>PESAYANGU.AFRICA</span>
      </div>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"22px 24px",
        position:"sticky", top:0, zIndex:10, background: scrolled ? "rgba(10,10,12,0.92)" : "transparent",
        backdropFilter: scrolled ? "blur(8px)" : "none", borderBottom: scrolled ? `1px solid ${HAIRLINE}` : "1px solid transparent",
        transition:"all .2s" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ width:13, height:13, border:`1.5px solid ${GOLD}`, transform:"rotate(45deg)" }} />
          <div style={{ fontFamily:serif, fontWeight:700, fontSize:19 }}>Pesa Yangu</div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:28 }}>
          <div className="py-navlinks" style={{ display:"flex", alignItems:"center", gap:28 }}>
            <span className="py-navlink" onClick={()=>scrollTo("features")} style={{ fontSize:10.5, letterSpacing:"0.08em", color:MUTED }}>FEATURES</span>
            <span className="py-navlink" onClick={()=>scrollTo("household")} style={{ fontSize:10.5, letterSpacing:"0.08em", color:MUTED }}>HOUSEHOLD</span>
            <span className="py-navlink" onClick={onSignIn} style={{ fontSize:10.5, letterSpacing:"0.08em", color:MUTED }}>SIGN IN</span>
          </div>
          <CTAButton onClick={onGetStarted} small>CREATE FREE ACCOUNT <IconArrow/></CTAButton>
        </div>
      </div>

      {/* Hero */}
      <div className="py-hero" style={{ padding:"50px 24px 60px", borderBottom:`1px solid ${HAIRLINE}`, maxWidth:1216, margin:"0 auto" }}>
        <div style={{ flex:1.1 }}>
          <div style={{ fontSize:10, letterSpacing:"0.16em", color:GOLD, marginBottom:20 }}>PERSONAL FINANCE · KENYA</div>
          <div style={{ fontFamily:serif, fontWeight:700, fontSize:"clamp(30px,5vw,48px)", lineHeight:1.12, color:TEXT, textWrap:"balance" }}>
            Your household's money, in one private ledger.
          </div>
          <div style={{ fontSize:13, color:MUTED, lineHeight:1.7, marginTop:22, maxWidth:"46ch" }}>
            Budgets, loans, investments, insurance and goals — plus a shared ledger two partners can both hold the pen on, without sharing a password.
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:18, marginTop:32, flexWrap:"wrap" }}>
            <CTAButton onClick={onGetStarted}>CREATE FREE ACCOUNT <IconArrow/></CTAButton>
            <span style={{ fontSize:10.5, color:FAINT, letterSpacing:"0.04em" }}>Free to use · No card required</span>
          </div>
        </div>

        {/* Hero sample panel */}
        <div style={{ flex:1, border:`1px solid rgba(201,162,39,0.28)`, background:PANEL, minWidth:280 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 18px", borderBottom:`1px solid ${HAIRLINE}` }}>
            <span style={{ fontSize:9, letterSpacing:"0.1em", color:MUTED }}>SAMPLE ACCOUNT — ILLUSTRATIVE</span>
            <TriUp/>
          </div>
          <div style={{ padding:"22px 18px 18px" }}>
            <div style={{ fontFamily:serif, fontWeight:700, fontSize:34, fontVariantNumeric:"tabular-nums" }}>KSh 482,300</div>
            <svg width="100%" height="34" viewBox="0 0 280 34" style={{ marginTop:12, display:"block" }}>
              <polyline points="0,28 45,25 90,26 135,17 180,14 225,7 280,4" fill="none" stroke={GOLD} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div style={{ display:"flex", borderTop:`1px solid ${HAIRLINE}` }}>
            {[["SCORE","82 / 100",GOLD],["SAVINGS","34%",TEXT],["LINKED","YES",GOLD]].map(([label,val,color],i)=>(
              <div key={label} style={{ flex:1, padding:"13px 18px", borderRight: i<2 ? `1px solid rgba(201,162,39,0.14)` : "none" }}>
                <div style={{ fontSize:8.5, letterSpacing:"0.08em", color:MUTED, marginBottom:5 }}>{label}</div>
                <div style={{ fontSize:13, fontWeight:600, color }}>{val}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Benefits */}
      <div id="features" className="py-benefits" style={{ padding:"50px 24px", borderBottom:`1px solid ${HAIRLINE}`, maxWidth:1216, margin:"0 auto" }}>
        <div className="py-benefit">
          <IconTarget/>
          <div style={{ fontSize:11, letterSpacing:"0.06em", color:TEXT, fontWeight:600, marginTop:16, marginBottom:8 }}>BUDGETS THAT MATCH HOW YOU PLAN</div>
          <div style={{ fontSize:11.5, color:MUTED, lineHeight:1.65 }}>Set a flat cap per category, or define percentage rules once and let the caps recalculate from your income every month.</div>
        </div>
        <div className="py-benefit">
          <IconLoan/>
          <div style={{ fontSize:11, letterSpacing:"0.06em", color:TEXT, fontWeight:600, marginTop:16, marginBottom:8 }}>LOANS &amp; INSURANCE, TRACKED PROPERLY</div>
          <div style={{ fontSize:11.5, color:MUTED, lineHeight:1.65 }}>Compound interest accrual, full repayment history, and premium due dates — the details a bank tracks, kept in your own ledger.</div>
        </div>
        <div className="py-benefit">
          <IconCheck/>
          <div style={{ fontSize:11, letterSpacing:"0.06em", color:TEXT, fontWeight:600, marginTop:16, marginBottom:8 }}>RECONCILE AGAINST THE REAL STATEMENT</div>
          <div style={{ fontSize:11.5, color:MUTED, lineHeight:1.65 }}>Import your bank or M-Pesa statement and match it, line by line, against what you actually recorded.</div>
        </div>
        <div className="py-benefit">
          <IconLink/>
          <div style={{ fontSize:11, letterSpacing:"0.06em", color:TEXT, fontWeight:600, marginTop:16, marginBottom:8 }}>ONE LEDGER, TWO SIGNATURES</div>
          <div style={{ fontSize:11.5, color:MUTED, lineHeight:1.65 }}>Link with a partner and share every wallet, transaction and goal — while keeping separate logins.</div>
        </div>
      </div>

      {/* Household spotlight */}
      <div id="household" className="py-spotlight" style={{ padding:"56px 24px", borderBottom:`1px solid ${HAIRLINE}`, maxWidth:1216, margin:"0 auto" }}>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:10, letterSpacing:"0.16em", color:GOLD, marginBottom:16 }}>FEATURED</div>
          <div style={{ fontFamily:serif, fontWeight:700, fontSize:32, lineHeight:1.2, marginBottom:18 }}>Household Accounts</div>
          <div style={{ fontSize:12.5, color:MUTED, lineHeight:1.75, maxWidth:"44ch", marginBottom:20 }}>
            Two people, two logins, one shared financial life. Generate a code, your partner enters it once, and from that moment every wallet, loan, goal and shift in net worth is visible to both — instantly, not on a delay.
          </div>
          <div className="py-navlink" onClick={onGetStarted} style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontSize:10.5, color:GOLD, letterSpacing:"0.06em" }}>SEE HOW IT WORKS</span>
            <IconArrowGold/>
          </div>
        </div>
        <div style={{ flex:0.9, border:`1px solid rgba(201,162,39,0.28)`, background:PANEL, padding:26, display:"flex", flexDirection:"column", alignItems:"center", minWidth:260 }}>
          <div style={{ fontSize:9, letterSpacing:"0.12em", color:MUTED, marginBottom:16 }}>YOUR INVITE CODE</div>
          <div style={{ fontFamily:serif, fontWeight:700, fontSize:26, letterSpacing:"0.1em", color:GOLD, marginBottom:8 }}>7XK4&#8209;9PLM</div>
          <div style={{ fontSize:9.5, color:FAINT, marginBottom:20 }}>EXPIRES IN 7 DAYS</div>
          <div style={{ display:"flex", alignItems:"center", gap:10, paddingTop:18, borderTop:`1px solid rgba(201,162,39,0.16)`, width:"100%", justifyContent:"center" }}>
            <div style={{ width:26, height:26, borderRadius:"50%", background:"rgba(201,162,39,0.14)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color:GOLD }}>A</div>
            <div style={{ width:18, height:1, background:GOLD }} />
            <div style={{ width:26, height:26, borderRadius:"50%", border:`1px dashed ${FAINT}` }} />
          </div>
        </div>
      </div>

      {/* Secondary CTA */}
      <div style={{ textAlign:"center", padding:"70px 24px", borderBottom:`1px solid ${HAIRLINE}` }}>
        <div style={{ fontFamily:serif, fontWeight:700, fontSize:28, marginBottom:22 }}>Open your ledger.</div>
        <CTAButton onClick={onGetStarted}>CREATE FREE ACCOUNT <IconArrow/></CTAButton>
      </div>

      {/* Footer */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"26px 24px", flexWrap:"wrap", gap:10 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:9, height:9, border:`1.2px solid ${FAINT}`, transform:"rotate(45deg)" }} />
          <span style={{ fontSize:10, letterSpacing:"0.1em", color:FAINT }}>PESA YANGU · PRIVATE LEDGER</span>
        </div>
        <span style={{ fontSize:10, letterSpacing:"0.06em", color:FAINT }}>FREE TO USE · NO CARD REQUIRED · BUILT FOR KENYA</span>
      </div>
    </div>
  );
}
