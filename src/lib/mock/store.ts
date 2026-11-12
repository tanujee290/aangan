// Persistence for the mock Supabase backend. The whole "database" is one JSON document in
// localStorage (Aangan targets 1–50 units, so it stays small); uploaded files go to IndexedDB.
// It is seeded with the fictional sample workspace from ../demo.ts on first use.
import { demoData } from "../demo";

export type Row = Record<string, unknown>;

export interface MockUser {
  id: string;
  email: string;
  /** null for accounts created through a magic link. */
  password: string | null;
  created_at: string;
  /** Sign-in methods linked to the account, like auth.identities. Missing means ["email"]. */
  providers?: string[];
  /** Display name from an OAuth provider. */
  name?: string | null;
}

/** An email the mock "sent". Shown in the mock inbox (/mock/inbox) instead of being delivered. */
export interface MockMail {
  id: string;
  to: string;
  subject: string;
  body: string;
  /** The link inside the email. */
  link: string;
  /** token_hash for verifyOtp(). */
  token: string;
  type: "magiclink";
  sent_at: string;
  expires_at: string;
  used_at: string | null;
}

export interface MockDB {
  version: number;
  seeded_at: string;
  users: MockUser[];
  /** The signed-in user's id, if any. */
  session: string | null;
  tables: Record<string, Row[]>;
  audit_seq: number;
  /** Emails sent by the mock auth service, newest first. */
  mail?: MockMail[];
}

const KEY = "angan.mock-supabase.v1";
const VERSION = 1;

export const MOCK_PASSWORD = "angan-demo";
export const MOCK_OWNER_EMAIL = "preview@angan.app";
export const MOCK_MANAGER_EMAIL = "caretaker@example.com";

export const TABLES = [
  "workspaces", "members", "invites", "properties", "units", "tenants", "leases", "payments", "tasks", "expenses",
  "invoices", "meter_readings", "deposit_txns", "documents", "reminders", "audit_events", "bank_lines",
] as const;
export type TableName = (typeof TABLES)[number];

let db: MockDB | null = null;
const external = new Set<(before: MockDB) => void>();

// Each tab keeps the database in memory. When another tab writes, reload it so the two never overwrite each other.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY || !db) return;
    const before = db;
    db = load() ?? seed();
    for (const cb of external) cb(before);
  });
}

export function onExternalChange(cb: (before: MockDB) => void) {
  external.add(cb);
  return () => external.delete(cb);
}

export function getDB(): MockDB {
  if (!db) db = load() ?? seed();
  return db;
}

export function save() {
  if (!db) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    // Storage full or blocked (private mode): keep working in memory for this tab.
  }
}

/** Swap the in-memory database (used to roll back a failed write). */
export function restore(snapshot: MockDB) {
  db = snapshot;
}

export function snapshot(): MockDB {
  return structuredClone(getDB());
}

/** Wipes the mock database and uploaded files; the next read re-seeds the sample workspace. */
export async function resetMockDatabase() {
  try {
    localStorage.removeItem(KEY);
  } catch { /* ignore */ }
  db = null;
  await clearFiles();
}

function load(): MockDB | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MockDB;
    if (parsed.version !== VERSION || !parsed.tables) return null;
    for (const t of TABLES) parsed.tables[t] ??= [];
    parsed.mail ??= [];
    return parsed;
  } catch {
    return null;
  }
}

function seed(): MockDB {
  const d = demoData();
  const ws = d.workspace!;
  const created = ws.created_at;
  const WS = ws.id;
  const scoped = (rows: object[], extra: Row = {}) =>
    rows.map((r) => ({ created_at: created, ...extra, ...(r as Row), workspace_id: WS }));

  const managerId = d.members[0]?.user_id ?? crypto.randomUUID();
  const fresh: MockDB = {
    version: VERSION,
    seeded_at: new Date().toISOString(),
    users: [
      { id: ws.owner_id, email: MOCK_OWNER_EMAIL, password: MOCK_PASSWORD, created_at: created },
      { id: managerId, email: MOCK_MANAGER_EMAIL, password: MOCK_PASSWORD, created_at: created },
    ],
    session: null,
    tables: {
      workspaces: [{ ...ws, name: "Meera Rentals" }],
      members: scoped(d.members),
      invites: scoped(d.invites, { accepted_by: null }),
      properties: scoped(d.properties),
      units: scoped(d.units),
      tenants: scoped(d.tenants),
      leases: scoped(d.leases),
      payments: d.payments.map((p) => ({ ...p, workspace_id: WS, created_at: p.paid_at })),
      tasks: scoped(d.tasks),
      expenses: scoped(d.expenses),
      invoices: scoped(d.invoices),
      meter_readings: scoped(d.meters),
      deposit_txns: scoped(d.deposits),
      documents: scoped(d.documents),
      reminders: scoped(d.reminders, { acted_at: null }),
      audit_events: d.audit.map((a) => ({ ...a, workspace_id: WS, actor: null })),
      bank_lines: [],
    },
    audit_seq: Math.max(0, ...d.audit.map((a) => a.id)) + 1,
    mail: [],
  };
  db = fresh;
  save();
  return fresh;
}

/* ------------------------------------------------------------- file storage */

const FILE_DB = "angan-mock-storage";

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FILE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("objects");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const conn = await idb();
  return new Promise<T>((resolve, reject) => {
    const req = fn(conn.transaction("objects", mode).objectStore("objects"));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).finally(() => conn.close());
}

export const files = {
  get: (key: string) => tx<Blob | undefined>("readonly", (s) => s.get(key) as IDBRequest<Blob | undefined>),
  put: (key: string, blob: Blob) => tx("readwrite", (s) => s.put(blob, key)),
  remove: (key: string) => tx("readwrite", (s) => s.delete(key)),
};

async function clearFiles() {
  try {
    await tx("readwrite", (s) => s.clear());
  } catch { /* IndexedDB unavailable */ }
}
