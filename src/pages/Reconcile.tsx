import { useMemo, useRef, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowDownLeft, ArrowUpRight, Check, CheckCheck, EyeOff, FileSpreadsheet, Landmark, Link2, Sparkles, Trash2, Undo2, Upload,
} from "lucide-react";
import { useCanWrite, useData } from "../state/data";
import { useNotify } from "../state/notify";
import { supabase, errorMessage, demoMode } from "../lib/supabase";
import { dateLabel, money, periodLabel } from "../lib/format";
import { leaseLookup } from "../lib/reports";
import {
  aiSuggest, confidence, parseStatement, sampleStatement, suggest, takenIds, type ParsedLine, type Suggestion,
} from "../lib/reconcile";
import type { BankLine } from "../lib/types";
import { CountUp, Empty, NeedsSchema, Segmented, SheetIf, SPRING } from "../components/ui";
import { ExpenseForm, PaymentForm } from "../components/forms";

type Filter = "review" | "matched" | "ignored" | "all";

function toRow(l: ParsedLine, statement: string): BankLine {
  return {
    id: `local-${l.fingerprint}`, statement, txn_date: l.txn_date, description: l.description, reference: l.reference,
    amount: l.amount.toFixed(2), fingerprint: l.fingerprint, status: "unmatched", payment_id: null, expense_id: null,
    matched_by: null, matched_at: null, created_at: new Date().toISOString(),
  };
}

