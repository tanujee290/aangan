import { useState, type FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { supabase, errorMessage, demoMode, MOCK_ACCOUNTS, signInSample } from "../lib/supabase";
import { useAuth } from "../state/auth";
import { useData } from "../state/data";
import { Field, Logo } from "../components/ui";
import { Inbox } from "lucide-react";
import { CURRENCIES } from "./Settings";

export function LoginPage() {
  const { session } = useAuth();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<"signin" | "signup" | "link">(params.get("signup") ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    params.get("error") === "access_denied" ? "Google sign-in was cancelled." : params.get("error_description"),
  );
  const [info, setInfo] = useState<string | null>(null);
  /** On the mock backend: the address a sign-in link was just "sent" to. */
  const [sentTo, setSentTo] = useState<string | null>(null);
  if (session) return <Navigate to="/app" replace />;
  const redirect = `${window.location.origin}/app`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    setSentTo(null);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirect } });
        if (error) throw error;
        if (!data.session) setInfo("Check your inbox to confirm your email, then sign in.");
      } else {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
        if (error) throw error;
        if (demoMode) {
          setSentTo(email.trim().toLowerCase());
          setInfo("Sign-in link sent. On the mock backend, emails go to the mock inbox.");
        } else setInfo("We've emailed you a sign-in link.");
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function sampleAccount(as: "owner" | "manager") {
    setBusy(true);
    setError(null);
    const { error } = await signInSample(as);
    if (error) setError(errorMessage(error));
    setBusy(false);
  }

  async function google() {
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirect } });
    if (error) setError(errorMessage(error));
  }

  return (
    <div role="main" className="auth">
      <a className="skip-link" href="#main">Skip to content</a>
      <div className="auth-card card" id="main">
        <Link to="/" className="brand"><Logo /><span>Aangan</span></Link>
        <h1 className="display">{mode === "signup" ? "Create your account" : "Welcome back"}</h1>
        <form className="form" onSubmit={submit}>
          <Field label="Email"><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
          {mode !== "link" && (
            <Field label="Password" hint={mode === "signup" ? "At least 8 characters." : undefined}>
              <input type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={mode === "signup" ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
          {info && <p className="form-info" role="status">{info}</p>}
          {sentTo && <Link className="btn block" to={`/mock/inbox?to=${encodeURIComponent(sentTo)}`}><Inbox size={16} /> Open the mock inbox</Link>}
          <button className="btn primary block" disabled={busy}>
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Email me a link"}
          </button>
        </form>
        <div className="divider"><span>or</span></div>
        <button className="btn block" onClick={google}>
          <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
          Continue with Google
        </button>
        {demoMode && (
          <div className="mock-accounts">
            <p className="small muted">This deploy runs on Aangan's built-in mock backend, so accounts and data stay in this browser. Try a sample account:</p>
            <div className="row gap-sm wrap">
              <button className="btn grow" disabled={busy} onClick={() => sampleAccount("owner")}>Owner · Meera Rentals</button>
              <button className="btn grow" disabled={busy} onClick={() => sampleAccount("manager")}>Caretaker (manager)</button>
            </div>
            <p className="tiny muted">Or create a new account above to start an empty workspace. Sample password: <code>{MOCK_ACCOUNTS.password}</code></p>
          </div>
        )}
        <div className="auth-switch small">
          {mode !== "signin" && <button className="link" onClick={() => setMode("signin")}>Sign in with password</button>}
          {mode !== "signup" && <button className="link" onClick={() => setMode("signup")}>Create an account</button>}
          {mode !== "link" && <button className="link" onClick={() => setMode("link")}>Email me a sign-in link</button>}
        </div>
      </div>
    </div>
  );
}

export function OnboardingPage() {
  const { session } = useAuth();
  const d = useData();
  const [name, setName] = useState<string>(session?.user.user_metadata?.full_name ?? "");
  const [currency, setCurrency] = useState("INR");
  const [upi, setUpi] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const locale = CURRENCIES.find((c) => c.code === currency)?.locale ?? "en-IN";
    const { error } = await supabase.from("workspaces").insert({ name: name.trim(), currency, locale, upi_id: upi.trim() || null });
    if (error) {
      setError(errorMessage(error));
      setBusy(false);
      return;
    }
    await d.refresh();
  }

  return (
    <div role="main" className="auth">
      <a className="skip-link" href="#main">Skip to content</a>
      <div className="auth-card card" id="main">
        <div className="brand"><Logo /><span>Aangan</span></div>
        <h1 className="display">Set up your courtyard</h1>
        <p className="muted">A few details for your receipts. You can change these later in Settings.</p>
        <form className="form" onSubmit={submit}>
          <Field label="Your name or business name" hint="Shown on receipts and reminders.">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Meera Rentals" required autoFocus />
          </Field>
          <Field label="Currency">
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="UPI ID (optional)" hint="Tenants can scan it from their pass."><input value={upi} onChange={(e) => setUpi(e.target.value)} placeholder="name@bank" /></Field>
          {error && <p className="form-error">{error}</p>}
          <button className="btn primary block" disabled={busy}>{busy ? "Setting up…" : "Continue"}</button>
        </form>
        <button className="link small" onClick={() => supabase.auth.signOut()}>Not {session?.user.email}? Sign out</button>
      </div>
    </div>
  );
}
