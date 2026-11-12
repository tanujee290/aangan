// The mock Supabase "server": table definitions, row-level security, triggers and writes.
// It mirrors supabase/migrations/*.sql closely enough that every screen behaves as it would
// against the real database, including roles, sequential numbers, cascades and the audit log.
import { todayISO } from "../format";
import { getDB, restore, save, snapshot, type Row, type TableName } from "./store";

export interface PgError { message: string; code: string; details: string | null; hint: string | null }
export class MockError extends Error {
  code: string;
  constructor(message: string, code = "P0001") {
    super(message);
    this.code = code;
  }
  toJSON(): PgError {
    return { message: this.message, code: this.code, details: null, hint: null };
  }
}

/* ------------------------------------------------------------------ context */

export interface Ctx {
  uid: string | null;
  email: string | null;
  /** my_workspace_id(): the workspace the caller owns, otherwise the first one they joined. */
  ws: string | null;
  role: "owner" | "manager" | "viewer" | null;
  /** Lets security-definer RPCs bump receipt and invoice numbers. */
  allowSeq?: boolean;
}

export function context(uid: string | null): Ctx {
  const db = getDB();
  const user = uid ? db.users.find((u) => u.id === uid) : undefined;
  if (!user) return { uid: null, email: null, ws: null, role: null };
  const owned = db.tables.workspaces.find((w) => w.owner_id === user.id);
  if (owned) return { uid: user.id, email: user.email, ws: owned.id as string, role: "owner" };
  const member = db.tables.members
    .filter((m) => m.user_id === user.id)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0];
  return {
    uid: user.id, email: user.email,
    ws: (member?.workspace_id as string) ?? null,
    role: (member?.role as Ctx["role"]) ?? null,
  };
}

const canWrite = (c: Ctx) => c.role === "owner" || c.role === "manager";
const ownsWs = (c: Ctx, wsId: unknown) => !!c.uid && getDB().tables.workspaces.some((w) => w.id === wsId && w.owner_id === c.uid);

/* ------------------------------------------------------------------- schema */

export const uuid = () =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (ch) =>
        (Number(ch) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(ch) / 4)))).toString(16));
export const token64 = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
const now = () => new Date().toISOString();
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const blank = (v: unknown) => typeof v !== "string" || v.trim().length === 0;

interface TableDef {
  defaults?: (c: Ctx) => Row;
  numeric?: Record<string, number>;
  unique?: string[][];
  generated?: (r: Row) => Row;
  check?: (r: Row) => string | null;
  fks?: [col: string, table: TableName][];
  /** Composite primary key for tables without an id column. */
  pk?: string[];
}

const scoped = (c: Ctx): Row => ({ id: uuid(), workspace_id: c.ws, created_at: now() });

