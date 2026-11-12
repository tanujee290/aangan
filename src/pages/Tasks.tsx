import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Check, Pencil, Trash2 } from "lucide-react";
import { useLive } from "../state/data";
import { useNotify } from "../state/notify";
import { supabase, errorMessage } from "../lib/supabase";
import { currentPeriod, dateLabel, money, periodLabel, shiftPeriod } from "../lib/format";
import type { Task, TaskStatus } from "../lib/types";
import { Empty, Segmented, SheetIf } from "../components/ui";
import { TaskForm } from "../components/forms";
import type { ShellCtx } from "../components/shell";

const NEXT: Record<TaskStatus, TaskStatus> = { open: "in_progress", in_progress: "done", done: "open" };
const STATUS_TEXT: Record<TaskStatus, string> = { open: "Open", in_progress: "In progress", done: "Done" };

export default function TasksPage() {
  const live = useLive();
  const notify = useNotify();
  const { openAdd } = useOutletContext<ShellCtx>();
  const [tab, setTab] = useState<"tasks" | "expenses">("tasks");
  const [filter, setFilter] = useState<TaskStatus | "all">("all");
  const [edit, setEdit] = useState<Task | null>(null);
  const [period, setPeriod] = useState(currentPeriod());
  const propName = (id: string | null) => (id ? live.properties.find((p) => p.id === id)?.name ?? "" : "General");

  async function mutate(p: PromiseLike<{ error: unknown }>, msg: string) {
    const { error } = await p;
    if (error) return notify(errorMessage(error));
    await live.refresh();
    notify(msg);
  }

  const tasks = live.tasks.filter((t) => filter === "all" || t.status === filter);
  const expenses = live.expenses.filter((e) => e.spent_on.startsWith(period));
  const spent = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const rentIn = live.payments.filter((p) => p.paid_at.slice(0, 7) === period).reduce((s, p) => s + Number(p.amount), 0);
  const byCat = Object.entries(expenses.reduce<Record<string, number>>((m, e) => ({ ...m, [e.category]: (m[e.category] ?? 0) + Number(e.amount) }), {}))
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="display">Tasks</h1>
        <Segmented label="Tasks or expenses" value={tab} onChange={setTab} options={[
          { value: "tasks", label: "Maintenance" },
          { value: "expenses", label: "Expenses" },
        ]} />
      </div>

      {tab === "tasks" ? (
        <div className="card">
          <div className="card-head">
            <div className="chips">
              {(["all", "open", "in_progress", "done"] as const).map((f) => (
                <button key={f} className={`chip ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)}>{f === "all" ? "All" : STATUS_TEXT[f]}</button>
              ))}
            </div>
            <button className="btn small primary" onClick={() => openAdd("task")}>New task</button>
          </div>
          {tasks.length === 0 ? <Empty title="No tasks here">Log repairs and upkeep so nothing slips.</Empty> : (
            <ul className="list">
              {tasks.map((t) => (
                <li key={t.id} className={`list-row ${t.status === "done" ? "done" : ""}`}>
                  <button className={`check ${t.status}`} title={`Mark ${STATUS_TEXT[NEXT[t.status]]}`}
                    onClick={() => mutate(supabase.from("tasks").update({ status: NEXT[t.status] }).eq("id", t.id), `Marked ${STATUS_TEXT[NEXT[t.status]].toLowerCase()}`)}>
                    {t.status === "done" ? <Check size={14} /> : t.status === "in_progress" ? <span className="half" /> : null}
                  </button>
                  <div className="grow">
                    <strong>{t.title}</strong>
                    <small className="muted">{propName(t.property_id)}{t.vendor ? ` · ${t.vendor}` : ""} · {dateLabel(t.created_at, { day: "numeric", month: "short" })}</small>
                  </div>
                  <span className={`prio prio-${t.priority}`}>{t.priority}</span>
                  <span className="small muted hide-sm">{STATUS_TEXT[t.status]}</span>
                  <button className="icon-btn" onClick={() => setEdit(t)} aria-label="Edit"><Pencil size={15} /></button>
                  <button className="icon-btn" aria-label="Delete" onClick={() => confirm("Delete this task?") && mutate(supabase.from("tasks").delete().eq("id", t.id), "Task deleted")}><Trash2 size={15} /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          <div className="row between wrap gap">
            <div className="month-switch">
              <button onClick={() => setPeriod(shiftPeriod(period, -1))} aria-label="Previous month"><span aria-hidden="true">‹</span></button>
              <span>{periodLabel(period)}</span>
              <button onClick={() => setPeriod(shiftPeriod(period, 1))} aria-label="Next month"><span aria-hidden="true">›</span></button>
            </div>
            <button className="btn small primary" onClick={() => openAdd("expense")}>Log expense</button>
          </div>
          <div className="tiles three">
            <div className="tile"><span className="eyebrow">Rent recorded</span><span className="mono big">{money(rentIn)}</span></div>
            <div className="tile"><span className="eyebrow">Spent</span><span className="mono big">{money(spent)}</span></div>
            <div className="tile"><span className="eyebrow">Net</span><span className={`mono big ${rentIn - spent < 0 ? "neg" : ""}`}>{money(rentIn - spent)}</span></div>
          </div>
          <section className="two-col">
            <div className="card">
              <div className="card-head"><h2>Expenses</h2></div>
              {expenses.length === 0 ? <Empty title="Nothing spent">No expenses logged for {periodLabel(period)}.</Empty> : (
                <ul className="list">
                  {expenses.map((e) => (
                    <li key={e.id} className="list-row">
                      <div className="grow"><strong>{e.category}</strong><small className="muted">{propName(e.property_id)} · {dateLabel(e.spent_on, { day: "numeric", month: "short" })}{e.note ? ` · ${e.note}` : ""}</small></div>
                      <span className="mono">{money(e.amount)}</span>
                      <button className="icon-btn" aria-label="Delete" onClick={() => confirm("Delete this expense?") && mutate(supabase.from("expenses").delete().eq("id", e.id), "Expense deleted")}><Trash2 size={15} /></button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="card">
              <div className="card-head"><h2>By category</h2></div>
              {byCat.length === 0 ? <p className="muted small">—</p> : (
                <ul className="cat-bars">
                  {byCat.map(([c, v]) => (
                    <li key={c}><div className="row between"><span>{c}</span><span className="mono">{money(v)}</span></div><div className="progress thin"><div style={{ width: `${(v / byCat[0][1]) * 100}%` }} /></div></li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      )}
      <SheetIf open={edit} title="Edit task" onClose={() => setEdit(null)}>
        {edit && <TaskForm task={edit} onDone={() => setEdit(null)} />}
      </SheetIf>
    </div>
  );
}
