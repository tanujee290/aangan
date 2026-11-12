import { useMemo, useState } from "react";
import { Link, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { Archive, ArrowLeft, Copy, ExternalLink, Link2, Link2Off, Mail, MessageCircle, Pencil, Phone, RefreshCw, Users } from "lucide-react";
import { useCanWrite, useData, useLive } from "../state/data";
import { useNotify } from "../state/notify";
import { supabase, errorMessage } from "../lib/supabase";
import { currentPeriod, dateLabel, initials, METHOD_LABEL, tone, money, periodLabel, waLink } from "../lib/format";
import { rentRows } from "../lib/rent";
import { reminderText } from "../lib/reminders";
import type { Lease, Tenant } from "../lib/types";
import { portalUrl } from "../lib/portal";
import { Empty, Pill, SheetIf } from "../components/ui";
import { LeaseForm, PaymentForm, TenantForm } from "../components/forms";
import type { ShellCtx } from "../components/shell";

export function TenantsPage() {
  const live = useLive();
  const { openAdd } = useOutletContext<ShellCtx>();
  const rows = useMemo(() => rentRows(currentPeriod(), live), [live]);
  const [q, setQ] = useState("");
  const list = live.tenants.filter((t) => t.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="page">
      <div className="page-head"><h1 className="display">Tenants</h1><button className="btn primary small" onClick={() => openAdd("tenant")}>Add tenant</button></div>
      {live.tenants.length === 0 ? <div className="card"><Empty icon={<Users />} title="No tenants yet" /></div> : (
        <div className="card">
          <input className="search" placeholder="Search tenants" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="list">
            {list.map((t) => {
              const r = rows.find((x) => x.tenant.id === t.id);
              return (
                <li key={t.id}>
                  <Link to={`/app/tenants/${t.id}`} className="list-row">
                    <div className="avatar" data-tone={tone(t.name)}>{initials(t.name)}</div>
                    <div className="grow"><strong>{t.name}</strong><small className="muted">{r ? `${r.property.name} · ${r.unit.label}` : "No active lease"}</small></div>
                    {r && <span className="mono hide-sm">{money(r.rent)}</span>}
                    {r && <Pill status={r.status} />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export function TenantDetailPage() {
  const { id } = useParams();
  const d = useData();
  const live = useLive();
  const notify = useNotify();
  const navigate = useNavigate();
  const [editTenant, setEditTenant] = useState(false);
  const [editLease, setEditLease] = useState<Lease | null>(null);
  const [record, setRecord] = useState<string | null>(null);
  const t = d.tenants.find((x) => x.id === id);
  const rows = useMemo(() => rentRows(currentPeriod(), live), [live]);
  if (!t) return <div className="page"><Empty title="Tenant not found"><Link to="/app/tenants">Back</Link></Empty></div>;
  const leases = d.leases.filter((l) => l.tenant_id === t.id);
  const leaseIds = new Set(leases.map((l) => l.id));
  const payments = d.payments.filter((p) => leaseIds.has(p.lease_id));
  const current = rows.find((r) => r.tenant.id === t.id);
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);

  async function archive() {
    if (!confirm(`Archive ${t!.name}? Their leases and receipts are kept.`)) return;
    const { error } = await supabase.from("tenants").update({ archived_at: new Date().toISOString() }).eq("id", t!.id);
    if (error) return notify(errorMessage(error));
    await supabase.from("leases").update({ status: "ended" }).eq("tenant_id", t!.id).eq("status", "active");
    await d.refresh();
    notify("Tenant archived");
    navigate("/app/tenants");
  }

  return (
    <div className="page">
      <div className="page-head">
        <Link to="/app/tenants" className="btn ghost small"><ArrowLeft size={16} /> Tenants</Link>
        <div className="row gap-sm">
          <button className="btn ghost small" onClick={() => setEditTenant(true)}><Pencil size={14} /> Edit</button>
          {!t.archived_at && <button className="btn ghost small" onClick={archive}><Archive size={14} /> Archive</button>}
        </div>
      </div>
      <div className="card hero-card row gap">
        <div className="avatar xl" data-tone={tone(t.name)}>{initials(t.name)}</div>
        <div className="grow">
          <h1 className="display">{t.name}</h1>
          <div className="row gap wrap small muted">
            {t.phone_whatsapp && <span><Phone size={12} /> {t.phone_whatsapp}</span>}
            {t.email && <span><Mail size={12} /> {t.email}</span>}
            {t.archived_at && <span>Archived</span>}
          </div>
        </div>
        {current && <Pill status={current.status} />}
      </div>

      {current && (
        <div className="tiles three">
          <div className="tile"><span className="eyebrow">This month</span><span className="mono big">{money(current.paid)} / {money(current.rent)}</span></div>
          <div className="tile"><span className="eyebrow">Balance</span><span className="mono big">{money(current.balance)}</span></div>
          <div className="tile row gap-sm center">
            <a className="btn ghost small" href={waLink(t.phone_whatsapp, reminderText(current, d.workspace!))} target="_blank" rel="noreferrer"><MessageCircle size={14} /> Remind</a>
            <button className="btn primary small" onClick={() => setRecord(current.lease.id)}>Record payment</button>
          </div>
        </div>
      )}

      <section className="two-col">
        <div className="card">
          <div className="card-head"><h2>Leases</h2></div>
          <ul className="list">
            {leases.map((l) => {
              const u = d.units.find((x) => x.id === l.unit_id);
              const p = u && d.properties.find((x) => x.id === u.property_id);
              return (
                <li key={l.id} className="list-row">
                  <div className="grow">
                    <strong>{p?.name} · {u?.label}</strong>
                    <small className="muted">{money(l.rent)}/mo · due day {l.due_day} · deposit {money(l.deposit)} · {dateLabel(l.start_date)} → {l.end_date ? dateLabel(l.end_date) : "ongoing"}</small>
                  </div>
                  <span className={`small ${l.status === "active" ? "" : "muted"}`}>{l.status === "active" ? "Active" : "Ended"}</span>
                  <button className="icon-btn" aria-label="Edit lease" onClick={() => setEditLease(l)}><Pencil size={15} /></button>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="card">
          <div className="card-head"><h2>Receipts</h2><span className="small muted">Total {money(totalPaid)}</span></div>
          {payments.length === 0 ? <p className="muted small">No payments yet.</p> : (
            <ul className="list">
              {payments.map((p) => (
                <li key={p.id}><Link to={`/app/payments/${p.id}`} className="list-row">
                  <div className="grow"><strong>{periodLabel(p.period)}</strong><small className="muted">{p.receipt_no} · {METHOD_LABEL[p.method]} · {dateLabel(p.paid_at)}</small></div>
                  <span className="mono">{money(p.amount)}</span>
                </Link></li>
              ))}
            </ul>
          )}
        </div>
      </section>
      {d.v2 && !t.archived_at && <PortalCard tenant={t} />}

      <SheetIf open={editTenant} title="Edit tenant" onClose={() => setEditTenant(false)}>
        <TenantForm tenant={t} onDone={() => setEditTenant(false)} />
      </SheetIf>
      <SheetIf open={editLease} title="Edit lease" onClose={() => setEditLease(null)}>
        {editLease && <LeaseForm lease={editLease} onDone={() => setEditLease(null)} />}
      </SheetIf>
      <SheetIf open={record} title="Record a payment" onClose={() => setRecord(null)}>
        {record && <PaymentForm leaseId={record} onDone={() => setRecord(null)} />}
      </SheetIf>
    </div>
  );
}

/** Share a private, read-only portal link with the tenant: their pass, dues, receipts and maintenance requests. */
function PortalCard({ tenant }: { tenant: Tenant }) {
  const d = useData();
  const canWrite = useCanWrite();
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  const url = tenant.portal_token ? portalUrl(tenant.portal_token) : null;
  const first = tenant.name.split(" ")[0];

  async function set(enabled: boolean, msg: string) {
    if (!enabled && !confirm(`Switch off ${first}'s portal link? The current link stops working straight away.`)) return;
    if (enabled && url && !confirm("Create a new link? The current one stops working.")) return;
    setBusy(true);
    const { error } = await supabase.rpc("set_tenant_portal", { p_tenant: tenant.id, p_enabled: enabled });
    setBusy(false);
    if (error) return notify(errorMessage(error));
    await d.refresh();
    notify(msg);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url!);
      notify("Portal link copied");
    } catch {
      prompt("Copy this link", url!);
    }
  }

  const share = url && `Hi ${first}, here's your tenant portal for ${d.workspace?.name}. You can see your rent, bills and receipts, and raise maintenance requests:\n${url}`;

  return (
    <div className="card">
      <div className="card-head"><h2><Link2 size={18} /> Tenant portal</h2>{url && <span className="pill pill-paid">On</span>}</div>
      {url ? (
        <div className="stack-sm">
          <p className="small muted">Anyone with this link can see {first}'s rent, bills and receipts, and raise maintenance requests. It never shows other tenants or your totals.</p>
          <div className="link-box mono small">{url}</div>
          <div className="row gap-sm wrap">
            <button className="btn small" onClick={copy}><Copy size={14} /> Copy</button>
            <a className="btn small" href={waLink(tenant.phone_whatsapp, share!)} target="_blank" rel="noreferrer"><MessageCircle size={14} /> Send on WhatsApp</a>
            <a className="btn ghost small" href={url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Preview</a>
            {canWrite && <button className="btn ghost small" disabled={busy} onClick={() => set(true, "New portal link created")}><RefreshCw size={14} /> New link</button>}
            {canWrite && <button className="btn ghost small" disabled={busy} onClick={() => set(false, "Portal link switched off")}><Link2Off size={14} /> Switch off</button>}
          </div>
        </div>
      ) : (
        <div className="row gap wrap between">
          <p className="small muted grow">Give {first} a private link to check dues, download receipts and report repairs, with no account or app needed.</p>
          {canWrite && <button className="btn primary small" disabled={busy} onClick={() => set(true, "Portal link created")}>{busy ? "Creating…" : "Create portal link"}</button>}
        </div>
      )}
    </div>
  );
}
