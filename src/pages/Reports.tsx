import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Archive, ArchiveRestore, BarChart3, Download, History } from "lucide-react";
import { useCanWrite, useData } from "../state/data";
import { useNotify } from "../state/notify";
import { supabase, errorMessage } from "../lib/supabase";
import { currentPeriod, dateLabel, money, periodLabel } from "../lib/format";
import { relativeTime } from "../lib/export";
import { STATUS_LABEL } from "../lib/rent";
import {
  collectionGrid, depositsHeld, exportCollectionCsv, exportExpensesCsv, exportLedgerCsv, exportPaymentsCsv, exportWorkspaceJson,
  lastMonths, ledger, monthTotals, type LedgerKind,
} from "../lib/reports";
import { CountUp, Empty, NeedsSchema, Segmented } from "../components/ui";

type Tab = "overview" | "ledger" | "collection" | "archive" | "activity";
const TABS: { value: Tab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "ledger", label: "Ledger" },
  { value: "collection", label: "Collection" },
  { value: "archive", label: "Archive" },
  { value: "activity", label: "Activity" },
];

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>("overview");
  return (
    <div className="page">
      <div className="page-head">
        <div><span className="eyebrow">Last 12 months</span><h1 className="display">Reports</h1></div>
      </div>
      <div className="scroll-x"><Segmented label="Report" value={tab} onChange={setTab} options={TABS} /></div>
      {tab === "overview" && <Overview />}
      {tab === "ledger" && <Ledger />}
      {tab === "collection" && <Collection />}
      {tab === "archive" && <ArchiveView />}
      {tab === "activity" && <Activity />}
    </div>
  );
}

/* --------------------------------------------------------------- overview */