export default function ReconcilePage() {
  const d = useData();
  const canWrite = useCanWrite();
  const notify = useNotify();
  const reduce = useReducedMotion();
  const lines = d.bankLines;
  const [filter, setFilter] = useState<Filter>("review");
  const [busy, setBusy] = useState<string | null>(null);
  const [ai, setAi] = useState<Map<string, Suggestion>>(new Map());
  const [recordFor, setRecordFor] = useState<{ line: BankLine; s?: Extract<Suggestion, { kind: "record" }> } | null>(null);
  const [expenseFor, setExpenseFor] = useState<BankLine | null>(null);
  const who = useMemo(() => leaseLookup(d), [d]);

  const taken = useMemo(() => takenIds(lines), [lines]);
  const suggestions = useMemo(() => {
    const m = new Map<string, Suggestion[]>();
    for (const l of lines) if (l.status === "unmatched") m.set(l.id, suggest(l, d, taken));
    return m;
  }, [lines, d, taken]);
  const best = (l: BankLine): Suggestion | undefined => {
    const rule = suggestions.get(l.id)?.[0];
    const a = ai.get(l.id);
    if (a && (!rule || a.score > rule.score)) return a;
    return rule;
  };

  if (!d.v2 || !d.recon) return <div className="page"><PageHead /><NeedsSchema feature="Bank reconciliation" /></div>;

  const credits = lines.filter((l) => Number(l.amount) > 0);
  const matched = lines.filter((l) => l.status === "matched");
  const review = lines.filter((l) => l.status === "unmatched");
  const unmatchedIn = review.filter((l) => Number(l.amount) > 0).reduce((s, l) => s + Number(l.amount), 0);
  const ready = review.map((l) => [l, best(l)] as const).filter(([, s]) => s && s.kind !== "record" && confidence(s.score) === "high");
  const statements = [...lines.reduce((m, l) => m.set(l.statement, (m.get(l.statement) ?? 0) + 1), new Map<string, number>())];
  const shown = (filter === "review" ? review : filter === "matched" ? matched : filter === "ignored" ? lines.filter((l) => l.status === "ignored") : lines)
    .slice().sort((a, b) => b.txn_date.localeCompare(a.txn_date) || Number(b.amount) - Number(a.amount));

  /* ----------------------------------------------------------- mutations */

  async function patch(updates: { id: string; payment_id?: string | null; expense_id?: string | null; status?: BankLine["status"]; matched_by?: BankLine["matched_by"] }[]) {
    const results = await Promise.all(updates.map(({ id, ...u }) => supabase.from("bank_lines").update(u).eq("id", id)));
    const err = results.find((r) => r.error)?.error;
    await d.refresh();
    if (err) throw err;
  }

  async function run(key: string, fn: () => Promise<void>, ok?: string) {
    setBusy(key);
    try {
      await fn();
      if (ok) notify(ok);
    } catch (e) {
      notify(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function importText(text: string, name: string) {
    const parsed = parseStatement(text);
    if (parsed.error) return notify(parsed.error);
    const rows = parsed.lines.map((l) => toRow(l, name));
    await run("import", async () => {
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500).map(({ statement, txn_date, description, reference, amount, fingerprint }) => ({ statement, txn_date, description, reference, amount, fingerprint }));
        const { error } = await supabase.from("bank_lines").upsert(chunk, { onConflict: "workspace_id,fingerprint", ignoreDuplicates: true });
        if (error) throw error;
      }
      await d.refresh();
      notify(`Imported ${name}${parsed.skipped ? ` · skipped ${parsed.skipped} non-transaction rows` : ""}`);
    });
    setFilter("review");
  }

  function accept(l: BankLine, s: Suggestion) {
    if (s.kind === "record") return setRecordFor({ line: l, s });
    const by = s.by === "ai" ? "ai" : "manual";
    run(l.id, () => patch([s.kind === "payment" ? { id: l.id, payment_id: s.payment.id, matched_by: by } : { id: l.id, expense_id: s.expense.id, matched_by: by }]), "Matched");
  }

  function acceptReady() {
    run("bulk", () => patch(ready.map(([l, s]) => s!.kind === "payment"
      ? { id: l.id, payment_id: s!.payment.id, matched_by: "auto" as const }
      : { id: l.id, expense_id: (s as Extract<Suggestion, { kind: "expense" }>).expense.id, matched_by: "auto" as const })),
    `Matched ${ready.length} line${ready.length === 1 ? "" : "s"}`);
  }

  async function askAi() {
    const pending = review.filter((l) => !best(l) || confidence(best(l)!.score) === "low").slice(0, 60);
    if (pending.length === 0) return notify("Every line already has a suggestion");
    await run("ai", async () => {
      let auth: string | undefined;
      if (!demoMode) {
        const { data } = await supabase.auth.getSession();
        if (data.session) auth = `Bearer ${data.session.access_token}`;
      }
      const res = await aiSuggest(pending, d, taken, auth);
      setAi((cur) => new Map([...cur, ...res]));
      notify(res.size ? `The assistant suggested ${res.size} match${res.size === 1 ? "" : "es"}` : "The assistant found no confident matches");
    });
  }

  async function removeStatement(name: string) {
    if (!confirm(`Remove every line from “${name}”? Receipts and expenses stay as they are.`)) return;
    await run("remove", async () => {
      const { error } = await supabase.from("bank_lines").delete().eq("statement", name);
      await d.refresh();
      if (error) throw error;
    }, "Statement removed");
  }

  async function linkNew(line: BankLine, field: "payment_id" | "expense_id", id: string) {
    const { error } = await supabase.from("bank_lines").update({ [field]: id, matched_by: "manual" }).eq("id", line.id);
    if (error) throw error;
    await d.refresh();
  }

  /* --------------------------------------------------------------- view */

  return (
    <div className="page">
      <PageHead />

      {lines.length === 0 ? (
        <Uploader onText={importText} busy={busy === "import"} canWrite={canWrite} sample={() => importText(sampleStatement(d), "Sample statement.csv")} first />
      ) : (
        <>
          <div className="tiles">
            <div className="tile"><span className="eyebrow">Lines</span><span className="mono big"><CountUp value={lines.length} format={String} /></span><small className="muted">{credits.length} in · {lines.length - credits.length} out</small></div>
            <div className="tile"><span className="eyebrow">Matched</span><span className="mono big"><CountUp value={matched.length} format={String} /></span>
              <div className="progress thin"><div style={{ width: `${lines.length ? (matched.length / lines.length) * 100 : 0}%` }} /></div></div>
            <div className="tile"><span className="eyebrow">To review</span><span className="mono big"><CountUp value={review.length} format={String} /></span><small className="muted">{ready.length} ready to match</small></div>
            <div className="tile"><span className="eyebrow">Money in, unmatched</span><span className="mono big"><CountUp value={unmatchedIn} format={(n) => money(n)} /></span><small className="muted">Might be rent you haven't recorded</small></div>
          </div>

          <div className="row between wrap gap">
            <Segmented label="Show" value={filter} onChange={setFilter} options={[
              { value: "review", label: `To review${review.length ? ` · ${review.length}` : ""}` },
              { value: "matched", label: "Matched" },
              { value: "ignored", label: "Set aside" },
              { value: "all", label: "All" },
            ]} />
            {canWrite && (
              <div className="row gap-sm wrap">
                <button className="btn small" onClick={askAi} disabled={busy === "ai" || review.length === 0}>
                  <Sparkles size={15} /> {busy === "ai" ? "Thinking…" : "Ask AI for the rest"}
                </button>
                <button className="btn small primary" onClick={acceptReady} disabled={ready.length === 0 || busy === "bulk"}>
                  <CheckCheck size={15} /> Match {ready.length || ""} sure thing{ready.length === 1 ? "" : "s"}
                </button>
              </div>
            )}
          </div>

          <section className="recon-layout">
            <div className="card">
              {shown.length === 0 ? (
                <Empty icon={<Check size={22} />} title={filter === "review" ? "All caught up" : "Nothing here"}>
                  {filter === "review" ? "Every line on your statements is matched or set aside." : "Lines will show up here as you work through the statement."}
                </Empty>
              ) : (
                <ul className="list recon-list">
                  {shown.map((l, i) => (
                    <motion.li key={l.id} className={`recon-row ${l.status}`} layout={!reduce}
                      initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING, delay: Math.min(i, 12) * 0.015 }}>
                      <LineHead l={l} />
                      {l.status === "unmatched" && (
                        <Suggestions l={l} items={[...(ai.get(l.id) ? [ai.get(l.id)!] : []), ...(suggestions.get(l.id) ?? [])].slice(0, 3)} who={who}
                          canWrite={canWrite} busy={busy === l.id}
                          onAccept={(s) => accept(l, s)}
                          onRecord={() => setRecordFor({ line: l })}
                          onExpense={() => setExpenseFor(l)}
                          onIgnore={() => run(l.id, () => patch([{ id: l.id, status: "ignored" }]), "Set aside")} />
                      )}
                      {l.status === "matched" && (
                        <div className="recon-match">
                          <Link2 size={14} />
                          <span className="grow small">
                            {l.payment_id ? matchedPayment(l.payment_id) : l.expense_id ? matchedExpense(l.expense_id) : null}
                            {l.matched_by && <span className="muted"> · {l.matched_by === "ai" ? "suggested by AI" : l.matched_by === "auto" ? "auto-matched" : "matched by hand"}</span>}
                          </span>
                          {canWrite && <button className="btn small ghost" disabled={busy === l.id} onClick={() => run(l.id, () => patch([{ id: l.id, payment_id: null, expense_id: null, status: "unmatched" }]), "Unlinked")}><Undo2 size={14} /> Unlink</button>}
                        </div>
                      )}
                      {l.status === "ignored" && canWrite && (
                        <div className="recon-match">
                          <EyeOff size={14} /><span className="grow small muted">Set aside: not rent or an expense</span>
                          <button className="btn small ghost" disabled={busy === l.id} onClick={() => run(l.id, () => patch([{ id: l.id, status: "unmatched" }]))}><Undo2 size={14} /> Review again</button>
                        </div>
                      )}
                    </motion.li>
                  ))}
                </ul>
              )}
            </div>

            <aside className="stack">
              <Uploader onText={importText} busy={busy === "import"} canWrite={canWrite} sample={demoMode ? () => importText(sampleStatement(d), "Sample statement.csv") : undefined} />
              <div className="card">
                <div className="card-head"><h2>Statements</h2></div>
                <ul className="mini-list">
                  {statements.map(([name, count]) => (
                    <li key={name} className="row gap-sm">
                      <FileSpreadsheet size={16} className="muted" />
                      <span className="grow ellipsis small">{name}</span>
                      <span className="tiny muted nowrap">{count} lines</span>
                      {canWrite && <button className="icon-btn" aria-label={`Remove ${name}`} onClick={() => removeStatement(name)}><Trash2 size={14} /></button>}
                    </li>
                  ))}
                </ul>
              </div>
              <p className="tiny muted">Matching never changes receipts. Linking only records which bank line a receipt or expense belongs to, so your books and your bank agree.</p>
            </aside>
          </section>
        </>
      )}

      <SheetIf open={recordFor} title="Record this payment" onClose={() => setRecordFor(null)}>
        {recordFor && (
          <PaymentForm
            leaseId={recordFor.s?.row.lease.id}
            period={recordFor.s ? recordFor.s.row.dueDate.slice(0, 7) : recordFor.line.txn_date.slice(0, 7)}
            preset={{ amount: Number(recordFor.line.amount), reference: recordFor.line.reference, paidOn: recordFor.line.txn_date, method: /upi/i.test(recordFor.line.description) ? "upi" : "bank" }}
            onRecorded={(id) => linkNew(recordFor.line, "payment_id", id)}
            onDone={() => setRecordFor(null)} />
        )}
      </SheetIf>
      <SheetIf open={expenseFor} title="Log as expense" onClose={() => setExpenseFor(null)}>
        {expenseFor && (
          <ExpenseForm preset={{ amount: Math.abs(Number(expenseFor.amount)), spentOn: expenseFor.txn_date, note: expenseFor.description.slice(0, 120) }}
            onCreated={(id) => linkNew(expenseFor, "expense_id", id)} onDone={() => setExpenseFor(null)} />
        )}
      </SheetIf>
    </div>
  );

  function matchedPayment(id: string) {
    const p = d.payments.find((x) => x.id === id);
    if (!p) return <span className="muted">Receipt removed</span>;
    return <>Receipt <Link className="link mono" to={`/app/payments/${p.id}`}>{p.receipt_no}</Link> · {who(p.lease_id).tenant?.name} · {periodLabel(p.period, true)}</>;
  }
  function matchedExpense(id: string) {
    const e = d.expenses.find((x) => x.id === id);
    if (!e) return <span className="muted">Expense removed</span>;
    return <>Expense · {e.category} · {dateLabel(e.spent_on, { day: "numeric", month: "short" })}</>;
  }
}

