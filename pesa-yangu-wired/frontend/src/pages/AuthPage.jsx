/**
 * frontend/src/pages/AuthPage.jsx
 * Login / Register screen shown when the user is not authenticated.
 */
import { useState } from "react";

const C = {
  navy:"#0B1120", navyMid:"#15202E", navyLight:"#1E2E42",
  teal:"#00D4AA", gold:"#F5C842", coral:"#FF6B6B", blue:"#4A90E2",
  textPrimary:"#F0F4FF", textMuted:"#8B9ABB", textFaint:"#3D5068",
};

const inp = {
  background: C.navyLight, border:`1px solid ${C.navyLight}`,
  borderRadius:10, padding:"12px 16px", color:C.textPrimary,
  width:"100%", fontSize:14, outline:"none", boxSizing:"border-box",
  marginBottom:12,
};

export default function AuthPage({ onLogin, onRegister }) {
  const [mode,     setMode]     = useState("login"); // "login" | "register"
  const [name,     setName]     = useState("");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      if (mode === "login") {
        await onLogin(email, password);
      } else {
        if (!name.trim()) { setError("Please enter your name."); setLoading(false); return; }
        if (password.length < 8) { setError("Password must be at least 8 characters."); setLoading(false); return; }
        await onRegister(email, password, name);
      }
    } catch (err) {
      setError(err?.response?.data?.error || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight:"100vh", background:C.navy, display:"flex", alignItems:"center", justifyContent:"center", padding:20, fontFamily:"'Inter',-apple-system,sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=DM+Serif+Display&display=swap');*{box-sizing:border-box;margin:0;padding:0;}`}</style>

      <div style={{ width:"100%", maxWidth:400 }}>

        {/* Logo */}
        <div style={{ textAlign:"center", marginBottom:36 }}>
          <div style={{ width:56, height:56, background:`linear-gradient(135deg,${C.teal},${C.blue})`, borderRadius:16, display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, margin:"0 auto 14px" }}>◈</div>
          <div style={{ fontWeight:800, fontSize:22, letterSpacing:"-0.02em", color:C.textPrimary }}>Pesa Yangu</div>
          <div style={{ color:C.textMuted, fontSize:13, marginTop:4 }}>Smart personal finance for Kenya</div>
        </div>

        {/* Card */}
        <div style={{ background:C.navyMid, borderRadius:20, padding:28, border:`1px solid ${C.navyLight}` }}>

          {/* Tab toggle */}
          <div style={{ display:"flex", background:C.navyLight, borderRadius:12, padding:4, marginBottom:24 }}>
            {["login","register"].map(m => (
              <button key={m} onClick={() => { setMode(m); setError(""); }}
                style={{ flex:1, padding:"9px 0", borderRadius:9, border:"none", cursor:"pointer", fontWeight:700, fontSize:13,
                  background: mode===m ? C.teal : "transparent",
                  color:      mode===m ? C.navy  : C.textMuted,
                  transition:"all 0.2s" }}>
                {m === "login" ? "Sign In" : "Create Account"}
              </button>
            ))}
          </div>

          <form onSubmit={submit}>
            {mode === "register" && (
              <input value={name} onChange={e=>setName(e.target.value)}
                placeholder="Full name" style={inp}
                onFocus={e=>e.target.style.borderColor=C.teal}
                onBlur={e=>e.target.style.borderColor=C.navyLight}/>
            )}
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
              placeholder="Email address" style={inp} required
              onFocus={e=>e.target.style.borderColor=C.teal}
              onBlur={e=>e.target.style.borderColor=C.navyLight}/>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
              placeholder={mode==="register" ? "Password (min 8 characters)" : "Password"}
              style={{...inp, marginBottom: error ? 8 : 20}} required
              onFocus={e=>e.target.style.borderColor=C.teal}
              onBlur={e=>e.target.style.borderColor=C.navyLight}/>

            {error && (
              <div style={{ color:C.coral, fontSize:12, marginBottom:14, padding:"8px 12px", background:C.coral+"14", borderRadius:8 }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              style={{ width:"100%", padding:14, background:C.teal, color:C.navy, border:"none", borderRadius:12, fontWeight:800, fontSize:15, cursor:loading?"not-allowed":"pointer", opacity:loading?0.7:1, transition:"opacity 0.2s" }}>
              {loading ? "Please wait…" : mode === "login" ? "Sign In" : "Create Account"}
            </button>
          </form>

          {mode === "login" && (
            <div style={{ textAlign:"center", marginTop:16, color:C.textFaint, fontSize:12 }}>
              No account?{" "}
              <span onClick={() => { setMode("register"); setError(""); }}
                style={{ color:C.teal, cursor:"pointer", fontWeight:600 }}>
                Create one free
              </span>
            </div>
          )}
        </div>

        <div style={{ textAlign:"center", marginTop:20, color:C.textFaint, fontSize:11 }}>
          Free to use · No card required · Built for Kenya
        </div>
      </div>
    </div>
  );
}
