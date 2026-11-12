import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { CheckCircle2, CircleDot, Clock3, Hammer, IndianRupee, KeyRound, ReceiptText, ShieldAlert } from "lucide-react";
import { supabase, errorMessage } from "../lib/supabase";
import { currentPeriod, dateLabel, METHOD_LABEL, money, periodLabel, setFormatting, todayISO, upiLink } from "../lib/format";
import type { PortalLease, PortalView } from "../lib/portal";
import type { RentStatus } from "../lib/rent";
import { Empty, Field, Jaali, Logo, Pill, QR } from "../components/ui";

type State = "loading" | "missing" | PortalView;

export default function PortalPage() {
  const { token = "" } = useParams();
  const [state, setState] = useState<State>("loading");

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("tenant_portal", { p_token: token });
    setState(error || !data ? "missing" : (data as PortalView));
  }, [token]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (typeof state === "object") setFormatting(state.landlord.currency, state.landlord.locale);
  }, [state]);

  return (
    <div className="portal">
      <header className="portal-head">
        <span className="brand"><Logo /><span>Aangan</span></span>
        {typeof state === "object" && <span className="small muted">Tenant portal</span>}
      </header>
      {state === "loading" && <div className="card"><div className="sk" style={{ height: 140 }} /></div>}
      {state === "missing" && (
        <div className="card verify-banner bad"><ShieldAlert /><div>
          <strong>This portal link isn't active</strong>
          <p className="small">The link may have been switched off or replaced. Ask your landlord to send you a new one.</p>
        </div></div>
      )}
      {typeof state === "object" && <Portal view={state} token={token} reload={load} />}
      <p className="tiny muted center">Read-only view shared by your landlord through <Link to="/">Aangan</Link>. Payments shown are those your landlord has recorded.</p>
    </div>
  );
}

function leaseStatus(l: PortalLease, view: PortalView, period: string) {
  const invoice = view.invoices.find((i) => i.lease_id === l.id && i.period === period);
  const due = invoice ? Number(invoice.total) : Number(l.rent);
  const paid = view.payments.filter((p) => p.lease_id === l.id && p.period === period).reduce((s, p) => s + Number(p.amount), 0);
  const dueDate = `${period}-${String(l.due_day).padStart(2, "0")}`;
  const status: RentStatus = paid >= due ? "paid" : todayISO() > dueDate ? "overdue" : paid > 0 ? "partial" : "due";
  return { invoice, due, paid, balance: Math.max(0, due - paid), dueDate, status };
}