const SCHEMA: Record<TableName, TableDef> = {
  workspaces: {
    defaults: (c) => ({
      id: uuid(), owner_id: c.uid, currency: "INR", locale: "en-IN", upi_id: null, invoice_prefix: "ANG", receipt_seq: 0,
      created_at: now(), invoice_seq: 0, remind_before_days: 3, grace_days: 3, late_fee_type: "none", late_fee_value: "0.00",
    }),
    numeric: { late_fee_value: 2 },
    unique: [["owner_id"]],
    check: (r) =>
      blank(r.name) ? "Please enter a name."
      : Number(r.remind_before_days) < 0 || Number(r.remind_before_days) > 15 ? "Reminder lead time must be 0–15 days."
      : Number(r.grace_days) < 0 || Number(r.grace_days) > 31 ? "Grace period must be 0–31 days."
      : !["none", "flat", "percent"].includes(String(r.late_fee_type)) || Number(r.late_fee_value) < 0 ? "Check the late fee settings."
      : null,
  },
  members: { defaults: () => ({ created_at: now(), role: "viewer", email: null }), pk: ["workspace_id", "user_id"] },
  invites: {
    defaults: (c) => ({
      ...scoped(c), email: null, role: "viewer", token: token64(),
      expires_at: new Date(Date.now() + 14 * 864e5).toISOString(), accepted_at: null, accepted_by: null,
    }),
    unique: [["token"]],
  },
  properties: {
    defaults: (c) => ({ ...scoped(c), type: "Apartment", address: null, archived_at: null, cover_path: null }),
    check: (r) =>
      blank(r.name) ? "Please give the property a name."
      : !["Apartment", "Villa", "House", "Commercial", "PG/Hostel", "Other"].includes(String(r.type)) ? "Unknown property type." : null,
  },
  units: {
    defaults: (c) => ({ ...scoped(c), pass_colour: null, archived_at: null }),
    check: (r) => (blank(r.label) ? "Each unit needs a label." : null),
    fks: [["property_id", "properties"]],
  },
  tenants: {
    defaults: (c) => ({ ...scoped(c), phone_whatsapp: null, email: null, upi_id: null, archived_at: null, portal_token: null }),
    unique: [["portal_token"]],
    check: (r) => (blank(r.name) ? "Please enter the tenant's name." : null),
  },
  leases: {
    defaults: (c) => ({ ...scoped(c), deposit: "0.00", due_day: 5, end_date: null, status: "active" }),
    numeric: { rent: 2, deposit: 2 },
    fks: [["unit_id", "units"], ["tenant_id", "tenants"]],
    check: (r) =>
      !r.start_date ? "Please pick a start date."
      : Number(r.rent) < 0 || Number(r.deposit) < 0 ? "Rent and deposit can't be negative."
      : !(Number(r.due_day) >= 1 && Number(r.due_day) <= 28) ? "The due day must be between 1 and 28."
      : r.end_date && String(r.end_date) < String(r.start_date) ? "The end date can't be before the start date."
      : !["active", "ended"].includes(String(r.status)) ? "Unknown lease status." : null,
  },
  payments: {
    defaults: (c) => ({ ...scoped(c), method: "upi", reference: null, note: null, paid_at: now() }),
    numeric: { amount: 2 },
    unique: [["verify_token"], ["workspace_id", "receipt_no"]],
    fks: [["lease_id", "leases"]],
    check: (r) =>
      !(Number(r.amount) > 0) ? "The amount must be more than zero."
      : !PERIOD.test(String(r.period)) ? "Pick a valid month."
      : !["upi", "bank", "cash", "cheque", "card", "other"].includes(String(r.method)) ? "Unknown payment method." : null,
  },
  tasks: {
    defaults: (c) => ({ ...scoped(c), property_id: null, priority: "medium", status: "open", vendor: null, tenant_id: null, details: null, source: "landlord" }),
    check: (r) =>
      blank(r.title) ? "Please give the task a title."
      : !["low", "medium", "high", "urgent"].includes(String(r.priority)) ? "Unknown priority."
      : !["open", "in_progress", "done"].includes(String(r.status)) ? "Unknown status." : null,
  },
  expenses: {
    defaults: (c) => ({ ...scoped(c), property_id: null, spent_on: todayISO(), note: null }),
    numeric: { amount: 2 },
    check: (r) => (blank(r.category) ? "Pick a category." : !(Number(r.amount) > 0) ? "The amount must be more than zero." : null),
  },
  invoices: {
    defaults: (c) => ({ ...scoped(c), rent: "0.00", utilities: "0.00", late_fee: "0.00", other: "0.00", carried_forward: "0.00", status: "open", note: null }),
    numeric: { rent: 2, utilities: 2, late_fee: 2, other: 2, carried_forward: 2 },
    unique: [["lease_id", "period"], ["workspace_id", "invoice_no"]],
    fks: [["lease_id", "leases"]],
    generated: (r) => ({
      total: (Number(r.rent) + Number(r.utilities) + Number(r.late_fee) + Number(r.other) + Number(r.carried_forward)).toFixed(2),
    }),
    check: (r) =>
      Number(r.late_fee) < 0 ? "The late fee can't be negative."
      : !["open", "void"].includes(String(r.status)) ? "Unknown invoice status." : null,
  },
  meter_readings: {
    defaults: (c) => scoped(c),
    numeric: { previous: 2, current: 2, rate: 4 },
    unique: [["unit_id", "kind", "period"]],
    fks: [["unit_id", "units"]],
    generated: (r) => ({ amount: (Math.round((Number(r.current) - Number(r.previous)) * Number(r.rate) * 100) / 100).toFixed(2) }),
    check: (r) =>
      !["electric", "water"].includes(String(r.kind)) ? "Unknown meter type."
      : !PERIOD.test(String(r.period)) ? "Pick a valid month."
      : Number(r.previous) < 0 || Number(r.rate) < 0 ? "Readings and rates can't be negative."
      : Number(r.current) < Number(r.previous) ? "The current reading can't be below the previous one." : null,
  },
  deposit_txns: {
    defaults: (c) => ({ ...scoped(c), txn_date: todayISO(), note: null }),
    numeric: { amount: 2 },
    fks: [["lease_id", "leases"]],
    check: (r) =>
      !["received", "deduction", "refund"].includes(String(r.type)) ? "Unknown deposit entry."
      : !(Number(r.amount) > 0) ? "The amount must be more than zero." : null,
  },
  documents: {
    defaults: (c) => ({ ...scoped(c), property_id: null, tenant_id: null, kind: "other", size: null, mime: null }),
    unique: [["path"]],
    check: (r) => (blank(r.name) ? "Please name the document." : null),
  },
  reminders: {
    defaults: (c) => ({ ...scoped(c), amount: "0.00", status: "pending", acted_at: null }),
    numeric: { amount: 2 },
    unique: [["lease_id", "period", "for_date"]],
    fks: [["lease_id", "leases"]],
    check: (r) => (!["pending", "sent", "skipped"].includes(String(r.status)) ? "Unknown reminder status." : null),
  },
  audit_events: { defaults: () => ({ at: now(), actor: null, actor_email: null, entity_id: null, summary: null }) },
  bank_lines: {
    defaults: (c) => ({
      ...scoped(c), statement: "Statement", description: "", reference: null, status: "unmatched",
      payment_id: null, expense_id: null, matched_by: null, matched_at: null,
    }),
    numeric: { amount: 2 },
    unique: [["workspace_id", "fingerprint"], ["payment_id"], ["expense_id"]],
    check: (r) => (Number(r.amount) === 0 || !r.txn_date ? "Each bank line needs a date and a non-zero amount." : null),
  },
};

