import { useMemo, useState, type FormEvent } from "react";
import { FileText, Gauge, MessageCircle, Plus, ShieldCheck, Trash2, Zap, Droplets } from "lucide-react";
import { useCanWrite, useData, useLive } from "../state/data";
import { useNotify } from "../state/notify";
import { supabase, errorMessage, must } from "../lib/supabase";
import { currentPeriod, currencySymbol, dateLabel, money, periodLabel, shiftPeriod, todayISO, waLink } from "../lib/format";
import type { RentStatus } from "../lib/rent";
import type { DepositTxn, DepositType, Invoice, Lease, MeterReading, Property, Tenant, Unit } from "../lib/types";
import { CountUp, Empty, Field, NeedsSchema, Pill, Segmented, SheetIf } from "../components/ui";
import { PaymentForm } from "../components/forms";

type Tab = "invoices" | "meters" | "deposits";

function MonthSwitch({ period, onChange }: { period: string; onChange: (p: string) => void }) {
  return (
    <div className="month-switch">
      <button onClick={() => onChange(shiftPeriod(period, -1))} aria-label="Previous month"><span aria-hidden="true">‹</span></button>
      <span>{periodLabel(period)}</span>
      <button onClick={() => onChange(shiftPeriod(period, 1))} aria-label="Next month"><span aria-hidden="true">›</span></button>
    </div>
  );
}

interface Ctx { tenant?: Tenant; unit?: Unit; property?: Property; lease?: Lease }

function useLookup() {
  const d = useData();
  return useMemo(() => {
    const leases = new Map(d.leases.map((l) => [l.id, l]));
    const tenants = new Map(d.tenants.map((t) => [t.id, t]));
    const units = new Map(d.units.map((u) => [u.id, u]));
    const props = new Map(d.properties.map((p) => [p.id, p]));
    const forLease = (leaseId: string): Ctx => {
      const lease = leases.get(leaseId);
      const unit = lease && units.get(lease.unit_id);
      return { lease, tenant: lease && tenants.get(lease.tenant_id), unit, property: unit && props.get(unit.property_id) };
    };
    const forUnit = (unitId: string) => {
      const unit = units.get(unitId);
      return { unit, property: unit && props.get(unit.property_id) };
    };
    return { forLease, forUnit };
  }, [d.leases, d.tenants, d.units, d.properties]);
}

export default function BillingPage() {
  const d = useData();
  const [tab, setTab] = useState<Tab>("invoices");
  if (!d.v2) return <div className="page"><div className="page-head"><h1 className="display">Billing</h1></div><NeedsSchema feature="Billing" /></div>;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="display">Billing</h1>
          <p className="page-sub small">Monthly invoices, utility meters and the security deposit ledger.</p>
        </div>
        <Segmented label="Billing section" value={tab} onChange={setTab} options={[
          { value: "invoices", label: "Invoices" },
          { value: "meters", label: "Meters" },
          { value: "deposits", label: "Deposits" },
        ]} />
      </div>
      {tab === "invoices" && <InvoicesTab />}
      {tab === "meters" && <MetersTab />}
      {tab === "deposits" && <DepositsTab />}
    </div>
  );
}

/* --------------------------------------------------------------- invoices */

function invoiceStatus(inv: Invoice, paid: number, today = todayISO()): RentStatus {
  if (paid >= Number(inv.total)) return "paid";
  if (today > inv.due_date) return "overdue";
  return paid > 0 ? "partial" : "due";
}

