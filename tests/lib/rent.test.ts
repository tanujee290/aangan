import { describe, expect, it } from "vitest";
import { daysUntil, leaseActiveIn, rentRows } from "../../src/lib/rent";
import type { Invoice, Lease, Payment, Property, Tenant, Unit } from "../../src/lib/types";

const property: Property = { id: "p1", workspace_id: "w1", name: "Green View", type: "Apartment", address: null, created_at: "2026-01-01", archived_at: null };
const units: Unit[] = ["A1", "A2", "A3", "A4"].map((label, i) => ({ id: `u${i}`, property_id: "p1", label, pass_colour: null, archived_at: null }));
const tenants: Tenant[] = ["Ravi", "Asha", "Imran", "Neha"].map((name, i) => ({ id: `t${i}`, name, phone_whatsapp: null, email: null, upi_id: null, created_at: "2026-01-01", archived_at: null }));
const lease = (i: number, over: Partial<Lease> = {}): Lease => ({
  id: `l${i}`, unit_id: `u${i}`, tenant_id: `t${i}`, rent: "10000", deposit: "20000", due_day: 5, start_date: "2026-01-01", end_date: null, status: "active", ...over,
});
const pay = (leaseId: string, amount: string, period = "2026-11"): Payment => ({
  id: `pay-${leaseId}-${amount}`, lease_id: leaseId, receipt_no: "R-1", verify_token: "v", amount, period, method: "upi", reference: null, note: null, paid_at: `${period}-03T10:00:00Z`,
});

describe("rentRows", () => {
  const leases = [lease(0), lease(1), lease(2, { due_day: 20 }), lease(3, { due_day: 20 })];
  const payments = [pay("l0", "10000"), pay("l1", "4000"), pay("l2", "2500")];
  const rows = rentRows("2026-11", { leases, payments, tenants, units, properties: [property] }, "2026-11-10");
  const byTenant = Object.fromEntries(rows.map((r) => [r.tenant.name, r]));

  it("derives each status from leases and payments", () => {
    expect(byTenant.Ravi.status).toBe("paid");
    expect(byTenant.Asha.status).toBe("overdue");
    expect(byTenant.Asha.daysLate).toBe(5);
    expect(byTenant.Asha.balance).toBe(6000);
    expect(byTenant.Imran.status).toBe("partial");
    expect(byTenant.Neha.status).toBe("due");
    expect(byTenant.Ravi.daysLate).toBe(0);
  });

  it("sorts the most urgent first", () => {
    expect(rows.map((r) => r.status)).toEqual(["overdue", "partial", "due", "paid"]);
  });

  it("uses an open invoice total instead of the lease rent", () => {
    const invoice = { id: "i1", lease_id: "l0", period: "2026-11", status: "open", total: "12500" } as Invoice;
    const [row] = rentRows("2026-11", { leases: [lease(0)], payments: [pay("l0", "10000")], tenants, units, properties: [property], invoices: [invoice] }, "2026-11-10");
    expect(row.rent).toBe(12500);
    expect(row.status).toBe("overdue");
    expect(row.balance).toBe(2500);
  });

  it("skips leases outside the month", () => {
    expect(leaseActiveIn(lease(0, { start_date: "2026-12-01" }), "2026-11")).toBe(false);
    expect(leaseActiveIn(lease(0, { end_date: "2026-10-31" }), "2026-11")).toBe(false);
    expect(leaseActiveIn(lease(0, { end_date: "2026-11-15" }), "2026-11")).toBe(true);
    const ended = rentRows("2026-11", { leases: [lease(0, { status: "ended", end_date: "2026-10-31" })], payments: [], tenants, units, properties: [property] }, "2026-11-10");
    expect(ended).toEqual([]);
  });
});

describe("daysUntil", () => {
  it("counts whole days", () => {
    expect(daysUntil("2026-11-20", "2026-11-10")).toBe(10);
    expect(daysUntil("2026-11-01", "2026-11-10")).toBe(-9);
  });
});
