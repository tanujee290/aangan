// Builds the compact workspace snapshot the assistant answers from, and streams replies from /api/assist.
import type { Data } from "../state/data";
import { supabase, demoMode } from "./supabase";
import { currentPeriod, todayISO } from "./format";
import { rentRows } from "./rent";
import { depositsHeld, lastMonths, leaseLookup, monthTotals } from "./reports";

const n = (v: string | number) => Math.round(Number(v) * 100) / 100;

export function workspaceSnapshot(d: Data): string {
  const ws = d.workspace!;
  const period = currentPeriod();
  const who = leaseLookup(d);
  const months = lastMonths(12);
  const live = { ...d, properties: d.properties, units: d.units, tenants: d.tenants };
  const propName = new Map(d.properties.map((p) => [p.id, p.name]));

  const snapshot = {
    today: todayISO(),
    workspace: { name: ws.name, currency: ws.currency, upi_id: ws.upi_id, grace_days: ws.grace_days, late_fee: ws.late_fee_type === "none" ? null : { type: ws.late_fee_type, value: ws.late_fee_value } },
    properties: d.properties.map((p) => ({
      name: p.name, type: p.type, archived: !!p.archived_at,
      units: d.units.filter((u) => u.property_id === p.id).map((u) => u.label + (u.archived_at ? " (archived)" : "")),
    })),
    this_month: {
      period,
      rent: rentRows(period, live).map((r) => ({
        tenant: r.tenant.name, place: `${r.property.name} · ${r.unit.label}`, owed: r.rent, paid: r.paid, balance: r.balance,
        status: r.status, due_date: r.dueDate, days_late: r.daysLate || undefined, has_whatsapp: !!r.tenant.phone_whatsapp,
        invoice: r.invoice ? { no: r.invoice.invoice_no, utilities: n(r.invoice.utilities), late_fee: n(r.invoice.late_fee) } : undefined,
      })),
    },
    last_12_months: monthTotals(d, months).map((t) => ({ period: t.period, rent_expected: t.expected, rent_collected_for_month: t.collected, cash_recorded: t.received, expenses: t.spent })),
    leases: d.leases.map((l) => {
      const { tenant, unit, property } = who(l.id);
      return { tenant: tenant?.name, place: `${property?.name} · ${unit?.label}`, rent: n(l.rent), deposit: n(l.deposit), due_day: l.due_day, start: l.start_date, end: l.end_date, status: l.status };
    }),
    tenants: d.tenants.map((t) => ({ name: t.name, archived: !!t.archived_at, whatsapp: !!t.phone_whatsapp, portal: !!t.portal_token })),
    deposits_held_total: depositsHeld(d),
    open_invoices: d.invoices.filter((i) => i.status === "open").slice(0, 60).map((i) => ({ no: i.invoice_no, tenant: who(i.lease_id).tenant?.name, period: i.period, total: n(i.total), due: i.due_date })),
    recent_payments: d.payments.slice(0, 80).map((p) => ({ receipt: p.receipt_no, tenant: who(p.lease_id).tenant?.name, period: p.period, amount: n(p.amount), method: p.method, date: p.paid_at.slice(0, 10) })),
    expenses_12m: d.expenses.filter((e) => e.spent_on.slice(0, 7) >= months[0]).map((e) => ({ date: e.spent_on, category: e.category, property: e.property_id ? propName.get(e.property_id) : null, amount: n(e.amount), note: e.note })),
    bank_reconciliation: d.bankLines.length ? {
      lines: d.bankLines.length,
      matched: d.bankLines.filter((l) => l.status === "matched").length,
      unmatched_credits: d.bankLines.filter((l) => l.status === "unmatched" && Number(l.amount) > 0).slice(0, 40)
        .map((l) => ({ date: l.txn_date, amount: n(l.amount), narration: l.description.slice(0, 80) })),
    } : undefined,
    tasks_open: d.tasks.filter((t) => t.status !== "done").map((t) => ({ title: t.title, priority: t.priority, status: t.status, property: t.property_id ? propName.get(t.property_id) : null, vendor: t.vendor, from_tenant: t.source === "tenant", created: t.created_at.slice(0, 10) })),
  };
  return JSON.stringify(snapshot);
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

/** Streams the assistant's answer; `onText` receives the growing reply. */
export async function ask(turns: ChatTurn[], context: string, onText: (text: string) => void, signal?: AbortSignal) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!demoMode) {
    const { data } = await supabase.auth.getSession();
    if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  const res = await fetch("/api/assist", { method: "POST", headers, body: JSON.stringify({ messages: turns, context }), signal });
  if (!res.ok || !res.body) {
    let msg = "The assistant couldn't answer just now.";
    try { msg = (await res.json()).error ?? msg; } catch { /* not JSON, e.g. local dev without functions */ }
    if (res.status === 404) msg = "The assistant needs the API routes. Run the app with `npm run dev:netlify`, `vercel dev` or `npm run dev:cloudflare` to try it locally.";
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += dec.decode(value, { stream: true });
    onText(text);
  }
  return text;
}
