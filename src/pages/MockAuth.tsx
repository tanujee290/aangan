// Screens that stand in for the parts of Supabase Auth that live outside the app: the email
// inbox that receives magic links, and Google's consent screen. Both exist only on the mock
// backend. /auth/confirm is shared: it finishes a magic link on the mock and on a real project.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Inbox, Mail, RefreshCw } from "lucide-react";
import { supabase, demoMode, errorMessage, onMockChange } from "../lib/supabase";
import { completeMockOAuth, mockAccounts, mockMail } from "../lib/mock/client";
import { relativeTime } from "../lib/export";
import { Empty, Field, Logo } from "../components/ui";

/** Only same-origin paths may be used as a post-sign-in destination. */
function localPath(p: string | null, fallback = "/app") {
  if (!p || !p.startsWith("/") || p.startsWith("//")) return fallback;
  return p;
}

function initials(s: string) {
  return s.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}

/* ------------------------------------------------------------- mock inbox */

export function MockInboxPage() {
  const [params] = useSearchParams();
  const to = params.get("to")?.toLowerCase() ?? "";
  const [mail, setMail] = useState(() => (demoMode ? mockMail() : []));
  const [, tick] = useState(0);

  useEffect(() => {
    if (!demoMode) return;
    const reload = () => setMail(mockMail());
    const off = onMockChange(reload);
    // Refresh relative times and expiry once a minute.
    const t = setInterval(() => { reload(); tick((n) => n + 1); }, 30_000);
    return () => { off(); clearInterval(t); };
  }, []);

  if (!demoMode) return <Navigate to="/login" replace />;
  const shown = to ? mail.filter((m) => m.to === to) : mail;

  return (
    <div role="main" className="auth">
      <a className="skip-link" href="#main">Skip to content</a>
      <div className="auth-card card mock-inbox" id="main">
        <Link to="/" className="brand"><Logo /><span>Aangan</span></Link>
        <div>
          <span className="eyebrow">Mock backend</span>
          <h1 className="display">Inbox</h1>
          <p className="muted small">
            Emails sent by the mock auth service land here instead of a real mailbox. They're kept in this browser.
            {to && <> Showing mail for <strong>{to}</strong>. <Link to="/mock/inbox">Show all</Link></>}
          </p>
        </div>
        {shown.length === 0 ? (
          <Empty icon={<Inbox size={22} />} title="No emails yet">
            Ask for a sign-in link on the <Link to="/login">sign-in page</Link> and it appears here.
          </Empty>
        ) : (
          <ul className="list mail-list" aria-label="Emails">
            {shown.map((m) => {
              const expired = Date.parse(m.expires_at) < Date.now();
              const state = m.used_at ? "Used" : expired ? "Expired" : null;
              const path = new URL(m.link).pathname + new URL(m.link).search;
              return (
                <li key={m.id} className="mail">
                  <div className="mail-head">
                    <Mail size={16} aria-hidden />
                    <strong className="grow">{m.subject}</strong>
                    <time className="tiny muted" dateTime={m.sent_at}>{relativeTime(m.sent_at)}</time>
                  </div>
                  <p className="tiny muted">To {m.to} · from Aangan &lt;noreply@angan.app&gt;</p>
                  <p className="small">{m.body}</p>
                  {state ? (
                    <p className="tiny muted">{state} — request a new link if you need one.</p>
                  ) : (
                    <Link className="btn primary" to={path}>Sign in to Aangan</Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="auth-switch small">
          <Link to="/login">Back to sign in</Link>
          <button className="link" onClick={() => setMail(mockMail())}><RefreshCw size={13} style={{ verticalAlign: "-2px" }} /> Refresh</button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- mock Google OAuth */

export function MockOAuthPage() {
  const [params] = useSearchParams();
  const redirect = localPath(params.get("redirect_to"));
  const [accounts] = useState(() => (demoMode ? mockAccounts() : []));
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!demoMode) return <Navigate to="/login" replace />;

  function choose(addr: string, display: string | null) {
    setBusy(true);
    setError(null);
    try {
      completeMockOAuth("google", addr, display);
      // A full page load, like coming back from the provider.
      window.location.assign(redirect);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    choose(email, name || null);
  }

  return (
    <div role="main" className="auth">
      <a className="skip-link" href="#main">Skip to content</a>
      <div className="auth-card card" id="main">
        <div className="brand"><Logo /><span>Aangan</span></div>
        <div>
          <span className="eyebrow">Mock Google sign-in</span>
          <h1 className="display">Choose an account</h1>
          <p className="muted small">
            This stands in for Google's consent screen on the mock backend. Pick an account to continue to Aangan.
            A new address creates an account; an existing one is linked to Google.
          </p>
        </div>
        {accounts.length > 0 && (
          <ul className="list" aria-label="Accounts">
            {accounts.map((a) => (
              <li key={a.email}>
                <button className="list-row as-button" disabled={busy} onClick={() => choose(a.email, a.name)}>
                  <span className="avatar" aria-hidden>{initials(a.name ?? a.email)}</span>
                  <span className="grow">
                    <strong>{a.name ?? a.email}</strong>
                    <small className="muted">{a.name ? a.email : a.google ? "Linked to Google" : "Will be linked to Google"}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="divider"><span>use another account</span></div>
        <form className="form" onSubmit={submit}>
          <Field label="Email"><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <Field label="Name (optional)"><input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn primary block" disabled={busy}>{busy ? "Signing in…" : "Continue"}</button>
        </form>
        <div className="auth-switch small">
          <Link to="/login?error=access_denied">Cancel</Link>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------- finish a magic link */

export function AuthConfirmPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token_hash = params.get("token_hash");
    const type = (params.get("type") ?? "email") as "email" | "magiclink";
    const next = localPath(params.get("next"));
    if (!token_hash) {
      setError("This sign-in link is incomplete. Request a new one.");
      return;
    }
    supabase.auth.verifyOtp({ token_hash, type }).then(({ error }) => {
      if (error) setError(errorMessage(error));
      else navigate(next, { replace: true });
    });
  }, [params, navigate]);

  return (
    <div role="main" className="auth">
      <a className="skip-link" href="#main">Skip to content</a>
      <div className="auth-card card" id="main">
        <Link to="/" className="brand"><Logo /><span>Aangan</span></Link>
        {error ? (
          <>
            <h1 className="display">Link didn't work</h1>
            <p className="form-error" role="alert">{error}</p>
            <Link className="btn primary block" to="/login">Back to sign in</Link>
          </>
        ) : (
          <>
            <h1 className="display">Signing you in…</h1>
            <p className="muted small" role="status">Checking your sign-in link.</p>
          </>
        )}
      </div>
    </div>
  );
}
