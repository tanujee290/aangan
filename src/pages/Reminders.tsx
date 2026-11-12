import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BellRing, Check, MessageCircle, RefreshCw, RotateCcw, Send, SkipForward } from "lucide-react";
import { useCanWrite, useData, useLive } from "../state/data";
import { useNotify } from "../state/notify";
import { supabase, errorMessage } from "../lib/supabase";
import { currentPeriod, dateLabel, money, todayISO, tone, waLink } from "../lib/format";
import { rentRows, type LeaseRow } from "../lib/rent";
import { reminderText } from "../lib/reminders";
import type { Reminder, WorkspaceV2 } from "../lib/types";
import { CountUp, Empty, NeedsSchema, SheetIf, Segmented } from "../components/ui";

type Tab = "pending" | "sent" | "skipped";
const KIND_LABEL: Record<Reminder["kind"], string> = { upcoming: "Upcoming", due: "Due today", overdue: "Overdue" };
const KIND_PILL: Record<Reminder["kind"], string> = { upcoming: "pill-due", due: "pill-partial", overdue: "pill-overdue" };

interface Item { reminder: Reminder; row: LeaseRow }

export default function RemindersPage() {
  const d = useData();
  const live = useLive();
  const canWrite = useCanWrite();
  const notify = useNotify();
  const [tab, setTab] = useState<Tab>("pending");
  const [queue, setQueue] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const ws = d.workspace as WorkspaceV2;

  const rows = useMemo(() => rentRows(currentPeriod(), live), [live]);
  const items: Item[] = useMemo(() => d.reminders
    .map((r) => {
      const row = rows.find((x) => x.lease.id === r.lease_id);
      return row ? { reminder: r, row: { ...row, balance: Number(r.amount) || row.balance } } : null;
    })
    .filter((x): x is Item => Boolean(x))
    .sort((a, b) => order(a.reminder) - order(b.reminder) || Number(b.reminder.amount) - Number(a.reminder.amount)), [d.reminders, rows]);

  if (!d.v2) return <div className="page"><h1 className="display">Reminders</h1><NeedsSchema feature="Daily reminder list" /></div>;

  const list = items.filter((i) => i.reminder.status === tab);
  const pending = items.filter((i) => i.reminder.status === "pending");
  const owed = pending.reduce((s, i) => s + Number(i.reminder.amount), 0);
  const count = (t: Tab) => items.filter((i) => i.reminder.status === t).length;

  async function mark(r: Reminder, status: Reminder["status"], quiet = false) {
    const { error } = await supabase.from("reminders").update({ status, acted_at: status === "pending" ? null : new Date().toISOString() }).eq("id", r.id);
    if (error) { notify(errorMessage(error)); return false; }
    await d.refresh();
    if (!quiet) notify(status === "sent" ? "Marked as sent" : status === "skipped" ? "Skipped for today" : "Moved back to pending");
    return true;
  }

  async function rebuild() {
    setBusy(true);
    const { data, error } = await supabase.rpc("my_reminders", { p_today: todayISO() });
    setBusy(false);
    if (error) return notify(errorMessage(error));
    await d.refresh();
    notify(`Today's list is up to date${typeof data === "number" ? ` · ${data} reminder${data === 1 ? "" : "s"}` : ""}`);
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">{dateLabel(todayISO(), { weekday: "long", day: "numeric", month: "long" })}</span>
          <h1 className="display">Reminders</h1>
        </div>
        <div className="row gap-sm">
          {canWrite && <button className="btn ghost small" onClick={rebuild} disabled={busy}><RefreshCw size={14} className={busy ? "spin" : ""} /> Refresh list</button>}
          {canWrite && pending.length > 0 && <button className="btn primary small" onClick={() => setQueue(0)}><Send size={14} /> Start reminder round</button>}
        </div>
      </div>
      <p className="page-sub small">
        Each morning Aangan builds a list of tenants with rent owing, starting {ws.remind_before_days ?? 3} day{ws.remind_before_days === 1 ? "" : "s"} before the due date.
        Nothing is sent automatically: each draft opens in WhatsApp for you to review and send yourself. Change the timing in <Link to="/app/settings" className="link">Settings</Link>.
      </p>

      <div className="tiles three">
        <div className="tile"><span className="eyebrow">To send today</span><span className="mono big"><CountUp value={pending.length} format={String} /></span></div>
        <div className="tile"><span className="eyebrow">Owed by them</span><span className="mono big"><CountUp value={owed} format={(n) => money(n)} /></span></div>
        <div className="tile"><span className="eyebrow">Sent today</span><span className="mono big"><CountUp value={count("sent")} format={String} /></span></div>
      </div>

      <div className="card">
        <div className="card-head">
          <Segmented label="Reminder status" value={tab} onChange={setTab} options={[
            { value: "pending", label: `Pending · ${count("pending")}` },
            { value: "sent", label: `Sent · ${count("sent")}` },
            { value: "skipped", label: `Skipped · ${count("skipped")}` },
          ]} />
        </div>
        {list.length === 0 ? (
          <Empty icon={<BellRing />} title={tab === "pending" ? "Nothing to chase today" : `No ${tab} reminders`}>
            {tab === "pending" && <p>Everyone with rent coming up or overdue has been reminded, or has paid.</p>}
          </Empty>
        ) : (
          <ul className="list">
            {list.map(({ reminder: r, row }) => (
              <li key={r.id} className="list-row">
                <div className="avatar" data-tone={tone(row.tenant.name)}>{row.tenant.name.slice(0, 1)}</div>
                <div className="grow">
                  <Link to={`/app/tenants/${row.tenant.id}`}><strong>{row.tenant.name}</strong></Link>
                  <small className="muted">{row.property.name} · {row.unit.label} · due {dateLabel(row.dueDate, { day: "numeric", month: "short" })}{row.daysLate > 0 ? ` · ${row.daysLate}d late` : ""}</small>
                </div>
                <span className="mono">{money(r.amount)}</span>
                <span className={`pill ${KIND_PILL[r.kind]}`}>{KIND_LABEL[r.kind]}</span>
                {canWrite && (
                  <div className="row gap-sm">
                    {r.status === "pending" ? (
                      <>
                        <button className="icon-btn" title="Skip for today" aria-label="Skip" onClick={() => mark(r, "skipped")}><SkipForward size={16} /></button>
                        <button className="btn small primary" onClick={() => setQueue(pending.findIndex((p) => p.reminder.id === r.id))}><MessageCircle size={14} /> Review</button>
                      </>
                    ) : (
                      <button className="btn small ghost" onClick={() => mark(r, "pending")}><RotateCcw size={14} /> Undo</button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <SheetIf open={queue !== null && pending[queue]} title={queue !== null ? `Reminder ${queue + 1} of ${pending.length}` : ""} onClose={() => setQueue(null)}>
        {queue !== null && pending[queue] && (
          <ReviewStep key={pending[queue].reminder.id} item={pending[queue]} ws={ws} last={queue + 1 >= pending.length}
            onDone={async (status) => {
              const more = queue + 1 < pending.length;
              if (!(await mark(pending[queue].reminder, status, true))) return;
              // The marked item leaves the pending list, so the same index now points at the next one.
              setQueue(more ? queue : null);
              if (!more) notify("Reminder round finished");
            }} />
        )}
      </SheetIf>
    </div>
  );
}

function order(r: Reminder) {
  return { pending: 0, sent: 1, skipped: 2 }[r.status] * 10 + { overdue: 0, due: 1, upcoming: 2 }[r.kind];
}

function ReviewStep({ item, ws, last, onDone }: { item: Item; ws: WorkspaceV2; last: boolean; onDone: (s: "sent" | "skipped") => void }) {
  const [text, setText] = useState(() => reminderText(item.row, ws));
  const { row, reminder } = item;
  return (
    <div className="form">
      <div className="row between">
        <div><strong>{row.tenant.name}</strong><div className="muted small">{row.property.name} · {row.unit.label} · {money(reminder.amount)}</div></div>
        <span className={`pill ${KIND_PILL[reminder.kind]}`}>{KIND_LABEL[reminder.kind]}</span>
      </div>
      {!row.tenant.phone_whatsapp && <p className="form-error">No WhatsApp number saved. WhatsApp opens so you can pick the contact.</p>}
      <label className="field"><span className="field-label">Message (edit before sending)</span><textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} /></label>
      <div className="row gap">
        <button className="btn ghost" onClick={() => onDone("skipped")}><SkipForward size={15} /> Skip</button>
        <a className="btn primary grow" href={waLink(row.tenant.phone_whatsapp, text)} target="_blank" rel="noreferrer" onClick={() => setTimeout(() => onDone("sent"), 300)}>
          <MessageCircle size={16} /> Open WhatsApp{last ? "" : " & next"}
        </a>
      </div>
      <button className="link small" onClick={() => onDone("sent")}><Check size={13} /> Already sent another way</button>
    </div>
  );
}
