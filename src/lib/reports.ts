// Calculations shared by the Reports page and the assistant's workspace snapshot.
// Everything is derived from the loaded rows; nothing here is stored.
import type { Data } from "../state/data";
import { currentPeriod, METHOD_LABEL, shiftPeriod, todayISO } from "./format";
import { rentRows, type LeaseRow, type RentStatus } from "./rent";
import { downloadCsv, downloadFile } from "./export";

type Rows = Pick<Data, "leases" | "payments" | "tenants" | "units" | "properties" | "invoices">;

export function lastMonths(n: number, end = currentPeriod()) {
  return Array.from({ length: n }, (_, i) => shiftPeriod(end, i - (n - 1)));
}

export function leaseLookup(d: Pick<Data, "leases" | "tenants" | "units" | "properties">) {
  const leases = new Map(d.leases.map((l) => [l.id, l]));
  const tenants = new Map(d.tenants.map((t) => [t.id, t]));
  const units = new Map(d.units.map((u) => [u.id, u]));
  const props = new Map(d.properties.map((p) => [p.id, p]));
  return (leaseId: string) => {
    const lease = leases.get(leaseId);
    const tenant = lease && tenants.get(lease.tenant_id);
    const unit = lease && units.get(lease.unit_id);
    const property = unit && props.get(unit.property_id);
    return { lease, tenant, unit, property };
  };
}

export type LedgerKind = "rent" | "expense" | "deposit";
export interface LedgerEntry {
  id: string;
  date: string;
  kind: LedgerKind;
  label: string;
  detail: string;
  /** Positive is money in, negative is money out. Deposits are tracked but never counted as income. */
  amount: number;
  ref: string | null;
  link?: string;
}

