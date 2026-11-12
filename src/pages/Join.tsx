import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ShieldAlert, UsersRound } from "lucide-react";
import { supabase, errorMessage } from "../lib/supabase";
import { useAuth } from "../state/auth";
import { useData } from "../state/data";
import { Logo } from "../components/ui";

interface InviteInfo { workspace: string; role: "manager" | "viewer"; email: string | null; valid: boolean }
const PENDING_KEY = "angan.pendingInvite";

const ROLE_BLURB = {
  manager: "You'll be able to record payments, issue receipts and manage properties, tenants and tasks.",
  viewer: "You'll be able to see everything in the workspace, without changing anything.",
};

export default function JoinPage() {
  const { token = "" } = useParams();
  const { session, loading } = useAuth();
  const { refresh } = useData();
  const navigate = useNavigate();
  const [info, setInfo] = useState<InviteInfo | null | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(PENDING_KEY, token);
    supabase.rpc("invite_info", { p_token: token }).then(({ data, error }) => setInfo(error || !data ? null : (data as InviteInfo)));
  }, [token]);

  async function accept() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("accept_invite", { p_token: token });
    if (error) {
      setError(errorMessage(error));
      setBusy(false);
      return;
    }
    localStorage.removeItem(PENDING_KEY);
    await refresh();
    navigate("/app", { replace: true });
  }

  const signedIn = Boolean(session);

  return (
    <div role="main" className="auth">
      <a className="skip-link" href="#main">Skip to content</a>
      <div className="auth-card card" id="main">
        <Link to="/" className="brand"><Logo /><span>Aangan</span></Link>
        {info === "loading" || loading ? <p className="muted">Checking your invite…</p> : !info || !info.valid ? (
          <>
            <div className="join-icon bad"><ShieldAlert size={26} /></div>
            <h1 className="display">This invite has expired</h1>
            <p className="muted">The link is invalid, was already used, or was revoked. Ask the workspace owner for a fresh one.</p>
            <Link to="/" className="btn block">Back to Aangan</Link>
          </>
        ) : (
          <>
            <div className="join-icon"><UsersRound size={26} /></div>
            <span className="eyebrow">You're invited</span>
            <h1 className="display">Join {info.workspace}</h1>
            <div className="join-role">
              <span className="pill pill-neutral" style={{ textTransform: "capitalize" }}>{info.role}</span>
              <p className="small muted">{ROLE_BLURB[info.role]}</p>
            </div>
            {info.email && <p className="small muted">This invite is for <strong>{info.email}</strong>.</p>}
            {signedIn ? (
              <>
                {session && <p className="small muted">Signed in as <strong>{session.user.email}</strong>.</p>}
                {error && <p className="form-error" role="alert">{error}</p>}
                <button className="btn primary block" onClick={accept} disabled={busy}>{busy ? "Joining…" : `Join ${info.workspace}`}</button>
                {session && <button className="link small" onClick={() => supabase.auth.signOut()}>Use a different account</button>}
              </>
            ) : (
              <>
                <p className="small">Sign in or create an account{info.email ? ` with ${info.email}` : ""} to accept. Then come back to this link.</p>
                <div className="row gap">
                  <Link to={`/login?next=/join/${token}`} className="btn grow">Sign in</Link>
                  <Link to={`/login?signup=1&next=/join/${token}`} className="btn primary grow">Create account</Link>
                </div>
                <button className="link small" onClick={() => window.location.reload()}>I've signed in — accept</button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