/** Rows that point at a deleted row: removed with it, or their link cleared. */
const CASCADE: Partial<Record<TableName, { table: TableName; col: string; action: "delete" | "null" }[]>> = {
  properties: [
    { table: "units", col: "property_id", action: "delete" }, { table: "tasks", col: "property_id", action: "null" },
    { table: "expenses", col: "property_id", action: "null" }, { table: "documents", col: "property_id", action: "null" },
  ],
  units: [{ table: "leases", col: "unit_id", action: "delete" }, { table: "meter_readings", col: "unit_id", action: "delete" }],
  tenants: [
    { table: "leases", col: "tenant_id", action: "delete" }, { table: "tasks", col: "tenant_id", action: "null" },
    { table: "documents", col: "tenant_id", action: "null" },
  ],
  leases: [
    { table: "payments", col: "lease_id", action: "delete" }, { table: "invoices", col: "lease_id", action: "delete" },
    { table: "deposit_txns", col: "lease_id", action: "delete" }, { table: "reminders", col: "lease_id", action: "delete" },
  ],
  payments: [{ table: "bank_lines", col: "payment_id", action: "null" }],
  expenses: [{ table: "bank_lines", col: "expense_id", action: "null" }],
};

const AUDITED = new Set<string>([
  "workspaces", "properties", "units", "tenants", "leases", "payments", "tasks", "expenses",
  "invoices", "meter_readings", "deposit_txns", "documents", "members",
]);

/* ---------------------------------------------------------- row-level security */

type Op = "select" | "insert" | "update" | "delete";