function Portal({ view, token, reload }: { view: PortalView; token: string; reload: () => Promise<void> }) {
  const period = currentPeriod();
  const active = view.leases.filter((l) => l.status === "active");
  const first = view.tenant.name.split(" ")[0];
  const older = view.invoices.filter((i) => i.period !== period);
  const outstandingOlder = useMemo(() => older.filter((i) => {
    const paid = view.payments.filter((p) => p.lease_id === i.lease_id && p.period === i.period).reduce((s, p) => s + Number(p.amount), 0);
    return paid < Number(i.total);
  }), [older, view.payments]);

  return (
    <>
      <div>
        <span className="eyebrow">{view.landlord.name}</span>
        <h1 className="display">Hi {first}.</h1>
      </div>

      {active.length === 0 && <div className="card"><Empty icon={<KeyRound />} title="No active lease">Your past receipts are still listed below.</Empty></div>}
      {active.map((l) => <LeaseCard key={l.id} lease={l} view={view} period={period} />)}

      {outstandingOlder.length > 0 && (
        <div className="card">
          <div className="card-head"><h2>Earlier bills</h2></div>
          <ul className="list">
            {outstandingOlder.map((i) => (
              <li key={i.invoice_no} className="list-row">
                <div className="grow"><strong>{periodLabel(i.period)}</strong><small className="muted mono">{i.invoice_no} · due {dateLabel(i.due_date)}</small></div>
                <span className="mono">{money(i.total)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <div className="card-head"><h2><ReceiptText size={18} /> Receipts</h2></div>
        {view.payments.length === 0 ? <p className="muted small">No payments recorded yet.</p> : (
          <ul className="list">
            {view.payments.map((p) => (
              <li key={p.receipt_no}><Link to={`/r/${p.verify_token}`} className="list-row">
                <div className="grow"><strong>{periodLabel(p.period)}</strong><small className="muted">{p.receipt_no} · {METHOD_LABEL[p.method] ?? p.method} · {dateLabel(p.paid_at)}</small></div>
                <span className="mono">{money(p.amount)}</span>
              </Link></li>
            ))}
          </ul>
        )}
      </div>

      <Requests view={view} token={token} reload={reload} canRaise={active.length > 0} />
    </>
  );
}

function LeaseCard({ lease: l, view, period }: { lease: PortalLease; view: PortalView; period: string }) {
  const s = leaseStatus(l, view, period);
  const upi = view.landlord.upi_id;
  const pay = upi && s.balance > 0
    ? upiLink({ upi, payee: view.landlord.name, amount: s.balance, note: `Rent ${period} ${l.unit}`, cur: view.landlord.currency })
    : null;
  const inv = s.invoice;
  return (
    <div className="card portal-lease" style={{ ["--pass" as string]: l.pass_colour ?? "var(--accent)" }}>
      <div className="portal-band"><Jaali className="pass-art" /><div><span className="eyebrow light">{l.property}</span><h2>{l.unit}</h2></div><Pill status={s.status} /></div>
      <div className="tiles three">
        <div className="tile"><span className="eyebrow">{periodLabel(period)}</span><span className="mono big">{money(s.due)}</span><small className="muted">Due {dateLabel(s.dueDate, { day: "numeric", month: "short" })}</small></div>
        <div className="tile"><span className="eyebrow">Paid</span><span className="mono big">{money(s.paid)}</span></div>
        <div className="tile"><span className="eyebrow">Balance</span><span className={`mono big ${s.balance > 0 ? "neg" : "pos"}`}>{money(s.balance)}</span></div>
      </div>
      {inv && (
        <dl className="kv">
          <dt>Rent</dt><dd>{money(inv.rent)}</dd>
          {Number(inv.utilities) > 0 && <><dt>Utilities</dt><dd>{money(inv.utilities)}</dd></>}
          {Number(inv.late_fee) > 0 && <><dt>Late fee</dt><dd>{money(inv.late_fee)}</dd></>}
          {Number(inv.other) > 0 && <><dt>Other</dt><dd>{money(inv.other)}</dd></>}
          {Number(inv.carried_forward) !== 0 && <><dt>Carried forward</dt><dd>{money(inv.carried_forward)}</dd></>}
          <dt className="total">Total · {inv.invoice_no}</dt><dd className="total">{money(inv.total)}</dd>
        </dl>
      )}
      {pay && (
        <div className="portal-pay">
          <QR value={pay} size={120} />
          <div className="stack-sm">
            <strong>Pay {money(s.balance)} by UPI</strong>
            <span className="small muted">Scan with any UPI app, or tap below on your phone. Your landlord confirms it and issues a receipt.</span>
            <span className="small mono">{upi}</span>
            <a className="btn primary" href={pay}><IndianRupee size={16} /> Open UPI app</a>
          </div>
        </div>
      )}
      <p className="tiny muted">Rent {money(l.rent)} a month · due on day {l.due_day} · deposit {money(l.deposit)} · since {dateLabel(l.start_date)}{l.end_date ? ` · ends ${dateLabel(l.end_date)}` : ""}</p>
    </div>
  );
}

const REQ_ICON = { open: CircleDot, in_progress: Clock3, done: CheckCircle2 } as const;
const REQ_LABEL = { open: "Received", in_progress: "In progress", done: "Resolved" } as const;

function Requests({ view, token, reload, canRaise }: { view: PortalView; token: string; reload: () => Promise<void>; canRaise: boolean }) {
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (title.trim().length < 3) return setMsg({ ok: false, text: "Please describe the issue in a few words." });
    setBusy(true);
    const { error } = await supabase.rpc("tenant_raise_request", { p_token: token, p_title: title.trim(), p_details: details.trim() || null });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: errorMessage(error) });
    setTitle(""); setDetails("");
    setMsg({ ok: true, text: "Sent. Your landlord has been notified in Aangan." });
    await reload();
  }

  return (
    <div className="card">
      <div className="card-head"><h2><Hammer size={18} /> Maintenance requests</h2></div>
      {view.requests.length > 0 && (
        <ul className="list">
          {view.requests.map((r, i) => {
            const Icon = REQ_ICON[r.status];
            return (
              <li key={i} className="list-row">
                <Icon size={18} className={`req-${r.status}`} aria-hidden />
                <div className="grow"><strong>{r.title}</strong>{r.details && <small className="muted">{r.details}</small>}</div>
                <span className="small muted nowrap">{REQ_LABEL[r.status]} · {dateLabel(r.created_at, { day: "numeric", month: "short" })}</span>
              </li>
            );
          })}
        </ul>
      )}
      {canRaise && (
        <form className="form" onSubmit={submit}>
          <Field label="What needs fixing?"><input value={title} maxLength={140} onChange={(e) => { setTitle(e.target.value); setMsg(null); }} placeholder="e.g. Kitchen tap is leaking" /></Field>
          <Field label="Details (optional)" hint="When it started, where exactly, best time to visit."><textarea rows={3} maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} /></Field>
          {msg && <p className={msg.ok ? "form-info" : "form-error"} role="status">{msg.text}</p>}
          <button className="btn primary" disabled={busy}>{busy ? "Sending…" : "Send request"}</button>
        </form>
      )}
    </div>
  );
}
