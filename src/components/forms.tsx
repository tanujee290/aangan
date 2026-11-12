import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import { supabase, errorMessage } from "../lib/supabase";
import { useData, useLive } from "../state/data";
import { useNotify } from "../state/notify";
import { currentPeriod, currencySymbol, money, periodLabel, shiftPeriod, todayISO } from "../lib/format";
import { rentRows } from "../lib/rent";
import {
  EXPENSE_CATEGORIES, METHODS, PRIORITIES, PROPERTY_TYPES,
  type Lease, type Method, type Priority, type Property, type PropertyType, type Task, type Tenant,
} from "../lib/types";
import { Field } from "./ui";
import { isOnline } from "../lib/network";
import { enqueue, isNetworkError, offlineCapture, type OutboxKind } from "../lib/outbox";

type Offline = { kind: OutboxKind; label: string; payload: Record<string, unknown> };

const PASS_COLOURS = ["#b5532f", "#0f6e6e", "#3f4aa8", "#c98a0b", "#3b7d3a", "#8a3a6b", "#2d2a26"];

function useSubmit(onDone: () => void) {
  const { refresh } = useData();
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  /** `offline`: when given, the entry is kept on this device if there's no connection, and synced later. */
  async function run(fn: () => Promise<unknown>, success: string, offline?: Offline) {
    setBusy(true);
    setError(null);
    const queue = async () => {
      await enqueue(offline!.kind, offline!.label, offline!.payload);
      notify("Saved on this device. It syncs when you're back online.");
      onDone();
    };
    try {
      if (offline && offlineCapture && !isOnline()) return await queue();
      const next = await fn();
      await refresh();
      notify(success);
      onDone();
      if (typeof next === "string") navigate(next);
    } catch (e) {
      if (offline && offlineCapture && isNetworkError(e)) {
        try { return await queue(); } catch (q) { setError(errorMessage(q)); return; }
      }
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

async function must<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data;
}

function FormError({ error }: { error: string | null }) {
  return error ? <p className="form-error" role="alert">{error}</p> : null;
}

/* ---------------------------------------------------------------- payment */

export interface PaymentPreset { amount?: number; method?: Method; reference?: string | null; paidOn?: string; note?: string }

export function PaymentForm({ leaseId, period: initialPeriod, preset, onRecorded, onDone }: {
  leaseId?: string;
  period?: string;
  /** Pre-fills the form, e.g. from a bank statement line. */
  preset?: PaymentPreset;
  /** Called with the new payment's id; when set, the form stays on the current page instead of opening the receipt. */
  onRecorded?: (paymentId: string) => Promise<void>;
  onDone: () => void;
}) {
  const live = useLive();
  const [period, setPeriod] = useState(initialPeriod ?? currentPeriod());
  const rows = useMemo(() => rentRows(period, live), [period, live]);
  const [lease, setLease] = useState(leaseId ?? rows.find((r) => r.status !== "paid")?.lease.id ?? rows[0]?.lease.id ?? "");
  const row = rows.find((r) => r.lease.id === lease);
  const [amount, setAmount] = useState<string>(preset?.amount ? String(preset.amount) : row ? String(row.balance || row.rent) : "");
  const [method, setMethod] = useState<Method>(preset?.method ?? "upi");
  const [reference, setReference] = useState(preset?.reference ?? "");
  const [note, setNote] = useState(preset?.note ?? "");
  const [paidOn, setPaidOn] = useState(preset?.paidOn && preset.paidOn <= todayISO() ? preset.paidOn : todayISO());
  const { busy, error, run } = useSubmit(onDone);

  if (live.leases.length === 0) {
    return <p className="muted">Add a tenant and lease first, then record their rent here.</p>;
  }

  function pickLease(id: string) {
    setLease(id);
    const r = rows.find((x) => x.lease.id === id);
    if (r && !preset?.amount) setAmount(String(r.balance || r.rent));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!lease || !(amt > 0)) return;
    const params = {
      p_lease_id: lease, p_amount: amt, p_period: period, p_method: method,
      p_reference: reference, p_note: note, p_paid_at: new Date(paidOn + "T12:00:00").toISOString(),
    };
    const who = rows.find((r) => r.lease.id === lease)?.tenant.name ?? "tenant";
    run(async () => {
      const p = await must(supabase.rpc("record_payment", params));
      const id = (p as { id: string }).id;
      if (onRecorded) {
        await onRecorded(id);
        return undefined;
      }
      return `/app/payments/${id}`;
    }, "Payment recorded", onRecorded ? undefined : { kind: "payment", label: `${money(amt)} from ${who} · ${periodLabel(period, true)}`, payload: params });
  }

  return (
    <form className="form" onSubmit={submit}>
      <Field label="For month">
        <div className="month-switch inline">
          <button type="button" onClick={() => setPeriod(shiftPeriod(period, -1))} aria-label="Previous month"><span aria-hidden="true">‹</span></button>
          <span>{periodLabel(period)}</span>
          <button type="button" onClick={() => setPeriod(shiftPeriod(period, 1))} aria-label="Next month"><span aria-hidden="true">›</span></button>
        </div>
      </Field>
      <Field label="Tenant">
        <select value={lease} onChange={(e) => pickLease(e.target.value)} required>
          {rows.length === 0 && <option value="">No active leases this month</option>}
          {rows.map((r) => (
            <option key={r.lease.id} value={r.lease.id}>
              {r.tenant.name} · {r.property.name} {r.unit.label} — {r.status === "paid" ? "paid" : `${money(r.balance)} due`}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid-2">
        <Field label={`Amount (${currencySymbol()})`}>
          <input inputMode="decimal" type="number" min="1" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </Field>
        <Field label="Paid on">
          <input type="date" value={paidOn} max={todayISO()} onChange={(e) => setPaidOn(e.target.value)} required />
        </Field>
      </div>
      <Field label="Method">
        <div className="chips">
          {METHODS.map((m) => (
            <button type="button" key={m.value} className={`chip ${method === m.value ? "on" : ""}`} onClick={() => setMethod(m.value)}>
              {m.label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Reference" hint="UPI transaction ID, cheque number…">
        <input value={reference} onChange={(e) => setReference(e.target.value)} />
      </Field>
      <Field label="Note">
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <FormError error={error} />
      <button className="btn primary block" disabled={busy || !lease}>{busy ? "Recording…" : "Record payment & issue receipt"}</button>
    </form>
  );
}

/* --------------------------------------------------------------- property */

export function PropertyForm({ property, onDone }: { property?: Property; onDone: () => void }) {
  const { units } = useData();
  const [name, setName] = useState(property?.name ?? "");
  const [type, setType] = useState<PropertyType>(property?.type ?? "Apartment");
  const [address, setAddress] = useState(property?.address ?? "");
  const [labels, setLabels] = useState<string[]>(property ? [] : ["Unit 1"]);
  const { busy, error, run } = useSubmit(onDone);
  const existing = property ? units.filter((u) => u.property_id === property.id && !u.archived_at) : [];

  function submit(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      if (property) {
        await must(supabase.from("properties").update({ name: name.trim(), type, address: address.trim() || null }).eq("id", property.id));
        const add = labels.map((l) => l.trim()).filter(Boolean);
        if (add.length)
          await must(supabase.from("units").insert(add.map((label, i) => ({ property_id: property.id, label, pass_colour: PASS_COLOURS[(existing.length + i) % PASS_COLOURS.length] }))));
      } else {
        const p = await must(supabase.from("properties").insert({ name: name.trim(), type, address: address.trim() || null }).select().single());
        const add = labels.map((l) => l.trim()).filter(Boolean);
        await must(supabase.from("units").insert((add.length ? add : ["Main"]).map((label, i) => ({ property_id: p.id, label, pass_colour: PASS_COLOURS[i % PASS_COLOURS.length] }))));
        return `/app/properties/${p.id}`;
      }
    }, property ? "Property updated" : "Property added");
  }

  return (
    <form className="form" onSubmit={submit}>
      <Field label="Property name">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Neem Tree Residency" required autoFocus />
      </Field>
      <Field label="Type">
        <div className="chips">
          {PROPERTY_TYPES.map((t) => (
            <button type="button" key={t} className={`chip ${type === t ? "on" : ""}`} onClick={() => setType(t)}>{t}</button>
          ))}
        </div>
      </Field>
      <Field label="Address">
        <textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
      </Field>
      <Field label={property ? "Add units" : "Units"} hint="Flats, rooms or beds you rent out separately.">
        <div className="stack-sm">
          {existing.length > 0 && <p className="muted small">Existing: {existing.map((u) => u.label).join(", ")}</p>}
          {labels.map((l, i) => (
            <div className="row-input" key={i}>
              <input value={l} onChange={(e) => setLabels(labels.map((x, j) => (j === i ? e.target.value : x)))} placeholder="e.g. Flat 2B" />
              <button type="button" className="icon-btn" onClick={() => setLabels(labels.filter((_, j) => j !== i))} aria-label="Remove unit"><Trash2 size={16} /></button>
            </div>
          ))}
          <button type="button" className="btn ghost small" onClick={() => setLabels([...labels, `Unit ${existing.length + labels.length + 1}`])}>
            <Plus size={14} /> Add unit
          </button>
        </div>
      </Field>
      <FormError error={error} />
      <button className="btn primary block" disabled={busy}>{busy ? "Saving…" : property ? "Save changes" : "Add property"}</button>
    </form>
  );
}

/* ------------------------------------------------------- tenant and lease */

export function TenantLeaseForm({ onDone, unitId }: { onDone: () => void; unitId?: string }) {
  const live = useLive();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const occupied = new Set(live.leases.filter((l) => l.status === "active").map((l) => l.unit_id));
  const freeUnits = live.units.filter((u) => !occupied.has(u.id));
  const [unit, setUnit] = useState(unitId ?? freeUnits[0]?.id ?? live.units[0]?.id ?? "");
  const [rent, setRent] = useState("");
  const [deposit, setDeposit] = useState("");
  const [dueDay, setDueDay] = useState("5");
  const [start, setStart] = useState(todayISO());
  const [end, setEnd] = useState("");
  const { busy, error, run } = useSubmit(onDone);
  const propName = (pid: string) => live.properties.find((p) => p.id === pid)?.name ?? "";

  if (live.units.length === 0) return <p className="muted">Add a property with at least one unit first.</p>;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (step < 2) return setStep(step + 1);
    run(async () => {
      const t = await must(supabase.from("tenants").insert({ name: name.trim(), phone_whatsapp: phone.trim() || null, email: email.trim() || null }).select().single());
      await must(supabase.from("leases").insert({
        tenant_id: t.id, unit_id: unit, rent: Number(rent), deposit: Number(deposit || 0),
        due_day: Number(dueDay), start_date: start, end_date: end || null,
      }));
      return `/app/tenants/${t.id}`;
    }, "Tenant added");
  }

  return (
    <form className="form" onSubmit={submit}>
      <ol className="steps">
        {["Tenant", "Unit", "Terms"].map((s, i) => (
          <li key={s} className={i === step ? "on" : i < step ? "done" : ""}>{s}</li>
        ))}
      </ol>
      {step === 0 && (
        <>
          <Field label="Full name"><input value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></Field>
          <Field label="WhatsApp number" hint="10-digit Indian numbers get +91 automatically.">
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" />
          </Field>
          <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        </>
      )}
      {step === 1 && (
        <Field label="Which unit?">
          <div className="unit-pick">
            {live.units.map((u) => (
              <button type="button" key={u.id} className={`unit-opt ${unit === u.id ? "on" : ""}`} onClick={() => setUnit(u.id)}>
                <span className="dot" style={{ background: u.pass_colour ?? "var(--accent)" }} />
                <span><strong>{u.label}</strong><small>{propName(u.property_id)}</small></span>
                {occupied.has(u.id) && <em>occupied</em>}
              </button>
            ))}
          </div>
        </Field>
      )}
      {step === 2 && (
        <>
          <div className="grid-2">
            <Field label={`Monthly rent (${currencySymbol()})`}><input type="number" inputMode="decimal" min="0" step="1" value={rent} onChange={(e) => setRent(e.target.value)} required autoFocus /></Field>
            <Field label={`Deposit (${currencySymbol()})`}><input type="number" inputMode="decimal" min="0" step="1" value={deposit} onChange={(e) => setDeposit(e.target.value)} /></Field>
          </div>
          <Field label="Rent due on day" hint="Day of each month (1–28).">
            <input type="number" min="1" max="28" value={dueDay} onChange={(e) => setDueDay(e.target.value)} required />
          </Field>
          <div className="grid-2">
            <Field label="Lease start"><input type="date" value={start} onChange={(e) => setStart(e.target.value)} required /></Field>
            <Field label="Lease end"><input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></Field>
          </div>
        </>
      )}
      <FormError error={error} />
      <div className="row gap">
        {step > 0 && <button type="button" className="btn ghost" onClick={() => setStep(step - 1)}>Back</button>}
        <button className="btn primary grow" disabled={busy || (step === 1 && !unit)}>{step < 2 ? "Continue" : busy ? "Saving…" : "Add tenant"}</button>
      </div>
    </form>
  );
}

export function TenantForm({ tenant, onDone }: { tenant: Tenant; onDone: () => void }) {
  const [name, setName] = useState(tenant.name);
  const [phone, setPhone] = useState(tenant.phone_whatsapp ?? "");
  const [email, setEmail] = useState(tenant.email ?? "");
  const { busy, error, run } = useSubmit(onDone);
  return (
    <form className="form" onSubmit={(e) => {
      e.preventDefault();
      run(() => must(supabase.from("tenants").update({ name: name.trim(), phone_whatsapp: phone.trim() || null, email: email.trim() || null }).eq("id", tenant.id)), "Tenant updated");
    }}>
      <Field label="Full name"><input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
      <Field label="WhatsApp number"><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
      <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <FormError error={error} />
      <button className="btn primary block" disabled={busy}>Save</button>
    </form>
  );
}

export function LeaseForm({ lease, onDone }: { lease: Lease; onDone: () => void }) {
  const [rent, setRent] = useState(String(Number(lease.rent)));
  const [deposit, setDeposit] = useState(String(Number(lease.deposit)));
  const [dueDay, setDueDay] = useState(String(lease.due_day));
  const [end, setEnd] = useState(lease.end_date ?? "");
  const [status, setStatus] = useState(lease.status);
  const { busy, error, run } = useSubmit(onDone);
  return (
    <form className="form" onSubmit={(e) => {
      e.preventDefault();
      run(() => must(supabase.from("leases").update({
        rent: Number(rent), deposit: Number(deposit || 0), due_day: Number(dueDay),
        end_date: end || (status === "ended" ? todayISO() : null), status,
      }).eq("id", lease.id)), "Lease updated");
    }}>
      <div className="grid-2">
        <Field label="Monthly rent"><input type="number" min="0" value={rent} onChange={(e) => setRent(e.target.value)} required /></Field>
        <Field label="Deposit"><input type="number" min="0" value={deposit} onChange={(e) => setDeposit(e.target.value)} /></Field>
      </div>
      <div className="grid-2">
        <Field label="Due day"><input type="number" min="1" max="28" value={dueDay} onChange={(e) => setDueDay(e.target.value)} required /></Field>
        <Field label="Lease end"><input type="date" min={lease.start_date} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      <Field label="Status">
        <div className="chips">
          <button type="button" className={`chip ${status === "active" ? "on" : ""}`} onClick={() => setStatus("active")}>Active</button>
          <button type="button" className={`chip ${status === "ended" ? "on" : ""}`} onClick={() => setStatus("ended")}>Ended (moved out)</button>
        </div>
      </Field>
      <FormError error={error} />
      <button className="btn primary block" disabled={busy}>Save lease</button>
    </form>
  );
}

/* ------------------------------------------------------- tasks & expenses */

export function TaskForm({ task, onDone }: { task?: Task; onDone: () => void }) {
  const live = useLive();
  const [title, setTitle] = useState(task?.title ?? "");
  const [priority, setPriority] = useState<Priority>(task?.priority ?? "medium");
  const [property, setProperty] = useState(task?.property_id ?? "");
  const [vendor, setVendor] = useState(task?.vendor ?? "");
  const { busy, error, run } = useSubmit(onDone);
  return (
    <form className="form" onSubmit={(e) => {
      e.preventDefault();
      const row = { title: title.trim(), priority, property_id: property || null, vendor: vendor.trim() || null };
      run(() => must(task ? supabase.from("tasks").update(row).eq("id", task.id) : supabase.from("tasks").insert(row)), task ? "Task updated" : "Task added",
        task ? undefined : { kind: "task", label: row.title, payload: row });
    }}>
      <Field label="What needs doing?"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Fix leaking tap in 2B" required autoFocus /></Field>
      <Field label="Priority">
        <div className="chips">
          {PRIORITIES.map((p) => (
            <button type="button" key={p} className={`chip prio-${p} ${priority === p ? "on" : ""}`} onClick={() => setPriority(p)}>{p}</button>
          ))}
        </div>
      </Field>
      <Field label="Property">
        <select value={property} onChange={(e) => setProperty(e.target.value)}>
          <option value="">General</option>
          {live.properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      <Field label="Vendor / assigned to"><input value={vendor} onChange={(e) => setVendor(e.target.value)} /></Field>
      <FormError error={error} />
      <button className="btn primary block" disabled={busy}>{task ? "Save task" : "Add task"}</button>
    </form>
  );
}

export function ExpenseForm({ preset, onCreated, onDone }: {
  preset?: { amount?: number; spentOn?: string; note?: string };
  /** Called with the new expense's id, e.g. to link it to a bank statement line. */
  onCreated?: (expenseId: string) => Promise<void>;
  onDone: () => void;
}) {
  const live = useLive();
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [amount, setAmount] = useState(preset?.amount ? String(preset.amount) : "");
  const [spentOn, setSpentOn] = useState(preset?.spentOn ?? todayISO());
  const [property, setProperty] = useState("");
  const [note, setNote] = useState(preset?.note ?? "");
  const { busy, error, run } = useSubmit(onDone);
  return (
    <form className="form" onSubmit={(e) => {
      e.preventDefault();
      run(async () => {
        const row = await must(supabase.from("expenses")
          .insert({ category, amount: Number(amount), spent_on: spentOn, property_id: property || null, note: note.trim() || null })
          .select("id").single());
        if (onCreated) await onCreated((row as { id: string }).id);
      }, "Expense logged", onCreated ? undefined : {
        kind: "expense", label: `${money(Number(amount))} · ${category}`,
        payload: { category, amount: Number(amount), spent_on: spentOn, property_id: property || null, note: note.trim() || null },
      });
    }}>
      <Field label="Category">
        <div className="chips">
          {EXPENSE_CATEGORIES.map((c) => (
            <button type="button" key={c} className={`chip ${category === c ? "on" : ""}`} onClick={() => setCategory(c)}>{c}</button>
          ))}
        </div>
      </Field>
      <div className="grid-2">
        <Field label={`Amount (${currencySymbol()})`}><input type="number" inputMode="decimal" min="1" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus /></Field>
        <Field label="Date"><input type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} required /></Field>
      </div>
      <Field label="Property">
        <select value={property} onChange={(e) => setProperty(e.target.value)}>
          <option value="">General</option>
          {live.properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      <Field label="Note"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <FormError error={error} />
      <button className="btn primary block" disabled={busy}>Log expense</button>
    </form>
  );
}