function Overview() {
  const d = useData();
  const months = useMemo(() => lastMonths(12), []);
  const totals = useMemo(() => monthTotals(d, months), [d, months]);
  const sum = (k: "received" | "spent") => totals.reduce((s, t) => s + t[k], 0);
  const received = sum("received");
  const spent = sum("spent");
  const grid = useMemo(() => collectionGrid(d, months), [d, months]);
  const dueSoFar = grid.reduce((s, l) => s + l.expected, 0);
  const rate = dueSoFar ? grid.reduce((s, l) => s + l.paid, 0) / dueSoFar : 0;
  const held = depositsHeld(d);
  const peak = Math.max(1, ...totals.flatMap((t) => [t.received, t.spent]));
  const fmt = useMemo(() => (n: number) => money(n), []);

  const byProperty = useMemo(() => {
    const unitProp = new Map(d.units.map((u) => [u.id, u.property_id]));
    const leaseProp = new Map(d.leases.map((l) => [l.id, unitProp.get(l.unit_id)]));
    const from = months[0];
    const m = new Map<string, number>();
    for (const p of d.payments) {
      if (p.paid_at.slice(0, 7) < from) continue;
      const pid = leaseProp.get(p.lease_id);
      if (pid) m.set(pid, (m.get(pid) ?? 0) + Number(p.amount));
    }
    return d.properties.map((p) => ({ name: p.name, archived: !!p.archived_at, value: m.get(p.id) ?? 0 }))
      .filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  }, [d, months]);

  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of d.expenses) if (e.spent_on.slice(0, 7) >= months[0]) m.set(e.category, (m.get(e.category) ?? 0) + Number(e.amount));
    return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [d, months]);

  return (
    <>
      <div className="tiles">
        <div className="tile"><span className="eyebrow">Rent recorded</span><span className="mono big"><CountUp value={received} format={fmt} /></span></div>
        <div className="tile"><span className="eyebrow">Expenses</span><span className="mono big"><CountUp value={spent} format={fmt} /></span></div>
        <div className="tile"><span className="eyebrow">Net</span><span className={`mono big ${received - spent < 0 ? "neg" : ""}`}><CountUp value={received - spent} format={fmt} /></span><small className="muted">Rent minus expenses</small></div>
        <div className="tile"><span className="eyebrow">Collection rate</span><span className="mono big">{Math.round(rate * 100)}%</span><small className="muted">Of rent due · deposits held {money(held)}</small></div>
      </div>

      <div className="card">
        <div className="card-head"><h2><BarChart3 size={18} /> Month by month</h2><span className="legend"><i className="sw in" /> Rent in <i className="sw out" /> Spent</span></div>
        <div className="bars twelve" role="img" aria-label="Rent recorded and expenses for each of the last twelve months">
          {totals.map((t) => (
            <div className="bar-col" key={t.period} title={`${periodLabel(t.period)}: in ${money(t.received)}, spent ${money(t.spent)}`}>
              <div className="bar-pair">
                <div className="bar in" style={{ height: `${(t.received / peak) * 100}%` }} />
                <div className="bar out" style={{ height: `${(t.spent / peak) * 100}%` }} />
              </div>
              <span className="tiny muted">{periodLabel(t.period, true).split(" ")[0]}</span>
            </div>
          ))}
        </div>
      </div>

      <section className="two-col">
        <div className="card">
          <div className="card-head"><h2>Rent by property</h2></div>
          {byProperty.length === 0 ? <p className="muted small">No rent recorded in the last 12 months.</p> : (
            <div className="cat-bars">
              {byProperty.map((p) => (
                <div key={p.name}>
                  <div className="row between small"><span>{p.name}{p.archived && <span className="muted"> (archived)</span>}</span><span className="mono">{money(p.value)}</span></div>
                  <div className="progress thin"><div style={{ width: `${(p.value / byProperty[0].value) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <div className="card-head"><h2>Expenses by category</h2></div>
          {byCategory.length === 0 ? <p className="muted small">No expenses logged in the last 12 months.</p> : (
            <div className="cat-bars">
              {byCategory.map((c) => (
                <div key={c.name}>
                  <div className="row between small"><span>{c.name}</span><span className="mono">{money(c.value)}</span></div>
                  <div className="progress thin warm"><div style={{ width: `${(c.value / byCategory[0].value) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="card form">
        <h2>Exports</h2>
        <p className="muted small">Everything in your workspace, as files you keep. CSVs open in Excel, Google Sheets or Tally imports.</p>
        <div className="row gap wrap">
          <button className="btn" onClick={() => exportWorkspaceJson(d)}><Download size={16} /> Full workspace (JSON)</button>
          <button className="btn" onClick={() => exportPaymentsCsv(d)}><Download size={16} /> Payments (CSV)</button>
          <button className="btn" onClick={() => exportExpensesCsv(d)}><Download size={16} /> Expenses (CSV)</button>
          <button className="btn" onClick={() => exportLedgerCsv(ledger(d))}><Download size={16} /> Ledger (CSV)</button>
        </div>
      </div>
    </>
  );
}

/* ----------------------------------------------------------------- ledger */

const KIND_FILTERS: { value: LedgerKind | "all"; label: string }[] = [
  { value: "all", label: "All" }, { value: "rent", label: "Rent" }, { value: "expense", label: "Expenses" }, { value: "deposit", label: "Deposits" },
];

function Ledger() {
  const d = useData();
  const all = useMemo(() => ledger(d), [d]);
  const [kind, setKind] = useState<LedgerKind | "all">("all");
  const [q, setQ] = useState("");
  const [month, setMonth] = useState("");
  const months = useMemo(() => [...new Set(all.map((e) => e.date.slice(0, 7)))].sort().reverse(), [all]);
  const list = all.filter((e) =>
    (kind === "all" || e.kind === kind) && (!month || e.date.startsWith(month)) &&
    (!q || `${e.label} ${e.detail} ${e.ref ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  const cashIn = list.filter((e) => e.kind === "rent").reduce((s, e) => s + e.amount, 0);
  const cashOut = list.filter((e) => e.kind === "expense").reduce((s, e) => s - e.amount, 0);
  const shown = list.slice(0, 400);

  return (
    <div className="card">
      <div className="card-head">
        <h2>Ledger</h2>
        <button className="btn ghost small" onClick={() => exportLedgerCsv(list)} disabled={list.length === 0}><Download size={14} /> CSV</button>
      </div>
      <div className="filters">
        <div className="chips" role="group" aria-label="Entry type">
          {KIND_FILTERS.map((k) => <button key={k.value} className={`chip ${kind === k.value ? "on" : ""}`} aria-pressed={kind === k.value} onClick={() => setKind(k.value)}>{k.label}</button>)}
        </div>
        <div className="row gap-sm grow">
          <input className="search grow" placeholder="Search tenant, category, receipt" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the ledger" />
          <select className="input" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
            <option value="">All months</option>
            {months.map((m) => <option key={m} value={m}>{periodLabel(m)}</option>)}
          </select>
        </div>
      </div>
      <div className="row gap wrap small ledger-sum">
        <span>Rent in <strong className="mono pos">{money(cashIn)}</strong></span>
        <span>Expenses <strong className="mono neg">{money(cashOut)}</strong></span>
        <span>Net <strong className="mono">{money(cashIn - cashOut)}</strong></span>
        <span className="muted">Deposits are listed but never counted as income.</span>
      </div>
      {list.length === 0 ? <Empty title="Nothing matches">Try another filter or month.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Entry</th><th className="hide-sm">Detail</th><th className="num">In</th><th className="num">Out</th></tr></thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap">{dateLabel(e.date, { day: "numeric", month: "short", year: "2-digit" })}</td>
                  <td>
                    <span className={`kind-dot kind-${e.kind}`} aria-hidden />
                    {e.link ? <Link to={e.link}><strong>{e.label}</strong></Link> : <strong>{e.label}</strong>}
                    {e.ref && <span className="tiny muted mono block">{e.ref}</span>}
                    <span className="tiny muted block show-sm">{e.detail}</span>
                  </td>
                  <td className="hide-sm small muted">{e.detail}</td>
                  <td className={`num ${e.kind === "deposit" ? "muted" : ""}`}>{e.amount > 0 ? money(e.amount) : ""}</td>
                  <td className={`num ${e.kind === "deposit" ? "muted" : ""}`}>{e.amount < 0 ? money(-e.amount) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length > shown.length && <p className="tiny muted center">Showing the latest {shown.length} of {list.length}. The CSV has everything.</p>}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- collection */

function Collection() {
  const d = useData();
  const months = useMemo(() => lastMonths(12), []);
  const lines = useMemo(() => collectionGrid(d, months), [d, months]);
  const now = currentPeriod();
  return (
    <div className="card">
      <div className="card-head">
        <h2>Collection by tenant</h2>
        <button className="btn ghost small" onClick={() => exportCollectionCsv(lines, months)} disabled={lines.length === 0}><Download size={14} /> CSV</button>
      </div>
      <div className="legend small heat-legend">
        <span><i className="heat paid" /> Paid</span><span><i className="heat partial" /> Partial</span>
        <span><i className="heat overdue" /> Unpaid</span><span><i className="heat none" /> No lease</span>
      </div>
      {lines.length === 0 ? <Empty title="No leases in the last 12 months" /> : (
        <div className="table-wrap">
          <table className="table heat-table">
            <thead>
              <tr>
                <th>Tenant</th>
                {months.map((m) => <th key={m} className={`heat-th ${m === now ? "now" : ""}`} title={periodLabel(m)}>{periodLabel(m, true).split(" ")[0].slice(0, 3)}</th>)}
                <th className="num">Rate</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const rate = l.expected ? l.paid / l.expected : 1;
                return (
                  <tr key={l.leaseId}>
                    <td><Link to={`/app/tenants/${l.tenantId}`}><strong className="ellipsis block">{l.tenant}</strong></Link><span className="tiny muted ellipsis block">{l.place}</span></td>
                    {l.cells.map((c, i) => {
                      const label = c.status === "none" ? "No rent due" : `${STATUS_LABEL[c.status]}: ${money(c.row!.paid)} of ${money(c.row!.rent)}`;
                      return <td key={months[i]} className="heat-td"><i className={`heat ${c.status}`} title={`${periodLabel(months[i])} · ${label}`} aria-label={`${periodLabel(months[i])}: ${label}`} role="img" /></td>;
                    })}
                    <td className={`num ${rate < 0.9 ? "neg" : ""}`}>{Math.round(rate * 100)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- archive */

function ArchiveView() {
  const d = useData();
  const canWrite = useCanWrite();
  const notify = useNotify();
  const [busy, setBusy] = useState<string | null>(null);
  const props = d.properties.filter((p) => p.archived_at);
  const units = d.units.filter((u) => u.archived_at && !d.properties.find((p) => p.id === u.property_id)?.archived_at);
  const tenants = d.tenants.filter((t) => t.archived_at);
  const propName = new Map(d.properties.map((p) => [p.id, p.name]));

  async function restore(table: "properties" | "units" | "tenants", id: string, name: string) {
    setBusy(id);
    const { error } = await supabase.from(table).update({ archived_at: null }).eq("id", id);
    if (!error && table === "properties") await supabase.from("units").update({ archived_at: null }).eq("property_id", id);
    setBusy(null);
    if (error) return notify(errorMessage(error));
    await d.refresh();
    notify(`${name} restored`);
  }

  const Row = ({ id, table, title, sub, at }: { id: string; table: "properties" | "units" | "tenants"; title: string; sub: string; at: string }) => (
    <li className="list-row">
      <div className="grow"><strong>{title}</strong><small className="muted">{sub} · archived {dateLabel(at)}</small></div>
      {canWrite && <button className="btn small" disabled={busy === id} onClick={() => restore(table, id, title)}><ArchiveRestore size={14} /> {busy === id ? "Restoring…" : "Restore"}</button>}
    </li>
  );

  if (props.length + units.length + tenants.length === 0) {
    return <div className="card"><Empty icon={<Archive />} title="Nothing archived">Archived properties, units and tenants appear here. Their receipts and history are always kept.</Empty></div>;
  }
  return (
    <section className="two-col">
      <div className="card">
        <div className="card-head"><h2>Properties &amp; units</h2></div>
        {props.length + units.length === 0 ? <p className="muted small">None archived.</p> : (
          <ul className="list">
            {props.map((p) => <Row key={p.id} id={p.id} table="properties" title={p.name} sub={p.type} at={p.archived_at!} />)}
            {units.map((u) => <Row key={u.id} id={u.id} table="units" title={u.label} sub={propName.get(u.property_id) ?? "Unit"} at={u.archived_at!} />)}
          </ul>
        )}
      </div>
      <div className="card">
        <div className="card-head"><h2>Tenants</h2></div>
        {tenants.length === 0 ? <p className="muted small">None archived.</p> : (
          <ul className="list">{tenants.map((t) => <Row key={t.id} id={t.id} table="tenants" title={t.name} sub={t.phone_whatsapp ?? "No phone"} at={t.archived_at!} />)}</ul>
        )}
        <p className="tiny muted">Restoring a tenant doesn't restart their old lease. Add a new lease from their page if they're moving back in.</p>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- activity */

const ENTITY: Record<string, string> = {
  workspaces: "Settings", properties: "Property", units: "Unit", tenants: "Tenant", leases: "Lease", payments: "Payment",
  tasks: "Task", expenses: "Expense", invoices: "Invoice", meter_readings: "Meter reading", deposit_txns: "Deposit",
  documents: "Document", members: "Team member",
};
const ACTION: Record<string, string> = { insert: "added", update: "edited", delete: "deleted", archive: "archived", restore: "restored" };

function Activity() {
  const d = useData();
  const [entity, setEntity] = useState("all");
  if (!d.v2) return <NeedsSchema feature="The activity log" />;
  const kinds = [...new Set(d.audit.map((a) => a.entity))];
  const list = d.audit.filter((a) => entity === "all" || a.entity === entity);
  return (
    <div className="card">
      <div className="card-head"><h2><History size={18} /> Activity</h2><span className="small muted">Latest {d.audit.length}</span></div>
      <div className="chips" role="group" aria-label="Filter by type">
        <button className={`chip ${entity === "all" ? "on" : ""}`} aria-pressed={entity === "all"} onClick={() => setEntity("all")}>All</button>
        {kinds.map((k) => <button key={k} className={`chip ${entity === k ? "on" : ""}`} aria-pressed={entity === k} onClick={() => setEntity(k)}>{ENTITY[k] ?? k}</button>)}
      </div>
      {list.length === 0 ? <Empty title="No activity yet">Changes to your workspace are recorded here automatically.</Empty> : (
        <ul className="list timeline">
          {list.map((a) => (
            <li key={a.id} className="list-row">
              <span className={`act-dot act-${a.action}`} aria-hidden />
              <div className="grow">
                <strong>{ENTITY[a.entity] ?? a.entity} {ACTION[a.action] ?? a.action}</strong>
                <small className="muted">{[a.summary, a.actor_email ?? "System"].filter(Boolean).join(" · ")}</small>
              </div>
              <time className="tiny muted nowrap" dateTime={a.at} title={new Date(a.at).toLocaleString()}>{relativeTime(a.at)}</time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
