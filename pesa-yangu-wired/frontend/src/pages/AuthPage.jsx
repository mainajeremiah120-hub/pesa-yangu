/**
 * frontend/src/pages/AuthPage.jsx
 * Login / Register / Forgot password / Reset password screen
 */
import { useState, useEffect } from "react";
import { tokens, getTheme } from "../theme.js";
import { authApi } from "../lib/api.js";

const EyeOpen = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);
const EyeClosed = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
    <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
);

function PasswordField({ value, onChange, placeholder, C }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position:"relative", marginBottom:12 }}>
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required
        style={{
          background:C.navyLight, border:`1px solid ${C.inputBorder}`,
          borderRadius:10, padding:"12px 44px 12px 16px",
          color:C.textPrimary, width:"100%", fontSize:14,
          outline:"none", boxSizing:"border-box",
        }}
        onFocus={e => e.target.style.borderColor = C.teal}
        onBlur={e  => e.target.style.borderColor = C.inputBorder}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        style={{
          position:"absolute", right:12, top:"50%", transform:"translateY(-50%)",
          background:"none", border:"none", cursor:"pointer",
          color:C.textMuted, display:"flex", alignItems:"center",
          padding:4, borderRadius:6, outline:"none",
        }}
        onMouseEnter={e => e.currentTarget.style.color = C.teal}
        onMouseLeave={e => e.currentTarget.style.color = C.textMuted}
      >
        {show ? <EyeClosed /> : <EyeOpen />}
      </button>
    </div>
  );
}

