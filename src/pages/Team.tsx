import { useState, type FormEvent } from "react";
import { Copy, Crown, LogOut, MessageCircle, Trash2, UserPlus, UsersRound } from "lucide-react";
import { useCanWrite, useData } from "../state/data";
import { useAuth } from "../state/auth";
import { useNotify } from "../state/notify";
import { supabase, errorMessage, must } from "../lib/supabase";
import { dateLabel, initials, tone, waLink } from "../lib/format";
import type { Invite } from "../lib/types";
import { Empty, Field, NeedsSchema, QR, Segmented, SheetIf } from "../components/ui";

type TeamRole = "manager" | "viewer";
const ROLE_TEXT: Record<"owner" | TeamRole, string> = {
  owner: "Everything, including team, billing settings and workspace details.",
  manager: "Records payments, edits properties, tenants, tasks and bills.",
  viewer: "Read-only. Sees everything, changes nothing.",
};

const PERMS: [string, boolean, boolean, boolean][] = [
  ["View dashboard, payments and reports", true, true, true],
  ["Record payments and issue receipts", true, true, false],
  ["Edit properties, tenants and leases", true, true, false],
  ["Tasks, expenses, bills and documents", true, true, false],
  ["Invite and remove team members", true, false, false],
  ["Workspace settings and receipt prefix", true, false, false],
];

export const inviteLink = (token: string) => `${window.location.origin}/join/${token}`;

