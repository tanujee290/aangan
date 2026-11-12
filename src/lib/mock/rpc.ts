// The mock backend's versions of the security-definer RPCs in supabase/migrations.
import { todayISO } from "../format";
import { getDB, type Row } from "./store";
import { MockError, insertRows, deleteRows, token64, updateRows, type Ctx } from "./engine";

type Args = Record<string, unknown>;
const t = () => getDB().tables;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const num = (v: unknown) => Number(v ?? 0);
const sum = (rows: Row[], col = "amount") => rows.reduce((s, r) => s + num(r[col]), 0);
const pad = (n: number, w = 5) => String(n).padStart(w, "0");
const canWrite = (c: Ctx) => c.role === "owner" || c.role === "manager";
const needUser = (c: Ctx) => { if (!c.uid) throw new MockError("Sign in first", "42501"); };

function workspace(c: Ctx): Row {
  const ws = t().workspaces.find((w) => w.id === c.ws);
  if (!ws) throw new MockError("No workspace");
  return ws;
}

/** Bumps a workspace counter (receipt or invoice) and returns the new value. */
function nextSeq(ws: Row, col: "receipt_seq" | "invoice_seq", c: Ctx): number {
  const [updated] = updateRows("workspaces", [ws], { [col]: num(ws[col]) + 1 }, { ...c, allowSeq: true }, true);
  return num(updated[col]);
}

