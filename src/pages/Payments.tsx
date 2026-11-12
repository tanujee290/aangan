import { useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { MessageCircle, ReceiptText } from "lucide-react";
import { useLive } from "../state/data";
import { currentPeriod, dateLabel, METHOD_LABEL, money, periodLabel, shiftPeriod, waLink } from "../lib/format";
import { rentRows, type LeaseRow } from "../lib/rent";
import { reminderText } from "../lib/reminders";
import { Empty, Pill, SheetIf } from "../components/ui";
import { PaymentForm } from "../components/forms";
import type { ShellCtx } from "../components/shell";

export default function PaymentsPage() {
  const live = useLive();
  const { openAdd } = useOutletContext<ShellCtx>();
  const [period, setPeriod] = useState(currentPeriod());
  const rows = useMemo(() => rentRows(period, live), [period, live]);
  const [recordFor, setRecordFor] = useState<LeaseRow | null>(null);
  const expected = rows.reduce((s, r) => s + r.rent, 0);
  const collected = rows.reduce((s, r) => s + Math.min(r.paid, r.rent), 0);
  const awaiting = rows.filter((r) => r.status !== "paid");
  const receipts = live.payments.filter((p) => p.period === period);
  const leaseInfo = (id: string) => {
    const l = live.leases.find((x) => x.id === id);
    const t = l && live.tenants.find((x) => x.id === l.tenant_id);
    const u = l && live.units.find((x) => x.id === l.unit_id);
    return { t, u };
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="display">Payments</h1>
        <div className="month-switch">
          <button onClick={() => setPeriod(shiftPeriod(period, -1))} aria-label="Previous month">‹</button>
          <span>{periodLabel(period)}</span>
          <button onClick={() => setPeriod(shiftPeriod(period, 1))} aria-label="Next month">›</button>
        </div>
      </div>

      <div className="tiles three">
        <div className="tile"><span className="eyebrow">Collected</span><span className="mono big">{money(collected)}</span></div>
        <div className="tile"><span className="eyebrow">Outstanding</span><span className="mono big">{money(expected - collected)}</span></div>
        <div className="tile"><span className="eyebrow">Receipts</span><span className="mono big">{receipts.length}</span></div>
      </div>
      <div className="progress" aria-hidden><div style={{ width: `${expected ? (collected / expected) * 100 : 0}%` }} /></div>

      <section className="two-col">
        <div className="card">
          <div className="card-head"><h2>Awaiting rent</h2></div>
          {awaiting.length === 0 ? <Empty title={rows.length ? "All collected" : "No active leases this month"} /> : (
            <ul className="list">
              {awaiting.map((r) => (
                <li key={r.lease.id} className="list-row">
                  <div className="grow"><strong>{r.tenant.name}</strong><small className="muted">{r.unit.label} · due {dateLabel(r.dueDate, { day: "numeric", month: "short" })}</small></div>
                  <span className="mono">{money(r.balance)}</span>
                  <Pill status={r.status} />
                  <a className="icon-btn" title="WhatsApp reminder" href={waLink(r.tenant.phone_whatsapp, reminderText(r, live.workspace!))} target="_blank" rel="noreferrer"><MessageCircle size={16} /></a>
                  <button className="btn small" onClick={() => setRecordFor(r)}>Record</button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <div className="card-head"><h2><ReceiptText size={18} /> Receipts</h2><button className="btn ghost small" onClick={() => openAdd("payment")}>New</button></div>
          {receipts.length === 0 ? <p className="muted small">No receipts for {periodLabel(period)}.</p> : (
            <ul className="timeline">
              {receipts.map((p) => {
                const { t, u } = leaseInfo(p.lease_id);
                return (
                  <li key={p.id}>
                    <Link to={`/app/payments/${p.id}`} className="list-row">
                      <div className="grow"><strong>{t?.name ?? "Tenant"}</strong><small className="muted">{p.receipt_no} · {u?.label} · {METHOD_LABEL[p.method]} · {dateLabel(p.paid_at, { day: "numeric", month: "short" })}</small></div>
                      <span className="mono">{money(p.amount)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
      <SheetIf open={recordFor} title="Record a payment" onClose={() => setRecordFor(null)}>
        {recordFor && <PaymentForm leaseId={recordFor.lease.id} period={period} onDone={() => setRecordFor(null)} />}
      </SheetIf>
    </div>
  );
}
