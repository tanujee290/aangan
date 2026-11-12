import { useMemo, useState } from "react";
import { Link, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { ArrowLeft, Archive, Building2, MapPin, Pencil, UserPlus } from "lucide-react";
import { useData, useLive } from "../state/data";
import { useNotify } from "../state/notify";
import { supabase, errorMessage } from "../lib/supabase";
import { currentPeriod, money } from "../lib/format";
import { rentRows } from "../lib/rent";
import { Empty, Pill, SheetIf } from "../components/ui";
import { PropertyForm, TenantLeaseForm } from "../components/forms";
import type { ShellCtx } from "../components/shell";

export function PropertiesPage() {
  const live = useLive();
  const { openAdd } = useOutletContext<ShellCtx>();
  const rows = useMemo(() => rentRows(currentPeriod(), live), [live]);
  return (
    <div className="page">
      <div className="page-head"><h1 className="display">Properties</h1><button className="btn primary small" onClick={() => openAdd("property")}>Add property</button></div>
      {live.properties.length === 0 ? <div className="card"><Empty icon={<Building2 />} title="No properties yet" /></div> : (
        <div className="card-grid">
          {live.properties.map((p) => {
            const units = live.units.filter((u) => u.property_id === p.id);
            const pr = rows.filter((r) => r.property.id === p.id);
            const rent = pr.reduce((s, r) => s + r.rent, 0);
            return (
              <Link key={p.id} to={`/app/properties/${p.id}`} className="card prop-card">
                <div className="row between"><span className="eyebrow">{p.type}</span><span className="small muted">{pr.length}/{units.length} occupied</span></div>
                <h2 className="h3">{p.name}</h2>
                {p.address && <p className="muted small"><MapPin size={12} /> {p.address}</p>}
                <div className="unit-dots">{units.map((u) => <span key={u.id} className="dot" style={{ background: u.pass_colour ?? "var(--accent)" }} title={u.label} />)}</div>
                <div className="row between"><span className="small muted">Monthly rent</span><span className="mono">{money(rent)}</span></div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function PropertyDetailPage() {
  const { id } = useParams();
  const d = useData();
  const live = useLive();
  const notify = useNotify();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [addTenantFor, setAddTenantFor] = useState<string | null>(null);
  const p = d.properties.find((x) => x.id === id);
  const rows = useMemo(() => rentRows(currentPeriod(), live), [live]);
  if (!p) return <div className="page"><Empty title="Property not found"><Link to="/app/properties">Back</Link></Empty></div>;
  const units = live.units.filter((u) => u.property_id === p.id);

  async function archive(table: "properties" | "units", rowId: string, label: string) {
    if (!confirm(`Archive ${label}? It will be hidden but its history is kept.`)) return;
    const { error } = await supabase.from(table).update({ archived_at: new Date().toISOString() }).eq("id", rowId);
    if (error) return notify(errorMessage(error));
    await d.refresh();
    notify(`${label} archived`);
    if (table === "properties") navigate("/app/properties");
  }

  return (
    <div className="page">
      <div className="page-head">
        <Link to="/app/properties" className="btn ghost small"><ArrowLeft size={16} /> Properties</Link>
        <div className="row gap-sm">
          <button className="btn ghost small" onClick={() => setEditing(true)}><Pencil size={14} /> Edit</button>
          <button className="btn ghost small" onClick={() => archive("properties", p.id, p.name)}><Archive size={14} /> Archive</button>
        </div>
      </div>
      <div className="hero-card card">
        <span className="eyebrow">{p.type}</span>
        <h1 className="display">{p.name}</h1>
        {p.address && <p className="muted"><MapPin size={14} /> {p.address}</p>}
      </div>
      <div className="card">
        <div className="card-head"><h2>Units</h2></div>
        <ul className="list">
          {units.map((u) => {
            const r = rows.find((x) => x.unit.id === u.id);
            return (
              <li key={u.id} className="list-row">
                <span className="dot lg" style={{ background: u.pass_colour ?? "var(--accent)" }} />
                <div className="grow">
                  <strong>{u.label}</strong>
                  {r ? <small className="muted"><Link to={`/app/tenants/${r.tenant.id}`}>{r.tenant.name}</Link> · {money(r.rent)}/mo</small> : <small className="muted">Vacant</small>}
                </div>
                {r ? <Pill status={r.status} /> : <button className="btn small" onClick={() => setAddTenantFor(u.id)}><UserPlus size={14} /> Add tenant</button>}
                {!r && <button className="icon-btn" aria-label="Archive unit" onClick={() => archive("units", u.id, u.label)}><Archive size={15} /></button>}
              </li>
            );
          })}
        </ul>
      </div>
      <SheetIf open={editing} title="Edit property" onClose={() => setEditing(false)}>
        <PropertyForm property={p} onDone={() => setEditing(false)} />
      </SheetIf>
      <SheetIf open={addTenantFor} title="Add tenant & lease" onClose={() => setAddTenantFor(null)}>
        {addTenantFor && <TenantLeaseForm unitId={addTenantFor} onDone={() => setAddTenantFor(null)} />}
      </SheetIf>
    </div>
  );
}