function InvoicesTab() {
  const d = useData();
  const canWrite = useCanWrite();
  const notify = useNotify();
  const { forLease } = useLookup();
  const [period, setPeriod] = useState(currentPeriod());
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const paidFor = (leaseId: string, p: string) =>
    d.payments.filter((x) => x.lease_id === leaseId && x.period === p).reduce((s, x) => s + Number(x.amount), 0);

  const rows = d.invoices
    .filter((i) => i.period === period)
    .map((inv) => ({ inv, ...forLease(inv.lease_id), paid: paidFor(inv.lease_id, inv.period) }))
    .sort((a, b) => (a.inv.status === b.inv.status ? a.inv.invoice_no.localeCompare(b.inv.invoice_no) : a.inv.status === "open" ? -1 : 1));
  const open = rows.filter((r) => r.inv.status === "open");
  const invoiced = open.reduce((s, r) => s + Number(r.inv.total), 0);
  const collected = open.reduce((s, r) => s + Math.min(r.paid, Number(r.inv.total)), 0);
  const selected = rows.find((r) => r.inv.id === openId);

  async function generate() {
    setBusy(true);
    const { data, error } = await supabase.rpc("generate_invoices", { p_period: period });
    setBusy(false);
    if (error) return notify(errorMessage(error));
    await d.refresh();
    const n = Number(data ?? 0);
    notify(n ? `${n} invoice${n === 1 ? "" : "s"} created for ${periodLabel(period, true)}` : "Invoices refreshed — nothing new to create");
  }

  return (
    <>
      <div className="row between wrap gap">
        <MonthSwitch period={period} onChange={setPeriod} />
        {canWrite && (
          <button className="btn primary small" onClick={generate} disabled={busy}>
            <FileText size={14} /> {busy ? "Generating…" : `Generate for ${periodLabel(period, true)}`}
          </button>
        )}
      </div>
      <div className="tiles three">
        <div className="tile"><span className="eyebrow">Invoiced</span><span className="mono big"><CountUp value={invoiced} format={money} /></span></div>
        <div className="tile"><span className="eyebrow">Collected</span><span className="mono big"><CountUp value={collected} format={money} /></span></div>
        <div className="tile"><span className="eyebrow">Outstanding</span><span className={`mono big ${invoiced - collected > 0 ? "neg" : ""}`}><CountUp value={invoiced - collected} format={money} /></span></div>
      </div>
      <div className="card">
        <div className="card-head"><h2><FileText size={18} /> Invoices · {periodLabel(period)}</h2><span className="small muted">{open.length} open</span></div>
        {rows.length === 0 ? (
          <Empty icon={<FileText />} title="No invoices this month">
            <p>Generating invoices adds each active lease's rent, metered utilities and any unpaid balance carried from last month.</p>
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table billing-table">
              <thead>
                <tr>
                  <th>Invoice</th><th>Tenant</th>
                  <th className="num hide-sm">Rent</th><th className="num hide-sm">Utilities</th><th className="num hide-sm">Late fee</th>
                  <th className="num hide-sm">Other</th><th className="num hide-sm">C/F</th>
                  <th className="num">Total</th><th className="num">Paid</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.inv.id} className={`clickable ${r.inv.status === "void" ? "voided" : ""}`} onClick={() => setOpenId(r.inv.id)} tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && setOpenId(r.inv.id)}>
                    <td className="mono small">{r.inv.invoice_no}</td>
                    <td><strong>{r.tenant?.name ?? "—"}</strong><small className="muted block">{r.property?.name} · {r.unit?.label}</small></td>
                    <td className="num hide-sm">{money(r.inv.rent)}</td>
                    <td className="num hide-sm">{money(r.inv.utilities)}</td>
                    <td className="num hide-sm">{money(r.inv.late_fee)}</td>
                    <td className="num hide-sm">{money(r.inv.other)}</td>
                    <td className="num hide-sm">{money(r.inv.carried_forward)}</td>
                    <td className="num"><strong>{money(r.inv.total)}</strong></td>
                    <td className="num">{money(r.paid)}</td>
                    <td>{r.inv.status === "void" ? <span className="pill pill-neutral">Void</span> : <Pill status={invoiceStatus(r.inv, r.paid)} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <SheetIf open={selected} title={selected ? `Invoice ${selected.inv.invoice_no}` : ""} onClose={() => setOpenId(null)}>
        {selected && <InvoiceSheet key={selected.inv.id} row={selected} canWrite={canWrite} onDone={() => setOpenId(null)} />}
      </SheetIf>
    </>
  );
}

function InvoiceSheet({ row, canWrite, onDone }: { row: Ctx & { inv: Invoice; paid: number }; canWrite: boolean; onDone: () => void }) {
  const d = useData();
  const notify = useNotify();
  const { inv, tenant, unit, property, paid } = row;
  const [other, setOther] = useState(String(Number(inv.other)));
  const [lateFee, setLateFee] = useState(String(Number(inv.late_fee)));
  const [note, setNote] = useState(inv.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const isVoid = inv.status === "void";
  const total = Number(inv.rent) + Number(inv.utilities) + Number(inv.carried_forward) + Number(other || 0) + Number(lateFee || 0);
  const balance = Math.max(0, total - paid);
  const status = invoiceStatus({ ...inv, total: String(total) }, paid);

  const lines: [string, number][] = [
    ["Rent", Number(inv.rent)],
    ["Utilities", Number(inv.utilities)],
    ["Late fee", Number(lateFee || 0)],
    ["Other charges", Number(other || 0)],
    ["Carried forward", Number(inv.carried_forward)],
  ];
  const message = [
    `Hi ${tenant?.name.split(" ")[0] ?? ""}, here is your invoice ${inv.invoice_no} for ${periodLabel(inv.period)} (${unit?.label}, ${property?.name}):`,
    ...lines.filter(([, v]) => v !== 0).map(([k, v]) => `• ${k}: ${money(v)}`),
    `Total: ${money(total)}${paid > 0 ? `\nPaid so far: ${money(paid)}\nBalance: ${money(balance)}` : ""}`,
    `Due on ${dateLabel(inv.due_date, { day: "numeric", month: "short" })}.${d.workspace?.upi_id ? `\nUPI: ${d.workspace.upi_id}` : ""}`,
    `\nThank you,\n${d.workspace?.name ?? ""}`,
  ].join("\n");

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await must(supabase.from("invoices").update({ other: Number(other || 0), late_fee: Number(lateFee || 0), note: note.trim() || null }).eq("id", inv.id));
      await d.refresh();
      notify("Invoice updated");
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(next: "void" | "open") {
    if (next === "void" && !confirm(`Void invoice ${inv.invoice_no}? Rent status falls back to the lease rent for this month.`)) return;
    setBusy(true);
    const { error } = await supabase.from("invoices").update({ status: next }).eq("id", inv.id);
    setBusy(false);
    if (error) return setError(errorMessage(error));
    await d.refresh();
    notify(next === "void" ? "Invoice voided" : "Invoice restored");
    onDone();
  }

  if (paying) return <PaymentForm leaseId={inv.lease_id} period={inv.period} onDone={onDone} />;

  return (
    <form className="form" onSubmit={save}>
      <div className="row between">
        <div><strong>{tenant?.name}</strong><div className="muted small">{property?.name} · {unit?.label} · due {dateLabel(inv.due_date)}</div></div>
        {isVoid ? <span className="pill pill-neutral">Void</span> : <Pill status={status} />}
      </div>
      <dl className="kv">
        {lines.map(([k, v]) => <div key={k} style={{ display: "contents" }}><dt>{k}</dt><dd>{money(v)}</dd></div>)}
        <dt className="total">Total</dt><dd className="total">{money(total)}</dd>
        <dt>Paid</dt><dd className="pos">{money(paid)}</dd>
        <dt>Balance</dt><dd className={balance > 0 ? "neg" : ""}>{money(balance)}</dd>
      </dl>
      {canWrite && !isVoid && (
        <>
          <div className="grid-2">
            <Field label={`Other charges (${currencySymbol()})`} hint="Maintenance, parking…">
              <input type="number" inputMode="decimal" step="0.01" value={other} onChange={(e) => setOther(e.target.value)} />
            </Field>
            <Field label={`Late fee (${currencySymbol()})`}>
              <input type="number" inputMode="decimal" min="0" step="0.01" value={lateFee} onChange={(e) => setLateFee(e.target.value)} />
            </Field>
          </div>
          <Field label="Note"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Shown to you only" /></Field>
        </>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="row gap wrap">
        <a className="btn" href={waLink(tenant?.phone_whatsapp, message)} target="_blank" rel="noreferrer"><MessageCircle size={15} /> WhatsApp</a>
        {canWrite && !isVoid && balance > 0 && <button type="button" className="btn" onClick={() => setPaying(true)}>Record payment</button>}
        {canWrite && (isVoid
          ? <button type="button" className="btn ghost" onClick={() => setStatus("open")} disabled={busy}>Restore</button>
          : <button type="button" className="btn danger ghost" onClick={() => setStatus("void")} disabled={busy}>Void</button>)}
      </div>
      {canWrite && !isVoid && <button className="btn primary block" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>}
    </form>
  );
}

/* ------------------------------------------------------------------ meters */

function MetersTab() {
  const d = useData();
  const canWrite = useCanWrite();
  const notify = useNotify();
  const { forUnit } = useLookup();
  const [period, setPeriod] = useState(currentPeriod());
  const [adding, setAdding] = useState(false);
  const rows = d.meters.filter((m) => m.period === period).map((m) => ({ m, ...forUnit(m.unit_id) }));
  const total = rows.reduce((s, r) => s + Number(r.m.amount), 0);

  async function remove(m: MeterReading) {
    if (!confirm("Delete this meter reading?")) return;
    const { error } = await supabase.from("meter_readings").delete().eq("id", m.id);
    if (error) return notify(errorMessage(error));
    await d.refresh();
    notify("Reading deleted");
  }

  return (
    <>
      <div className="row between wrap gap">
        <MonthSwitch period={period} onChange={setPeriod} />
        {canWrite && <button className="btn primary small" onClick={() => setAdding(true)}><Plus size={14} /> Add reading</button>}
      </div>
      <div className="card">
        <div className="card-head"><h2><Gauge size={18} /> Readings · {periodLabel(period)}</h2><span className="mono small">{money(total)}</span></div>
        {rows.length === 0 ? (
          <Empty icon={<Gauge />} title="No readings yet">
            <p>Log electricity or water meters per unit. The charge is added to that month's invoice when you generate or regenerate invoices.</p>
          </Empty>
        ) : (
          <ul className="list">
            {rows.map(({ m, unit, property }) => {
              const used = Number(m.current) - Number(m.previous);
              return (
                <li key={m.id} className="list-row">
                  <span className={`meter-icon ${m.kind}`}>{m.kind === "electric" ? <Zap size={15} /> : <Droplets size={15} />}</span>
                  <div className="grow">
                    <strong>{unit?.label ?? "Unit"} · {property?.name}</strong>
                    <small className="muted">{m.kind === "electric" ? "Electricity" : "Water"} · {Number(m.previous)} → {Number(m.current)} = {used} units × {money(Number(m.rate))}</small>
                  </div>
                  <span className="mono">{money(m.amount)}</span>
                  {canWrite && <button className="icon-btn" aria-label="Delete reading" onClick={() => remove(m)}><Trash2 size={15} /></button>}
                </li>
              );
            })}
          </ul>
        )}
        <p className="field-hint billing-hint">Added readings after invoices exist? Press “Generate” on the Invoices tab again to refresh utilities.</p>
      </div>
      <SheetIf open={adding} title="Add meter reading" onClose={() => setAdding(false)}>
        <MeterForm period={period} onDone={() => setAdding(false)} />
      </SheetIf>
    </>
  );
}

function MeterForm({ period, onDone }: { period: string; onDone: () => void }) {
  const live = useLive();
  const notify = useNotify();
  const propName = (pid: string) => live.properties.find((p) => p.id === pid)?.name ?? "";
  const [unit, setUnit] = useState(live.units[0]?.id ?? "");
  const [kind, setKind] = useState<"electric" | "water">("electric");
  const last = (u: string, k: string) =>
    live.meters.filter((m) => m.unit_id === u && m.kind === k && m.period < period).sort((a, b) => b.period.localeCompare(a.period))[0];
  const prevReading = last(unit, kind);
  const [previous, setPrevious] = useState(prevReading ? String(Number(prevReading.current)) : "");
  const [current, setCurrent] = useState("");
  const [rate, setRate] = useState(prevReading ? String(Number(prevReading.rate)) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pick(u: string, k: "electric" | "water") {
    setUnit(u);
    setKind(k);
    const p = last(u, k);
    setPrevious(p ? String(Number(p.current)) : "");
    if (p) setRate(String(Number(p.rate)));
  }

  const used = Math.max(0, Number(current || 0) - Number(previous || 0));
  const amount = Math.round(used * Number(rate || 0) * 100) / 100;
  const invalid = current !== "" && Number(current) < Number(previous || 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (invalid) return setError("Current reading can't be lower than the previous one.");
    setBusy(true);
    setError(null);
    try {
      await must(supabase.from("meter_readings").insert({
        unit_id: unit, kind, period, previous: Number(previous || 0), current: Number(current), rate: Number(rate || 0),
      }));
      await live.refresh();
      notify("Reading saved");
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (live.units.length === 0) return <p className="muted">Add a property with units first.</p>;

  return (
    <form className="form" onSubmit={submit}>
      <p className="muted small">For {periodLabel(period)}</p>
      <Field label="Unit">
        <select value={unit} onChange={(e) => pick(e.target.value, kind)} required>
          {live.units.map((u) => <option key={u.id} value={u.id}>{u.label} · {propName(u.property_id)}</option>)}
        </select>
      </Field>
      <Field label="Meter">
        <div className="chips">
          <button type="button" className={`chip ${kind === "electric" ? "on" : ""}`} onClick={() => pick(unit, "electric")}><Zap size={13} /> Electricity</button>
          <button type="button" className={`chip ${kind === "water" ? "on" : ""}`} onClick={() => pick(unit, "water")}><Droplets size={13} /> Water</button>
        </div>
      </Field>
      <div className="grid-2">
        <Field label="Previous" hint={prevReading ? `From ${periodLabel(prevReading.period, true)}` : undefined}>
          <input type="number" inputMode="decimal" min="0" step="0.01" value={previous} onChange={(e) => setPrevious(e.target.value)} required />
        </Field>
        <Field label="Current">
          <input type="number" inputMode="decimal" min="0" step="0.01" value={current} onChange={(e) => setCurrent(e.target.value)} required autoFocus />
        </Field>
      </div>
      <Field label={`Rate per unit (${currencySymbol()})`}>
        <input type="number" inputMode="decimal" min="0" step="0.0001" value={rate} onChange={(e) => setRate(e.target.value)} required />
      </Field>
      <div className="meter-preview">
        <span className="muted small">{used} units × {money(Number(rate || 0))}</span>
        <span className="mono big">{money(amount)}</span>
      </div>
      {(error || invalid) && <p className="form-error" role="alert">{error ?? "Current reading can't be lower than the previous one."}</p>}
      <button className="btn primary block" disabled={busy || !unit || invalid}>{busy ? "Saving…" : "Save reading"}</button>
    </form>
  );
}

/* ---------------------------------------------------------------- deposits */

function depositTotals(txns: DepositTxn[]) {
  const sum = (t: DepositType) => txns.filter((x) => x.type === t).reduce((s, x) => s + Number(x.amount), 0);
  const received = sum("received");
  const deductions = sum("deduction");
  const refunds = sum("refund");
  return { received, deductions, refunds, held: received - deductions - refunds };
}

const TYPE_LABEL: Record<DepositType, string> = { received: "Received", deduction: "Deduction", refund: "Refund" };

function DepositsTab() {
  const d = useData();
  const { forLease } = useLookup();
  const [openLease, setOpenLease] = useState<string | null>(null);
  const rows = d.leases
    .map((l) => {
      const txns = d.deposits.filter((x) => x.lease_id === l.id);
      return { ...forLease(l.id), lease: l, txns, ...depositTotals(txns) };
    })
    .filter((r) => r.lease.status === "active" || r.txns.length > 0)
    .sort((a, b) => (a.lease.status === b.lease.status ? (a.tenant?.name ?? "").localeCompare(b.tenant?.name ?? "") : a.lease.status === "active" ? -1 : 1));
  const held = rows.reduce((s, r) => s + r.held, 0);
  const agreed = rows.filter((r) => r.lease.status === "active").reduce((s, r) => s + Number(r.lease.deposit), 0);
  const refunded = rows.reduce((s, r) => s + r.refunds, 0);
  const selected = rows.find((r) => r.lease.id === openLease);

  return (
    <>
      <div className="tiles three">
        <div className="tile"><span className="eyebrow">Deposits held</span><span className="mono big"><CountUp value={held} format={money} /></span><small className="muted">Held, not income</small></div>
        <div className="tile"><span className="eyebrow">Agreed (active)</span><span className="mono big"><CountUp value={agreed} format={money} /></span></div>
        <div className="tile"><span className="eyebrow">Refunded</span><span className="mono big"><CountUp value={refunded} format={money} /></span></div>
      </div>
      <div className="card">
        <div className="card-head"><h2><ShieldCheck size={18} /> Deposit ledger</h2></div>
        {rows.length === 0 ? <Empty icon={<ShieldCheck />} title="No leases yet">Deposits appear here once tenants have leases.</Empty> : (
          <ul className="list">
            {rows.map((r) => {
              const short = r.lease.status === "active" && r.received < Number(r.lease.deposit);
              return (
                <li key={r.lease.id}>
                  <button className="list-row as-button" onClick={() => setOpenLease(r.lease.id)}>
                    <div className="grow">
                      <strong>{r.tenant?.name ?? "Tenant"}</strong>
                      <small className="muted">{r.property?.name} · {r.unit?.label} · agreed {money(r.lease.deposit)}{r.lease.status === "ended" ? " · ended" : ""}</small>
                    </div>
                    <span className="small muted hide-sm">in {money(r.received)} · out {money(r.deductions + r.refunds)}</span>
                    <span className="mono">{money(r.held)}</span>
                    {short ? <span className="pill pill-partial">Short</span> : r.held === 0 && r.received > 0 ? <span className="pill pill-neutral">Settled</span> : <span className="pill pill-paid">Held</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <SheetIf open={selected} title="Deposit ledger" onClose={() => setOpenLease(null)}>
        {selected && <DepositSheet key={selected.lease.id} row={selected} onDone={() => setOpenLease(null)} />}
      </SheetIf>
    </>
  );
}

function DepositSheet({ row, onDone }: { row: Ctx & { lease: Lease; txns: DepositTxn[]; received: number; deductions: number; refunds: number; held: number }; onDone: () => void }) {
  const d = useData();
  const canWrite = useCanWrite();
  const notify = useNotify();
  const [type, setType] = useState<DepositType>(row.received === 0 ? "received" : "deduction");
  const [amount, setAmount] = useState(row.received === 0 ? String(Number(row.lease.deposit) || "") : "");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!(amt > 0)) return;
    if (type !== "received" && amt > row.held) return setError(`Only ${money(row.held)} is held for this lease.`);
    setBusy(true);
    setError(null);
    try {
      await must(supabase.from("deposit_txns").insert({ lease_id: row.lease.id, type, amount: amt, txn_date: date, note: note.trim() || null }));
      await d.refresh();
      notify(`${TYPE_LABEL[type]} recorded`);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(t: DepositTxn) {
    if (!confirm("Delete this deposit entry?")) return;
    const { error } = await supabase.from("deposit_txns").delete().eq("id", t.id);
    if (error) return notify(errorMessage(error));
    await d.refresh();
    notify("Entry deleted");
  }

  return (
    <div className="form">
      <div><strong>{row.tenant?.name}</strong><div className="muted small">{row.property?.name} · {row.unit?.label} · agreed {money(row.lease.deposit)}</div></div>
      <dl className="kv">
        <dt>Received</dt><dd>{money(row.received)}</dd>
        <dt>Deductions</dt><dd>− {money(row.deductions)}</dd>
        <dt>Refunds</dt><dd>− {money(row.refunds)}</dd>
        <dt className="total">Held</dt><dd className="total">{money(row.held)}</dd>
      </dl>
      {row.txns.length > 0 ? (
        <ul className="list">
          {row.txns.map((t) => (
            <li key={t.id} className="list-row">
              <span className={`pill ${t.type === "received" ? "pill-paid" : t.type === "refund" ? "pill-neutral" : "pill-partial"}`}>{TYPE_LABEL[t.type]}</span>
              <div className="grow"><small className="muted">{dateLabel(t.txn_date)}{t.note ? ` · ${t.note}` : ""}</small></div>
              <span className="mono">{t.type === "received" ? "" : "− "}{money(t.amount)}</span>
              {canWrite && <button className="icon-btn" aria-label="Delete entry" onClick={() => remove(t)}><Trash2 size={15} /></button>}
            </li>
          ))}
        </ul>
      ) : <p className="muted small">No entries yet.</p>}
      {canWrite && (
        <form className="form deposit-add" onSubmit={submit}>
          <h2>Add entry</h2>
          <div className="chips">
            {(["received", "deduction", "refund"] as DepositType[]).map((t) => (
              <button type="button" key={t} className={`chip ${type === t ? "on" : ""}`} onClick={() => setType(t)}>{TYPE_LABEL[t]}</button>
            ))}
          </div>
          <div className="grid-2">
            <Field label={`Amount (${currencySymbol()})`}><input type="number" inputMode="decimal" min="1" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required /></Field>
            <Field label="Date"><input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} required /></Field>
          </div>
          <Field label="Note" hint={type === "deduction" ? "What was deducted for, e.g. repainting." : undefined}><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn primary block" disabled={busy}>{busy ? "Saving…" : `Record ${TYPE_LABEL[type].toLowerCase()}`}</button>
        </form>
      )}
    </div>
  );
}
