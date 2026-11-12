import { useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { AlertCircle, CalendarClock, IndianRupee, MessageCircle, Send, Wrench } from "lucide-react";
import { useLive } from "../state/data";
import { currentPeriod, dateLabel, initials, money, periodLabel, shiftPeriod, todayISO, tone, waLink } from "../lib/format";
import { daysUntil, rentRows, type LeaseRow } from "../lib/rent";
import { reminderText } from "../lib/reminders";
import { Empty, Pill, Ring, SheetIf, SwipeRow } from "../components/ui";
import { PaymentForm } from "../components/forms";
import type { ShellCtx } from "../components/shell";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function HomePage() {
  const live = useLive();
  const { openAdd } = useOutletContext<ShellCtx>();
  const ws = live.workspace!;
  const period = currentPeriod();
  const rows = useMemo(() => rentRows(period, live), [period, live]);
  const expected = rows.reduce((s, r) => s + r.rent, 0);
  const collected = rows.reduce((s, r) => s + Math.min(r.paid, r.rent), 0);
  const spent = live.expenses.filter((e) => e.spent_on.startsWith(period)).reduce((s, e) => s + Number(e.amount), 0);
  const receivedThisMonth = live.payments.filter((p) => p.paid_at.slice(0, 7) === period).reduce((s, p) => s + Number(p.amount), 0);
  const openTasks = live.tasks.filter((t) => t.status !== "done");
  const today = todayISO();
  const ending = live.leases
    .filter((l) => l.status === "active" && l.end_date && daysUntil(l.end_date, today) <= 60 && daysUntil(l.end_date, today) >= -30)
    .sort((a, b) => a.end_date!.localeCompare(b.end_date!));
  const attention = rows.filter((r) => r.status !== "paid");
  const [queue, setQueue] = useState<number | null>(null);
  const [recordFor, setRecordFor] = useState<LeaseRow | null>(null);

  const months = Array.from({ length: 6 }, (_, i) => shiftPeriod(period, i - 5));
  const flow = months.map((m) => ({
    m,
    in: live.payments.filter((p) => p.paid_at.slice(0, 7) === m).reduce((s, p) => s + Number(p.amount), 0),
    out: live.expenses.filter((e) => e.spent_on.startsWith(m)).reduce((s, e) => s + Number(e.amount), 0),
  }));
  const peak = Math.max(1, ...flow.flatMap((f) => [f.in, f.out]));

  if (live.properties.length === 0) {
    return (
      <div className="page">
        <h1 className="display">{greeting()}.</h1>
        <div className="card onboarding-card">
          <Empty title="Let's set up your first property">
            <p>Add a property and its units, then a tenant with their rent and due day. Aangan works out who has paid from there.</p>
            <div className="row gap center">
              <button className="btn primary" onClick={() => openAdd("property")}>Add a property</button>
            </div>
          </Empty>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">{periodLabel(period)}</span>
          <h1 className="display">{greeting()}.</h1>
        </div>
      </div>

      <section className="home-grid">
        <div className="card ring-card">
          <Ring value={expected ? collected / expected : 0}>
            <span className="eyebrow">Collected</span>
            <strong className="mono">{expected ? Math.round((collected / expected) * 100) : 0}%</strong>
          </Ring>
          <div className="ring-legend">
            <div><span className="eyebrow">Collected</span><span className="mono big">{money(collected)}</span></div>
            <div><span className="eyebrow">Outstanding</span><span className="mono big">{money(expected - collected)}</span></div>
            <div><span className="eyebrow">Expected</span><span className="mono">{money(expected)}</span></div>
          </div>
        </div>

        <div className="tiles">
          <div className="tile"><span className="eyebrow">Spent this month</span><span className="mono big">{money(spent)}</span></div>
          <div className="tile"><span className="eyebrow">Net this month</span><span className={`mono big ${receivedThisMonth - spent < 0 ? "neg" : ""}`}>{money(receivedThisMonth - spent)}</span><small className="muted">Rent minus expenses</small></div>
          <Link to="/app/tasks" className="tile"><span className="eyebrow">Open tasks</span><span className="mono big">{openTasks.length}</span><small className="muted">{openTasks.filter((t) => t.priority === "urgent" || t.priority === "high").length} high priority</small></Link>
          <div className="tile"><span className="eyebrow">Leases ending</span><span className="mono big">{ending.length}</span><small className="muted">Next 60 days</small></div>
        </div>
      </section>

      <section className="two-col">
        <div className="card">
          <div className="card-head">
            <h2><AlertCircle size={18} /> Needs attention</h2>
            {attention.length > 0 && <button className="btn ghost small" onClick={() => setQueue(0)}><Send size={14} /> Reminder round</button>}
          </div>
          {attention.length > 0 && <p className="swipe-tip tiny muted show-sm">Swipe a row for Record and Remind</p>}
          {attention.length === 0 ? (
            <Empty title="Everyone's paid this month">Nothing outstanding for {periodLabel(period)}.</Empty>
          ) : (
            <ul className="list swipe-list">
              {attention.map((r) => (
                <SwipeRow key={r.lease.id} actions={[
                  { label: "Record", icon: <IndianRupee size={20} />, tone: "ok", onAction: () => setRecordFor(r) },
                  { label: "Remind", icon: <MessageCircle size={20} />, tone: "accent", onAction: () => {}, href: waLink(r.tenant.phone_whatsapp, reminderText(r, ws)) },
                ]}>
                <div className="list-row">
                  <div className="avatar" data-tone={tone(r.tenant.name)} aria-hidden>{initials(r.tenant.name)}</div>
                  <div className="grow">
                    <Link to={`/app/tenants/${r.tenant.id}`}><strong>{r.tenant.name}</strong></Link>
                    <small className="muted">{r.property.name} · {r.unit.label} · {r.status === "overdue" ? `${r.daysLate} day${r.daysLate === 1 ? "" : "s"} late` : `due ${dateLabel(r.dueDate, { day: "numeric", month: "short" })}`}</small>
                  </div>
                  <span className="mono">{money(r.balance)}</span>
                  <Pill status={r.status} />
                  <div className="row gap-sm">
                    <a className="icon-btn" title="WhatsApp reminder" href={waLink(r.tenant.phone_whatsapp, reminderText(r, ws))} target="_blank" rel="noreferrer"><MessageCircle size={16} /></a>
                    <button className="btn small" onClick={() => setRecordFor(r)}>Record</button>
                  </div>
                </div>
                </SwipeRow>
              ))}
            </ul>
          )}
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-head"><h2>Cash flow</h2><span className="legend"><i className="sw in" /> Rent in <i className="sw out" /> Spent</span></div>
            <div className="bars" role="img" aria-label="Rent received and expenses for the last six months">
              {flow.map((f) => (
                <div className="bar-col" key={f.m} title={`${periodLabel(f.m)}: in ${money(f.in)}, spent ${money(f.out)}`}>
                  <div className="bar-pair">
                    <div className="bar in" style={{ height: `${(f.in / peak) * 100}%` }} />
                    <div className="bar out" style={{ height: `${(f.out / peak) * 100}%` }} />
                  </div>
                  <span className="small muted">{periodLabel(f.m, true).split(" ")[0]}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2><CalendarClock size={18} /> Lease renewals</h2></div>
            {ending.length === 0 ? <p className="muted small">No leases end in the next 60 days.</p> : (
              <ul className="list">
                {ending.map((l) => {
                  const t = live.tenants.find((x) => x.id === l.tenant_id);
                  const u = live.units.find((x) => x.id === l.unit_id);
                  const d = daysUntil(l.end_date!, today);
                  return (
                    <li key={l.id} className="list-row">
                      <div className="grow"><Link to={`/app/tenants/${l.tenant_id}`}><strong>{t?.name}</strong></Link><small className="muted">{u?.label}</small></div>
                      <span className={`small ${d < 0 ? "neg" : ""}`}>{d < 0 ? `ended ${-d}d ago` : d === 0 ? "ends today" : `in ${d} days`}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {openTasks.length > 0 && (
            <div className="card">
              <div className="card-head"><h2><Wrench size={18} /> Open tasks</h2><Link to="/app/tasks" className="small">All</Link></div>
              <ul className="list">
                {openTasks.slice(0, 4).map((t) => (
                  <li key={t.id} className="list-row"><span className={`prio-dot prio-${t.priority}`} /><span className="grow">{t.title}</span><small className="muted">{t.status === "in_progress" ? "In progress" : "Open"}</small></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <SheetIf open={queue !== null && attention[queue]} title={queue !== null ? `Reminder ${queue + 1} of ${attention.length}` : ""} onClose={() => setQueue(null)}>
        {queue !== null && attention[queue] && (
          <ReminderStep key={attention[queue].lease.id} row={attention[queue]} ws={ws} onNext={() => setQueue(queue + 1 < attention.length ? queue + 1 : null)} last={queue + 1 >= attention.length} />
        )}
      </SheetIf>
      <SheetIf open={recordFor} title="Record a payment" onClose={() => setRecordFor(null)}>
        {recordFor && <PaymentForm leaseId={recordFor.lease.id} period={period} onDone={() => setRecordFor(null)} />}
      </SheetIf>
    </div>
  );
}

function ReminderStep({ row, ws, onNext, last }: { row: LeaseRow; ws: NonNullable<ReturnType<typeof useLive>["workspace"]>; onNext: () => void; last: boolean }) {
  const [text, setText] = useState(reminderText(row, ws));
  return (
    <div className="form">
      <div className="row between">
        <div><strong>{row.tenant.name}</strong><div className="muted small">{row.property.name} · {row.unit.label}</div></div>
        <Pill status={row.status} />
      </div>
      {!row.tenant.phone_whatsapp && <p className="form-error">No WhatsApp number saved. WhatsApp opens so you can pick the contact.</p>}
      <label className="field"><span className="field-label">Message (edit before sending)</span><textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} /></label>
      <div className="row gap">
        <button className="btn ghost" onClick={onNext}>{last ? "Finish" : "Skip"}</button>
        <a className="btn primary grow" href={waLink(row.tenant.phone_whatsapp, text)} target="_blank" rel="noreferrer" onClick={() => setTimeout(onNext, 300)}>
          <MessageCircle size={16} /> Open WhatsApp
        </a>
      </div>
    </div>
  );
}