export default function TeamPage() {
  const d = useData();
  const { session } = useAuth();
  const notify = useNotify();
  const canWrite = useCanWrite();
  const isOwner = d.role === "owner";
  const [inviting, setInviting] = useState(false);
  const [created, setCreated] = useState<Invite | null>(null);

  if (!d.v2) return <div className="page"><div className="page-head"><h1 className="display">Team</h1></div><NeedsSchema feature="Teams and roles" /></div>;

  async function mutate(p: PromiseLike<{ error: unknown }>, msg: string) {
    const { error } = await p;
    if (error) return notify(errorMessage(error));
    await d.refresh();
    notify(msg);
  }

  async function leave() {
    if (!session || !confirm(`Leave ${d.workspace?.name}? You'll lose access until you're invited again.`)) return;
    const { error } = await supabase.from("members").delete().eq("user_id", session.user.id).eq("workspace_id", d.workspace!.id);
    if (error) return notify(errorMessage(error));
    await supabase.auth.signOut();
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">{d.workspace?.name}</span>
          <h1 className="display">Team</h1>
        </div>
        {isOwner && <button className="btn primary small" onClick={() => setInviting(true)}><UserPlus size={15} /> Invite someone</button>}
      </div>
      <p className="page-sub">Bring in a manager or caretaker to record rent and handle repairs, or an accountant to look without touching.</p>

      <section className="two-col">
        <div className="card">
          <div className="card-head"><h2><UsersRound size={18} /> People</h2><span className="small muted">{d.members.length + 1} in workspace</span></div>
          <ul className="list">
            <li className="list-row">
              <div className="avatar"><Crown size={16} /></div>
              <div className="grow">
                <strong>{isOwner ? `${session?.user.email ?? "You"} (you)` : "Workspace owner"}</strong>
                <small className="muted">{ROLE_TEXT.owner}</small>
              </div>
              <span className="pill pill-neutral">Owner</span>
            </li>
            {d.members.map((m) => {
              const me = m.user_id === session?.user.id;
              return (
                <li key={m.user_id} className="list-row">
                  <div className="avatar" data-tone={tone(m.email ?? "?")}>{initials(m.email ?? "?")}</div>
                  <div className="grow">
                    <strong>{m.email ?? "Team member"}{me ? " (you)" : ""}</strong>
                    <small className="muted">Joined {dateLabel(m.created_at)}</small>
                  </div>
                  {isOwner ? (
                    <>
                      <Segmented<TeamRole> label="Role" value={m.role} onChange={(r) => r !== m.role && mutate(
                        supabase.from("members").update({ role: r }).eq("workspace_id", m.workspace_id).eq("user_id", m.user_id), `Now a ${r}`)}
                        options={[{ value: "manager", label: "Manager" }, { value: "viewer", label: "Viewer" }]} />
                      <button className="icon-btn" aria-label="Remove member" onClick={() => confirm(`Remove ${m.email ?? "this member"}?`) && mutate(
                        supabase.from("members").delete().eq("workspace_id", m.workspace_id).eq("user_id", m.user_id), "Member removed")}><Trash2 size={15} /></button>
                    </>
                  ) : <span className="pill pill-neutral" style={{ textTransform: "capitalize" }}>{m.role}</span>}
                </li>
              );
            })}
          </ul>
          {d.members.length === 0 && <p className="muted small" style={{ padding: "4px 8px" }}>Just you so far.</p>}
          {!isOwner && (
            <div className="row between wrap gap" style={{ marginTop: 14 }}>
              <span className="small muted">You're a <strong style={{ textTransform: "capitalize" }}>{d.role}</strong>. {ROLE_TEXT[d.role]}</span>
              <button className="btn danger small" onClick={leave}><LogOut size={14} /> Leave workspace</button>
            </div>
          )}
        </div>

        <div className="stack">
          {isOwner && (
            <div className="card">
              <div className="card-head"><h2>Pending invites</h2></div>
              {d.invites.length === 0 ? (
                <Empty title="No open invites"><p>Invite links work for 14 days and can be used once.</p></Empty>
              ) : (
                <ul className="list">
                  {d.invites.map((i) => (
                    <li key={i.id} className="list-row">
                      <div className="grow">
                        <strong>{i.email ?? "Anyone with the link"}</strong>
                        <small className="muted"><span style={{ textTransform: "capitalize" }}>{i.role}</span> · expires {dateLabel(i.expires_at, { day: "numeric", month: "short" })}</small>
                      </div>
                      <button className="icon-btn" aria-label="Copy link" onClick={() => copy(inviteLink(i.token), notify)}><Copy size={15} /></button>
                      <button className="icon-btn" aria-label="Revoke invite" onClick={() => confirm("Revoke this invite link?") && mutate(supabase.from("invites").delete().eq("id", i.id), "Invite revoked")}><Trash2 size={15} /></button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="card">
            <div className="card-head"><h2>Who can do what</h2></div>
            <div className="table-wrap">
              <table className="table perm-table">
                <thead><tr><th>Permission</th><th>Owner</th><th>Manager</th><th>Viewer</th></tr></thead>
                <tbody>
                  {PERMS.map(([label, ...cols]) => (
                    <tr key={label}><td>{label}</td>{cols.map((on, k) => <td key={k} className={`perm ${on ? "yes" : "no"}`}>{on ? "✓" : "—"}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!canWrite && <p className="small muted" style={{ marginTop: 10 }}>Your view is read-only.</p>}
          </div>
        </div>
      </section>

      <SheetIf open={inviting} title="Invite to your workspace" onClose={() => { setInviting(false); setCreated(null); }}>
        {created ? <InviteCreated invite={created} workspace={d.workspace?.name ?? "Aangan"} onDone={() => { setInviting(false); setCreated(null); }} />
          : <InviteForm onCreated={async (i) => { setCreated(i); await d.refresh(); }} />}
      </SheetIf>
    </div>
  );
}

function copy(text: string, notify: (m: string) => void) {
  navigator.clipboard?.writeText(text).then(() => notify("Link copied"), () => notify("Couldn't copy, select the link instead"));
}

function InviteForm({ onCreated }: { onCreated: (i: Invite) => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("manager");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const inv = await must(supabase.from("invites").insert({ email: email.trim().toLowerCase() || null, role }).select().single());
      onCreated(inv as Invite);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form" onSubmit={submit}>
      <Field label="Their email (optional)" hint="If set, only that email can accept. Leave empty for a one-time link anyone can use.">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="caretaker@example.com" autoFocus />
      </Field>
      <Field label="Role">
        <div className="role-pick">
          {(["manager", "viewer"] as const).map((r) => (
            <button type="button" key={r} className={`unit-opt ${role === r ? "on" : ""}`} onClick={() => setRole(r)}>
              <span><strong style={{ textTransform: "capitalize" }}>{r}</strong><small>{ROLE_TEXT[r]}</small></span>
            </button>
          ))}
        </div>
      </Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn primary block" disabled={busy}>{busy ? "Creating…" : "Create invite link"}</button>
    </form>
  );
}

function InviteCreated({ invite, workspace, onDone }: { invite: Invite; workspace: string; onDone: () => void }) {
  const notify = useNotify();
  const link = inviteLink(invite.token);
  const text = `You're invited to join ${workspace} on Aangan as a ${invite.role}. Open this link to accept: ${link}`;
  return (
    <div className="form">
      <div className="share-box">
        <QR value={link} size={148} />
        <div className="grow stack-sm">
          <span className="eyebrow">Invite link · {invite.role}</span>
          <code className="link-code">{link}</code>
          <span className="small muted">Valid until {dateLabel(invite.expires_at)}. Works once.</span>
        </div>
      </div>
      <div className="row gap wrap">
        <button className="btn grow" onClick={() => copy(link, notify)}><Copy size={15} /> Copy link</button>
        <a className="btn primary grow" href={waLink(null, text)} target="_blank" rel="noreferrer"><MessageCircle size={15} /> Share on WhatsApp</a>
      </div>
      <button className="btn ghost block" onClick={onDone}>Done</button>
    </div>
  );
}
