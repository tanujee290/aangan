import type { Invoice, Lease, Payment, Property, Tenant, Unit } from "./types";
import { todayISO } from "./format";

export type RentStatus = "paid" | "partial" | "due" | "overdue";

export interface LeaseRow {
  lease: Lease;
  tenant: Tenant;
  unit: Unit;
  property: Property;
  /** Amount owed for the month: the invoice total when one exists, otherwise the lease rent. */
  rent: number;
  invoice?: Invoice;
  paid: number;
  balance: number;
  dueDate: string;
  status: RentStatus;
  daysLate: number;
}

function monthBounds(period: string) {
  const [y, m] = period.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { start: `${period}-01`, end: `${period}-${String(last).padStart(2, "0")}` };
}

export function leaseActiveIn(lease: Lease, period: string) {
  const { start, end } = monthBounds(period);
  if (lease.start_date > end) return false;
  if (lease.end_date && lease.end_date < start) return false;
  return true;
}

/** Rent status is always calculated from leases and payments, never stored. */
export function rentRows(
  period: string,
  data: { leases: Lease[]; payments: Payment[]; tenants: Tenant[]; units: Unit[]; properties: Property[]; invoices?: Invoice[] },
  today = todayISO(),
): LeaseRow[] {
  const tById = new Map(data.tenants.map((t) => [t.id, t]));
  const uById = new Map(data.units.map((u) => [u.id, u]));
  const pById = new Map(data.properties.map((p) => [p.id, p]));
  const rows: LeaseRow[] = [];
  for (const lease of data.leases) {
    if (!leaseActiveIn(lease, period)) continue;
    if (lease.status === "ended" && (!lease.end_date || lease.end_date < monthBounds(period).start)) continue;
    const tenant = tById.get(lease.tenant_id);
    const unit = uById.get(lease.unit_id);
    const property = unit && pById.get(unit.property_id);
    if (!tenant || !unit || !property) continue;
    const invoice = data.invoices?.find((i) => i.lease_id === lease.id && i.period === period && i.status === "open");
    const rent = invoice ? Number(invoice.total) : Number(lease.rent);
    const paid = data.payments
      .filter((p) => p.lease_id === lease.id && p.period === period)
      .reduce((s, p) => s + Number(p.amount), 0);
    const dueDate = `${period}-${String(lease.due_day).padStart(2, "0")}`;
    const late = today > dueDate;
    let status: RentStatus;
    if (paid >= rent) status = "paid";
    else if (late) status = "overdue";
    else if (paid > 0) status = "partial";
    else status = "due";
    const daysLate = late && status !== "paid"
      ? Math.round((new Date(today).getTime() - new Date(dueDate).getTime()) / 86_400_000)
      : 0;
    rows.push({ lease, tenant, unit, property, rent, invoice, paid, balance: Math.max(0, rent - paid), dueDate, status, daysLate });
  }
  const order: Record<RentStatus, number> = { overdue: 0, partial: 1, due: 2, paid: 3 };
  return rows.sort((a, b) => order[a.status] - order[b.status] || a.dueDate.localeCompare(b.dueDate));
}

export const STATUS_LABEL: Record<RentStatus, string> = { paid: "Paid", partial: "Partial", due: "Due", overdue: "Overdue" };

export function daysUntil(iso: string, today = todayISO()) {
  return Math.round((new Date(iso).getTime() - new Date(today).getTime()) / 86_400_000);
}