export function ledger(d: Data): LedgerEntry[] {
  const who = leaseLookup(d);
  const propName = new Map(d.properties.map((p) => [p.id, p.name]));
  const out: LedgerEntry[] = [];
  for (const p of d.payments) {
    const { tenant, unit, property } = who(p.lease_id);
    out.push({
      id: `p-${p.id}`, date: p.paid_at.slice(0, 10), kind: "rent", label: tenant?.name ?? "Tenant",
      detail: [property?.name, unit?.label, `rent ${p.period}`, METHOD_LABEL[p.method]].filter(Boolean).join(" · "),
      amount: Number(p.amount), ref: p.receipt_no, link: `/app/payments/${p.id}`,
    });
  }
  for (const e of d.expenses) {
    out.push({
      id: `e-${e.id}`, date: e.spent_on, kind: "expense", label: e.category,
      detail: [e.property_id ? propName.get(e.property_id) : "General", e.note].filter(Boolean).join(" · "),
      amount: -Number(e.amount), ref: null,
    });
  }
  for (const t of d.deposits) {
    const { tenant, unit } = who(t.lease_id);
    const sign = t.type === "received" ? 1 : -1;
    out.push({
      id: `d-${t.id}`, date: t.txn_date, kind: "deposit", label: `Deposit ${t.type}`,
      detail: [tenant?.name, unit?.label, t.note].filter(Boolean).join(" · "), amount: sign * Number(t.amount), ref: null,
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

export interface MonthTotals { period: string; expected: number; collected: number; received: number; spent: number }

/** Per-month totals: rent expected and collected against that month, cash recorded in the month, and expenses. */
export function monthTotals(d: Data, months: string[]): MonthTotals[] {
  return months.map((period) => {
    const rows = rentRows(period, d);
    return {
      period,
      expected: rows.reduce((s, r) => s + r.rent, 0),
      collected: rows.reduce((s, r) => s + Math.min(r.paid, r.rent), 0),
      received: d.payments.filter((p) => p.paid_at.slice(0, 7) === period).reduce((s, p) => s + Number(p.amount), 0),
      spent: d.expenses.filter((e) => e.spent_on.startsWith(period)).reduce((s, e) => s + Number(e.amount), 0),
    };
  });
}

export type Cell = { status: RentStatus | "none"; row?: LeaseRow };
export interface CollectionLine { leaseId: string; tenantId: string; tenant: string; place: string; cells: Cell[]; expected: number; paid: number }

/** A lease × month grid of rent status, for the collection heatmap. */
export function collectionGrid(d: Rows, months: string[], today = todayISO()): CollectionLine[] {
  const byLease = new Map<string, CollectionLine>();
  months.forEach((m, i) => {
    for (const r of rentRows(m, d, today)) {
      let line = byLease.get(r.lease.id);
      if (!line) {
        line = {
          leaseId: r.lease.id, tenantId: r.tenant.id, tenant: r.tenant.name, place: `${r.property.name} · ${r.unit.label}`,
          cells: months.map(() => ({ status: "none" as const })), expected: 0, paid: 0,
        };
        byLease.set(r.lease.id, line);
      }
      // A month that hasn't started yet isn't "due" in any useful sense for the grid.
      line.cells[i] = { status: m > today.slice(0, 7) ? "none" : r.status, row: r };
      // Collection rate counts only rent that has fallen due (or been paid early).
      if (r.dueDate <= today || r.paid > 0) {
        line.expected += r.rent;
        line.paid += Math.min(r.paid, r.rent);
      }
    }
  });
  return [...byLease.values()].sort((a, b) => a.place.localeCompare(b.place));
}

export function depositsHeld(d: Pick<Data, "deposits">) {
  return d.deposits.reduce((s, t) => s + (t.type === "received" ? 1 : -1) * Number(t.amount), 0);
}

/* ---------------------------------------------------------------- exports */

export function exportWorkspaceJson(d: Data) {
  const { workspace, properties, units, tenants, leases, payments, tasks, expenses, invoices, meters, deposits, documents, reminders, members, audit } = d;
  downloadFile(
    `aangan-export-${todayISO()}.json`,
    JSON.stringify({
      format: "angan-export/1", exported_at: new Date().toISOString(), workspace, properties, units, tenants, leases, payments,
      tasks, expenses, invoices, meter_readings: meters, deposit_txns: deposits, documents, reminders, members, audit_events: audit,
    }, null, 2),
    "application/json",
  );
}

export function exportPaymentsCsv(d: Data) {
  const who = leaseLookup(d);
  downloadCsv(
    `aangan-payments-${todayISO()}.csv`,
    ["receipt_no", "paid_at", "period", "tenant", "property", "unit", "amount", "method", "reference", "note"],
    d.payments.map((p) => {
      const { tenant, unit, property } = who(p.lease_id);
      return [p.receipt_no, p.paid_at.slice(0, 10), p.period, tenant?.name, property?.name, unit?.label, p.amount, METHOD_LABEL[p.method], p.reference, p.note];
    }),
  );
}

export function exportExpensesCsv(d: Data) {
  const propName = new Map(d.properties.map((p) => [p.id, p.name]));
  downloadCsv(
    `aangan-expenses-${todayISO()}.csv`,
    ["date", "category", "property", "amount", "note"],
    d.expenses.map((e) => [e.spent_on, e.category, e.property_id ? propName.get(e.property_id) : "", e.amount, e.note]),
  );
}

export function exportLedgerCsv(entries: LedgerEntry[], name = "ledger") {
  downloadCsv(
    `aangan-${name}-${todayISO()}.csv`,
    ["date", "type", "description", "detail", "reference", "money_in", "money_out"],
    entries.map((e) => [e.date, e.kind, e.label, e.detail, e.ref, e.amount > 0 ? e.amount.toFixed(2) : "", e.amount < 0 ? (-e.amount).toFixed(2) : ""]),
  );
}

export function exportCollectionCsv(lines: CollectionLine[], months: string[]) {
  downloadCsv(
    `aangan-collection-${todayISO()}.csv`,
    ["tenant", "property_unit", ...months, "expected", "collected", "rate"],
    lines.map((l) => [
      l.tenant, l.place, ...l.cells.map((c) => (c.status === "none" ? "" : c.status)), l.expected.toFixed(2), l.paid.toFixed(2),
      l.expected ? `${Math.round((l.paid / l.expected) * 100)}%` : "",
    ]),
  );
}