/** True when the policies on `table` allow `op` on `row` for this caller. */
export function allowed(table: TableName, op: Op, row: Row, c: Ctx): boolean {
  if (!c.uid) return false;
  const inWs = !!c.ws && row.workspace_id === c.ws;
  switch (table) {
    case "workspaces":
      return op === "select" ? row.owner_id === c.uid || row.id === c.ws : row.owner_id === c.uid;
    case "members":
      if (op === "select") return inWs;
      if (op === "update") return ownsWs(c, row.workspace_id);
      if (op === "delete") return row.user_id === c.uid || ownsWs(c, row.workspace_id);
      return false; // members are only added through accept_invite()
    case "invites":
      return ownsWs(c, row.workspace_id);
    case "audit_events":
      return op === "select" && inWs;
    case "payments":
      return op === "select" ? inWs : op === "delete" ? inWs && canWrite(c) : false; // created only by record_payment()
    case "invoices":
      return op === "select" ? inWs : op === "insert" ? false : inWs && canWrite(c); // created only by generate_invoices()
    default:
      return op === "select" ? inWs : inWs && canWrite(c);
  }
}

const rlsError = (table: string) => new MockError(`new row violates row-level security policy for table "${table}"`, "42501");

/* ------------------------------------------------------------------- writes */

function normalise(table: TableName, row: Row) {
  const def = SCHEMA[table];
  for (const [col, scale] of Object.entries(def.numeric ?? {})) {
    const v = row[col];
    if (v === undefined || v === null || v === "") continue;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new MockError(`invalid input syntax for type numeric: "${String(v)}"`, "22P02");
    row[col] = n.toFixed(scale);
  }
  if (def.generated) Object.assign(row, def.generated(row));
}

function triggers(table: TableName, row: Row, old: Row | null, c: Ctx) {
  if (table === "workspaces" && old) {
    if (!c.allowSeq) {
      row.receipt_seq = old.receipt_seq;
      row.invoice_seq = old.invoice_seq;
    }
    row.owner_id = old.owner_id;
  }
  if (table === "bank_lines") {
    if (row.payment_id || row.expense_id) {
      row.status = "matched";
      row.matched_at ??= now();
    } else if (row.status === "matched") {
      row.status = "unmatched";
    }
    if (row.status === "unmatched") {
      row.matched_by = null;
      row.matched_at = null;
    }
  }
}

function validate(table: TableName, row: Row, self: Row | null) {
  const def = SCHEMA[table];
  const msg = def.check?.(row);
  if (msg) throw new MockError(msg, "23514");
  const rows = getDB().tables[table];
  for (const cols of def.unique ?? []) {
    if (cols.some((col) => row[col] === null || row[col] === undefined)) continue;
    if (rows.some((r) => r !== self && cols.every((col) => r[col] === row[col]))) {
      throw new MockError(`duplicate key value violates unique constraint "${table}_${cols.join("_")}_key"`, "23505");
    }
  }
  for (const [col, ref] of def.fks ?? []) {
    if (row[col] == null) continue;
    if (!getDB().tables[ref].some((r) => r.id === row[col] && r.workspace_id === row.workspace_id)) {
      throw new MockError(`insert or update on table "${table}" violates foreign key constraint on ${col}`, "23503");
    }
  }
}

const summaryOf = (r: Row) =>
  (["name", "label", "title", "receipt_no", "invoice_no", "email", "category", "type", "kind"]
    .map((k) => r[k]).find((v) => typeof v === "string" && v) as string | undefined)?.slice(0, 140) ?? null;

function audit(table: TableName, action: "insert" | "update" | "delete", row: Row, old: Row | null, c: Ctx) {
  if (table === "bank_lines") {
    if (action === "update" && old?.status !== row.status && row.status === "matched") {
      pushAudit(row.workspace_id, c, "bank_lines", row.id as string, "reconcile", `${row.txn_date} · ${row.amount} · ${row.description}`.slice(0, 140));
    }
    return;
  }
  if (!AUDITED.has(table)) return;
  const ws = (row.workspace_id ?? (table === "workspaces" ? row.id : null)) as string | null;
  if (!ws) return;
  let act: string = action;
  if (action === "update" && old) {
    const strip = (r: Row) => JSON.stringify({ ...r, receipt_seq: 0, invoice_seq: 0 });
    if (strip(old) === strip(row)) return;
    if (!old.archived_at && row.archived_at) act = "archive";
    else if (old.archived_at && !row.archived_at) act = "restore";
  }
  pushAudit(ws, c, table, typeof row.id === "string" ? row.id : null, act, summaryOf(row));
}