function PageHead() {
  return (
    <div className="page-head">
      <div><span className="eyebrow">Bank</span><h1 className="display">Reconcile</h1></div>
      <p className="page-sub muted small">Upload a bank statement and match each credit to a receipt, so you know every rupee that reached the bank was recorded.</p>
    </div>
  );
}

function LineHead({ l }: { l: BankLine }) {
  const amt = Number(l.amount);
  return (
    <div className="recon-head">
      <span className={`recon-dir ${amt > 0 ? "in" : "out"}`} aria-hidden>{amt > 0 ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}</span>
      <div className="grow" style={{ minWidth: 0 }}>
        <strong className="ellipsis recon-desc" title={l.description}>{l.description || "—"}</strong>
        <small className="muted">{dateLabel(l.txn_date)}{l.reference ? <> · <span className="mono">{l.reference}</span></> : null}</small>
      </div>
      <span className={`mono recon-amt ${amt > 0 ? "pos" : "neg"}`}>{amt > 0 ? "+" : "−"}{money(Math.abs(amt))}</span>
    </div>
  );
}

function Suggestions({ l, items, who, canWrite, busy, onAccept, onRecord, onExpense, onIgnore }: {
  l: BankLine; items: Suggestion[]; who: ReturnType<typeof leaseLookup>; canWrite: boolean; busy: boolean;
  onAccept: (s: Suggestion) => void; onRecord: () => void; onExpense: () => void; onIgnore: () => void;
}) {
  const credit = Number(l.amount) > 0;
  const seen = new Set<string>();
  const unique = items.filter((s) => {
    const k = s.kind === "payment" ? s.payment.id : s.kind === "expense" ? s.expense.id : `${s.row.lease.id}:${s.row.dueDate}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return (
    <div className="recon-suggest">
      {unique.map((s, i) => {
        const c = confidence(s.score);
        const label = s.kind === "payment"
          ? <>Receipt <span className="mono">{s.payment.receipt_no}</span> · {who(s.payment.lease_id).tenant?.name} · {money(s.payment.amount)}</>
          : s.kind === "record"
            ? <>Record rent · {s.row.tenant.name} · {periodLabel(s.row.dueDate.slice(0, 7), true)}</>
            : <>Expense · {s.expense.category} · {dateLabel(s.expense.spent_on, { day: "numeric", month: "short" })}</>;
        return (
          <div key={i} className={`recon-option ${i === 0 ? "top" : ""}`}>
            <span className={`conf conf-${c}`} title={`${c} confidence`}>{s.by === "ai" ? <Sparkles size={11} /> : null}{c}</span>
            <span className="grow small"><span>{label}</span><span className="tiny muted recon-why">{s.reason}</span></span>
            {canWrite && (
              <button className={`btn small ${i === 0 ? "primary" : ""}`} disabled={busy} onClick={() => onAccept(s)}>
                {s.kind === "record" ? "Record" : "Match"}
              </button>
            )}
          </div>
        );
      })}
      {canWrite && (
        <div className="row gap-sm wrap recon-actions">
          {unique.length === 0 && <span className="tiny muted grow">No likely match.</span>}
          {credit
            ? <button className="btn small ghost" onClick={onRecord} disabled={busy}>Record as rent…</button>
            : <button className="btn small ghost" onClick={onExpense} disabled={busy}>Log as expense…</button>}
          <button className="btn small ghost" onClick={onIgnore} disabled={busy}><EyeOff size={14} /> Set aside</button>
        </div>
      )}
    </div>
  );
}

function Uploader({ onText, busy, canWrite, sample, first }: { onText: (text: string, name: string) => void; busy: boolean; canWrite: boolean; sample?: () => void; first?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  async function pick(f: File | undefined) {
    if (!f) return;
    if (f.size > 5_000_000) return alert("That file is over 5 MB. Export a shorter date range.");
    onText(await f.text(), f.name);
    if (input.current) input.current.value = "";
  }
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files?.[0]); };
  if (!canWrite) return first ? <div className="card"><Empty icon={<Landmark size={22} />} title="No statements yet">An owner or manager can upload the bank statement.</Empty></div> : null;
  return (
    <div className={`card ${first ? "recon-hero" : ""}`}>
      {first && (
        <div className="stack-sm">
          <h2>Match your bank to your books</h2>
          <p className="muted small">Download your statement as CSV from net banking (HDFC, ICICI, SBI, Axis, Kotak and most others work). Aangan finds the date, narration and amount columns, then lines up every credit with a receipt.</p>
        </div>
      )}
      <div className={`dropzone ${over ? "over" : ""}`} role="button" tabIndex={0}
        onClick={() => input.current?.click()} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
        <Upload size={24} />
        <strong>{busy ? "Reading statement…" : first ? "Drop a statement CSV, or tap to choose" : "Add another statement"}</strong>
        <span className="small">Uploading the same statement twice adds nothing new.</span>
        <input ref={input} type="file" accept=".csv,text/csv,.txt" hidden onChange={(e) => pick(e.target.files?.[0])} />
      </div>
      {sample && <button className="btn small ghost block" onClick={sample} disabled={busy}><FileSpreadsheet size={15} /> Try a sample statement</button>}
    </div>
  );
}