export default function AuthPage({ onLogin, onRegister }) {
  const [theme, setThemeState] = useState(getTheme);
  const C = tokens(theme);

  useEffect(() => {
    const handler = () => setThemeState(getTheme());
    window.addEventListener("py:theme", handler);
    return () => window.removeEventListener("py:theme", handler);
  }, []);

  // Detect ?reset=TOKEN in URL on mount
  const [resetToken, setResetToken] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("reset");
    if (t) {
      setResetToken(t);
      setMode("reset");
      // Clean URL without reloading
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const [mode,     setMode]     = useState("login"); // login | register | forgot | reset
  const [name,     setName]     = useState("");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [error,    setError]    = useState("");
  const [success,  setSuccess]  = useState("");
  const [loading,  setLoading]  = useState(false);

  const inp = {
    background:C.navyLight, border:`1px solid ${C.inputBorder}`,
    borderRadius:10, padding:"12px 16px", color:C.textPrimary,
    width:"100%", fontSize:14, outline:"none", boxSizing:"border-box",
    marginBottom:12,
  };

  const reset = (m) => { setMode(m); setError(""); setSuccess(""); setPassword(""); setConfirm(""); };

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setSuccess(""); setLoading(true);
    try {
      if (mode === "login") {
        await onLogin(email, password);

      } else if (mode === "register") {
        if (!name.trim()) { setError("Please enter your name."); return; }
        if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
        await onRegister(email, password, name);

      } else if (mode === "forgot") {
        await authApi.forgotPassword(email);
        setSuccess("If that email is registered you'll receive a reset link shortly. Check your inbox (and spam).");

      } else if (mode === "reset") {
        if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
        if (password !== confirm) { setError("Passwords do not match."); return; }
        await authApi.resetPassword(resetToken, password);
        setSuccess("Password updated! You can now sign in with your new password.");
        setTimeout(() => reset("login"), 2500);
      }
    } catch (err) {
      setError(err?.response?.data?.error || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const titles = {
    login:    { heading: "Welcome back",       sub: "Sign in to your account" },
    register: { heading: "Create your account", sub: "Free � No card required" },
    forgot:   { heading: "Forgot password?",   sub: "We'll email you a reset link" },
    reset:    { heading: "Set new password",   sub: "Choose a strong password" },
  };
  const { heading, sub } = titles[mode];

  return (
    <div style={{ minHeight:"100vh", background:C.navy, display:"flex", alignItems:"center",
      justifyContent:"center", padding:20, fontFamily:"'Inter',-apple-system,sans-serif",
      transition:"background 0.3s" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=DM+Serif+Display&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        input::placeholder { color: ${C.textFaint}; }
        select option { background: ${C.navyMid}; color: ${C.textPrimary}; }
      `}</style>

      <div style={{ width:"100%", maxWidth:400 }}>
        {/* Logo */}
        <div style={{ textAlign:"center", marginBottom:36 }}>
          <div style={{ width:56, height:56, background:`linear-gradient(135deg,${C.teal},${C.blue})`,
            borderRadius:16, display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:26, margin:"0 auto 14px" }}>◈</div>
          <div style={{ fontWeight:800, fontSize:22, letterSpacing:"-0.02em", color:C.textPrimary }}>Pesa Yangu</div>
          <div style={{ color:C.textMuted, fontSize:13, marginTop:4 }}>Smart personal finance for Kenya</div>
        </div>

        {/* Card */}
        <div style={{ background:C.navyMid, borderRadius:20, padding:28,
          border:`1px solid ${C.navyLight}`, boxShadow:`0 4px 24px ${C.shadow}`,
          transition:"background 0.3s, border-color 0.3s" }}>

          {/* Login / Register tabs (only on those modes) */}
          {(mode === "login" || mode === "register") && (
            <div style={{ display:"flex", background:C.navyLight, borderRadius:12, padding:4, marginBottom:24 }}>
              {["login","register"].map(m => (
                <button key={m} onClick={() => reset(m)}
                  style={{ flex:1, padding:"9px 0", borderRadius:9, border:"none", cursor:"pointer",
                    fontWeight:700, fontSize:13,
                    background: mode===m ? C.teal : "transparent",
                    color:      mode===m ? "#0B1120" : C.textMuted,
                    transition:"all 0.2s" }}>
                  {m === "login" ? "Sign In" : "Create Account"}
                </button>
              ))}
            </div>
          )}

          {/* Heading for forgot / reset modes */}
          {(mode === "forgot" || mode === "reset") && (
            <div style={{ marginBottom:20 }}>
              <div style={{ fontWeight:700, fontSize:17, color:C.textPrimary }}>{heading}</div>
              <div style={{ color:C.textMuted, fontSize:12, marginTop:3 }}>{sub}</div>
            </div>
          )}

          <form onSubmit={submit}>
            {mode === "register" && (
              <input value={name} onChange={e=>setName(e.target.value)}
                placeholder="Full name" style={inp}
                onFocus={e=>e.target.style.borderColor=C.teal}
                onBlur={e=>e.target.style.borderColor=C.inputBorder}/>
            )}

            {(mode === "login" || mode === "register" || mode === "forgot") && (
              <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
                placeholder="Email address" style={inp} required
                onFocus={e=>e.target.style.borderColor=C.teal}
                onBlur={e=>e.target.style.borderColor=C.inputBorder}/>
            )}

            {(mode === "login" || mode === "register") && (
              <PasswordField
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={mode === "register" ? "Password (min 8 characters)" : "Password"}
                C={C}
              />
            )}

            {mode === "reset" && (
              <>
                <PasswordField value={password} onChange={e=>setPassword(e.target.value)} placeholder="New password (min 8 characters)" C={C}/>
                <PasswordField value={confirm}  onChange={e=>setConfirm(e.target.value)}  placeholder="Confirm new password" C={C}/>
              </>
            )}

            {error && (
              <div style={{ color:C.coral, fontSize:12, marginBottom:14,
                padding:"8px 12px", background:C.coral+"14", borderRadius:8 }}>
                {error}
              </div>
            )}
            {success && (
              <div style={{ color:"#00D4AA", fontSize:12, marginBottom:14,
                padding:"8px 12px", background:"#00D4AA14", borderRadius:8 }}>
                {success}
              </div>
            )}

            {/* Don't show submit button after forgot success */}
            {!(mode === "forgot" && success) && (
              <button type="submit" disabled={loading}
                style={{ width:"100%", padding:14, background:C.teal, color:"#0B1120",
                  border:"none", borderRadius:12, fontWeight:800, fontSize:15,
                  cursor:loading?"not-allowed":"pointer", opacity:loading?0.7:1,
                  transition:"opacity 0.2s" }}>
                {loading ? "Please wait�"
                  : mode === "login"    ? "Sign In"
                  : mode === "register" ? "Create Account"
                  : mode === "forgot"   ? "Send Reset Link"
                  :                      "Set New Password"}
              </button>
            )}
          </form>

          {/* Footer links */}
          <div style={{ textAlign:"center", marginTop:16, fontSize:12 }}>
            {mode === "login" && (
              <>
                <span
                  onClick={() => reset("forgot")}
                  style={{ color:C.teal, cursor:"pointer", fontWeight:600 }}>
                  Forgot password?
                </span>
                <span style={{ color:C.textFaint }}> � No account? </span>
                <span onClick={() => reset("register")}
                  style={{ color:C.teal, cursor:"pointer", fontWeight:600 }}>
                  Create one free
                </span>
              </>
            )}
            {(mode === "forgot" || mode === "reset") && (
              <span onClick={() => reset("login")}
                style={{ color:C.textMuted, cursor:"pointer" }}>
                ← Back to Sign In
              </span>
            )}
          </div>
        </div>

        <div style={{ textAlign:"center", marginTop:20, color:C.textFaint, fontSize:11 }}>
          Free to use � No card required � Built for Kenya
        </div>
      </div>
    </div>
  );
}