function monthEnd(period: string) {
  const [y, m] = period.split("-").map(Number);
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}
function prevPeriod(period: string) {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const paidFor = (leaseId: unknown, period: unknown) => sum(t().payments.filter((p) => p.lease_id === leaseId && p.period === period));

/* ----------------------------------------------------------------- payments */

function record_payment(a: Args, c: Ctx) {
  needUser(c);
  if (!canWrite(c)) throw new MockError("Your role can view this workspace but not record payments");
  const lease = t().leases.find((l) => l.id === a.p_lease_id && l.workspace_id === c.ws);
  if (!lease) throw new MockError("Lease not found");
  const ws = workspace(c);
  const seq = nextSeq(ws, "receipt_seq", c);
  const trimOrNull = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const period = String(a.p_period ?? "");
  const [row] = insertRows("payments", [{
    workspace_id: lease.workspace_id, lease_id: lease.id, receipt_no: `${ws.invoice_prefix}-${pad(seq)}`,
    verify_token: token64(), amount: a.p_amount, period, method: a.p_method ?? "upi",
    reference: trimOrNull(a.p_reference), note: trimOrNull(a.p_note), paid_at: a.p_paid_at ?? new Date().toISOString(),
  }], c, { asDefiner: true });
  // Clear today's pending reminder for this lease if the period is now fully paid.
  const inv = t().invoices.find((i) => i.lease_id === lease.id && i.period === period && i.status === "open");
  const owed = (inv ? num(inv.total) : num(lease.rent)) - paidFor(lease.id, period);
  if (owed <= 0) {
    const today = todayISO();
    const stale = t().reminders.filter(
      (r) => r.lease_id === lease.id && r.period === period && r.for_date === today && (r.status === "pending" || !r.status),
    );
    if (stale.length) deleteRows("reminders", stale, c, true);
  }
  return row;
}

function verify_receipt(a: Args) {
  const tok = String(a.p_token ?? "");
  if (tok.length < 32) return null;
  const p = t().payments.find((x) => x.verify_token === tok);
  if (!p) return null;
  const l = t().leases.find((x) => x.id === p.lease_id)!;
  const tenant = t().tenants.find((x) => x.id === l.tenant_id)!;
  const u = t().units.find((x) => x.id === l.unit_id)!;
  const pr = t().properties.find((x) => x.id === u.property_id)!;
  const w = t().workspaces.find((x) => x.id === p.workspace_id)!;
  return {
    receipt_no: p.receipt_no, amount: p.amount, period: p.period, method: p.method, paid_at: p.paid_at,
    tenant: tenant.name, property: pr.name, unit: u.label, landlord: w.name, currency: w.currency, locale: w.locale,
  };
}

/* ----------------------------------------------------------------- invoices */

function generate_invoices(a: Args, c: Ctx) {
  needUser(c);
  if (!canWrite(c)) throw new MockError("Not allowed");
  const period = String(a.p_period ?? "");
  if (!PERIOD.test(period)) throw new MockError("Invalid period");
  let ws = workspace(c);
  const start = `${period}-01`;
  const end = monthEnd(period);
  const prev = prevPeriod(period);
  let n = 0;
  const leases = t().leases.filter((l) =>
    l.workspace_id === ws.id && String(l.start_date) <= end && (!l.end_date || String(l.end_date) >= start)
    && (l.status === "active" || String(l.end_date) >= start));
  for (const l of leases) {
    const util = sum(t().meter_readings.filter((m) => m.unit_id === l.unit_id && m.period === period));
    const prevInv = t().invoices.find((i) => i.lease_id === l.id && i.period === prev && i.status === "open");
    const cf = prevInv ? num(prevInv.total) - paidFor(l.id, prev) : 0;
    const existing = t().invoices.find((i) => i.lease_id === l.id && i.period === period);
    if (existing) {
      if (existing.status === "open") updateRows("invoices", [existing], { utilities: util, carried_forward: cf }, c, true);
      continue;
    }
    const seq = nextSeq(ws, "invoice_seq", c);
    ws = workspace(c);
    insertRows("invoices", [{
      workspace_id: ws.id, lease_id: l.id, invoice_no: `${ws.invoice_prefix}-INV-${pad(seq)}`, period,
      due_date: `${period}-${String(l.due_day).padStart(2, "0")}`, rent: l.rent, utilities: util, carried_forward: cf,
    }], c, { asDefiner: true });
    n += 1;
  }
  return n;
}

function applyLateFees(today: string, ws: Row, c: Ctx) {
  if (ws.late_fee_type === "none" || num(ws.late_fee_value) <= 0) return 0;
  const due = t().invoices.filter((i) =>
    i.workspace_id === ws.id && i.status === "open" && num(i.late_fee) === 0
    && addDays(String(i.due_date), num(ws.grace_days)) < today && num(i.total) > paidFor(i.lease_id, i.period));
  for (const i of due) {
    const fee = ws.late_fee_type === "flat" ? num(ws.late_fee_value) : Math.round(num(i.rent) * num(ws.late_fee_value)) / 100;
    updateRows("invoices", [i], { late_fee: fee }, c, true);
  }
  return due.length;
}

/* ---------------------------------------------------------------- reminders */

function generateReminders(today: string, ws: Row, c: Ctx) {
  applyLateFees(today, ws, c);
  const period = today.slice(0, 7);
  const monthStart = `${period}-01`;
  const keep = new Set<string>();
  let n = 0;
  for (const l of t().leases) {
    if (l.workspace_id !== ws.id || l.status !== "active" || String(l.start_date) > today) continue;
    if (l.end_date && String(l.end_date) < monthStart) continue;
    const due = `${period}-${String(l.due_day).padStart(2, "0")}`;
    if (today < addDays(due, -num(ws.remind_before_days))) continue;
    const inv = t().invoices.find((i) => i.lease_id === l.id && i.period === period && i.status === "open");
    const owed = (inv ? num(inv.total) : num(l.rent)) - paidFor(l.id, period);
    if (owed <= 0) continue;
    const kind = today < due ? "upcoming" : today === due ? "due" : "overdue";
    const hit = t().reminders.find((r) => r.lease_id === l.id && r.period === period && r.for_date === today);
    if (hit) {
      updateRows("reminders", [hit], { amount: owed, kind }, c, true);
      keep.add(String(hit.id));
    } else {
      const [row] = insertRows("reminders", [{ workspace_id: ws.id, lease_id: l.id, period, kind, for_date: today, amount: owed }], c, { asDefiner: true });
      if (row) keep.add(String(row.id));
    }
    n += 1;
  }
  // Drop today's pending drafts that are no longer owed (e.g. after a payment).
  const stale = t().reminders.filter(
    (r) => r.workspace_id === ws.id && r.for_date === today && r.period === period && !keep.has(String(r.id)) && (r.status === "pending" || !r.status),
  );
  if (stale.length) deleteRows("reminders", stale, c, true);
  return n;
}

function my_reminders(a: Args, c: Ctx) {
  if (!c.ws) return 0;
  const real = todayISO();
  let today = typeof a.p_today === "string" ? a.p_today : real;
  if (today < addDays(real, -1) || today > addDays(real, 1)) today = real;
  return generateReminders(today, workspace(c), c);
}

/* -------------------------------------------------------------------- teams */

function invite_info(a: Args) {
  const tok = String(a.p_token ?? "");
  if (tok.length < 32) return null;
  const i = t().invites.find((x) => x.token === tok);
  if (!i) return null;
  const w = t().workspaces.find((x) => x.id === i.workspace_id);
  return { workspace: w?.name, role: i.role, email: i.email, valid: !i.accepted_at && String(i.expires_at) > new Date().toISOString() };
}

function accept_invite(a: Args, c: Ctx) {
  needUser(c);
  const i = t().invites.find((x) => x.token === a.p_token);
  if (!i || i.accepted_at || String(i.expires_at) < new Date().toISOString()) throw new MockError("This invite link is invalid or has expired");
  if (t().workspaces.some((w) => w.owner_id === c.uid)) {
    throw new MockError("This account already has its own workspace. Sign in with a different email to join as a team member.");
  }
  const email = (c.email ?? "").toLowerCase();
  if (i.email && String(i.email).toLowerCase() !== email) throw new MockError("This invite was sent to a different email address");
  const existing = t().members.find((m) => m.workspace_id === i.workspace_id && m.user_id === c.uid);
  if (existing) updateRows("members", [existing], { role: i.role }, c, true);
  else insertRows("members", [{ workspace_id: i.workspace_id, user_id: c.uid, email: email || null, role: i.role }], c, { asDefiner: true });
  updateRows("invites", [i], { accepted_at: new Date().toISOString(), accepted_by: c.uid }, c, true);
  return i.workspace_id;
}

/* ------------------------------------------------------------- tenant portal */

function set_tenant_portal(a: Args, c: Ctx) {
  needUser(c);
  if (!canWrite(c)) throw new MockError("Not allowed");
  const tenant = t().tenants.find((x) => x.id === a.p_tenant && x.workspace_id === c.ws);
  if (!tenant) return null;
  const token = a.p_enabled ? token64() : null;
  updateRows("tenants", [tenant], { portal_token: token }, c, true);
  return token;
}

function portalTenant(tok: string) {
  if (tok.length < 32) return undefined;
  return t().tenants.find((x) => x.portal_token === tok && !x.archived_at);
}

function tenant_portal(a: Args) {
  const tenant = portalTenant(String(a.p_token ?? ""));
  if (!tenant) return null;
  const w = t().workspaces.find((x) => x.id === tenant.workspace_id)!;
  const leases = t().leases.filter((l) => l.tenant_id === tenant.id).sort((x, y) => String(y.start_date).localeCompare(String(x.start_date)));
  const ids = new Set(leases.map((l) => l.id));
  return {
    tenant: { name: tenant.name },
    landlord: { name: w.name, upi_id: w.upi_id, currency: w.currency, locale: w.locale },
    leases: leases.map((l) => {
      const u = t().units.find((x) => x.id === l.unit_id)!;
      const p = t().properties.find((x) => x.id === u.property_id)!;
      return {
        id: l.id, property: p.name, unit: u.label, pass_colour: u.pass_colour, rent: l.rent, deposit: l.deposit,
        due_day: l.due_day, start_date: l.start_date, end_date: l.end_date, status: l.status,
      };
    }),
    invoices: t().invoices.filter((i) => ids.has(i.lease_id) && i.status === "open")
      .sort((x, y) => String(y.period).localeCompare(String(x.period)))
      .map(({ invoice_no, lease_id, period, due_date, rent, utilities, late_fee, other, carried_forward, total }) =>
        ({ invoice_no, lease_id, period, due_date, rent, utilities, late_fee, other, carried_forward, total })),
    payments: t().payments.filter((p) => ids.has(p.lease_id))
      .sort((x, y) => String(y.paid_at).localeCompare(String(x.paid_at))).slice(0, 36)
      .map(({ receipt_no, amount, period, method, paid_at, verify_token, lease_id }) => ({ receipt_no, amount, period, method, paid_at, verify_token, lease_id })),
    requests: t().tasks.filter((k) => k.tenant_id === tenant.id && k.source === "tenant")
      .sort((x, y) => String(y.created_at).localeCompare(String(x.created_at))).slice(0, 20)
      .map(({ title, details, status, created_at }) => ({ title, details, status, created_at })),
  };
}

function tenant_raise_request(a: Args, c: Ctx) {
  const tenant = portalTenant(String(a.p_token ?? ""));
  if (!tenant) throw new MockError("Portal link not found");
  const title = String(a.p_title ?? "").trim();
  if (title.length < 3) throw new MockError("Please describe the issue");
  const open = t().tasks.filter((k) => k.tenant_id === tenant.id && k.source === "tenant" && k.status !== "done").length;
  if (open >= 10) throw new MockError("You have 10 open requests already. Please wait for some to be resolved.");
  const lease = t().leases.filter((l) => l.tenant_id === tenant.id && l.status === "active")
    .sort((x, y) => String(y.start_date).localeCompare(String(x.start_date)))[0];
  const unit = lease && t().units.find((u) => u.id === lease.unit_id);
  const details = String(a.p_details ?? "").trim();
  insertRows("tasks", [{
    workspace_id: tenant.workspace_id, property_id: unit?.property_id ?? null, tenant_id: tenant.id, title: title.slice(0, 140),
    details: details ? details.slice(0, 2000) : null, priority: "medium", status: "open", source: "tenant",
  }], { ...c, email: c.email ?? "tenant portal" }, { asDefiner: true });
  return null;
}

/* ----------------------------------------------------------------- registry */

export const RPC: Record<string, { fn: (a: Args, c: Ctx) => unknown; anon?: boolean; writes?: boolean }> = {
  my_workspace_id: { fn: (_a, c) => c.ws },
  my_role: { fn: (_a, c) => c.role },
  can_write: { fn: (_a, c) => canWrite(c) },
  record_payment: { fn: record_payment, writes: true },
  verify_receipt: { fn: verify_receipt, anon: true },
  generate_invoices: { fn: generate_invoices, writes: true },
  my_reminders: { fn: my_reminders, writes: true },
  invite_info: { fn: invite_info, anon: true },
  accept_invite: { fn: accept_invite, writes: true },
  set_tenant_portal: { fn: set_tenant_portal, writes: true },
  tenant_portal: { fn: tenant_portal, anon: true },
  tenant_raise_request: { fn: tenant_raise_request, anon: true, writes: true },
};