function pushAudit(ws: unknown, c: Ctx, entity: string, entityId: string | null, action: string, summary: string | null) {
  const db = getDB();
  db.tables.audit_events.push({
    id: db.audit_seq++, workspace_id: ws, actor: c.uid, actor_email: c.email, entity, entity_id: entityId, action, summary, at: now(),
  });
}

/** Runs `fn` as one transaction: on any error the database is left exactly as it was. */
export function transaction<T>(fn: () => T): T {
  const before = snapshot();
  try {
    const out = fn();
    save();
    return out;
  } catch (e) {
    restore(before);
    throw e;
  }
}

/** Inserts rows with defaults, triggers, constraints and the audit trail. Policies apply unless `asDefiner`. */
export function insertRows(table: TableName, input: Row[], c: Ctx, opts: { asDefiner?: boolean; upsert?: { onConflict: string[]; ignoreDuplicates: boolean } } = {}): Row[] {
  const out: Row[] = [];
  const rows = getDB().tables[table];
  for (const raw of input) {
    const row: Row = { ...(SCHEMA[table].defaults?.(c) ?? {}), ...stripGenerated(table, raw) };
    if (opts.upsert) {
      const cols = opts.upsert.onConflict;
      const hit = rows.find((r) => cols.every((col) => r[col] === row[col]));
      if (hit) {
        if (opts.upsert.ignoreDuplicates) continue;
        out.push(...updateRows(table, [hit], stripGenerated(table, raw), c, opts.asDefiner));
        continue;
      }
    }
    normalise(table, row);
    triggers(table, row, null, c);
    if (!opts.asDefiner && !allowed(table, "insert", row, c)) throw rlsError(table);
    validate(table, row, null);
    rows.push(row);
    audit(table, "insert", row, null, c);
    out.push(row);
  }
  return out;
}

function stripGenerated(table: TableName, raw: Row): Row {
  const r = { ...raw };
  if (table === "invoices") delete r.total;
  if (table === "meter_readings") delete r.amount;
  return r;
}

export function updateRows(table: TableName, targets: Row[], patch: Row, c: Ctx, asDefiner = false): Row[] {
  const rows = getDB().tables[table];
  const clean = stripGenerated(table, patch);
  const out: Row[] = [];
  for (const target of targets) {
    if (!asDefiner && !allowed(table, "update", target, c)) continue;
    const old = { ...target };
    const next: Row = { ...target, ...clean };
    normalise(table, next);
    triggers(table, next, old, c);
    if (!asDefiner && !allowed(table, "update", next, c)) throw rlsError(table);
    validate(table, next, target);
    const i = rows.indexOf(target);
    rows[i] = next;
    audit(table, "update", next, old, c);
    out.push(next);
  }
  return out;
}

export function deleteRows(table: TableName, targets: Row[], c: Ctx, asDefiner = false): Row[] {
  const db = getDB();
  const out: Row[] = [];
  for (const target of targets) {
    if (!asDefiner && !allowed(table, "delete", target, c)) continue;
    const i = db.tables[table].indexOf(target);
    if (i < 0) continue;
    db.tables[table].splice(i, 1);
    audit(table, "delete", target, null, c);
    out.push(target);
    for (const rule of CASCADE[table] ?? []) {
      const children = db.tables[rule.table].filter((r) => r[rule.col] === target.id);
      if (rule.action === "delete") deleteRows(rule.table, children, c, true);
      else updateRows(rule.table, children, { [rule.col]: null }, c, true);
    }
  }
  return out;
}
