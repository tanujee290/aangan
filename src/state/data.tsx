import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase, errorMessage, demoMode, onMockChange } from "../lib/supabase";
import { isNetworkError } from "../lib/outbox";
import { setFormatting, todayISO } from "../lib/format";
import type {
  AuditEvent, BankLine, DepositTxn, DocumentRow, Expense, Invite, Invoice, Lease, Member, MeterReading, Payment, Property,
  Reminder, Role, Task, Tenant, Unit, WorkspaceV2,
} from "../lib/types";
import { useAuth } from "./auth";

export interface Data {
  workspace: WorkspaceV2 | null;
  role: Role;
  /** True once the milestone 7–13 migration has been applied to the database. */
  v2: boolean;
  properties: Property[];
  units: Unit[];
  tenants: Tenant[];
  leases: Lease[];
  payments: Payment[];
  tasks: Task[];
  expenses: Expense[];
  invoices: Invoice[];
  meters: MeterReading[];
  deposits: DepositTxn[];
  documents: DocumentRow[];
  reminders: Reminder[];
  audit: AuditEvent[];
  members: Member[];
  invites: Invite[];
  /** True once the bank reconciliation migration is live. */
  recon: boolean;
  bankLines: BankLine[];
}

interface DataCtx extends Data {
  /** True when running on the in-browser mock Supabase backend (no Supabase project connected). */
  demo: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const empty: Data = {
  workspace: null, role: "owner", v2: false, properties: [], units: [], tenants: [], leases: [], payments: [], tasks: [],
  expenses: [], invoices: [], meters: [], deposits: [], documents: [], reminders: [], audit: [], members: [], invites: [], recon: false, bankLines: [],
};

const Ctx = createContext<DataCtx>({ ...empty, demo: demoMode, loading: true, error: null, refresh: async () => {} });

async function rows<T>(q: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/** Tables from the newer migration: an older database simply returns nothing. */
async function soft<T>(q: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const { data, error } = await q;
  return error ? [] : data ?? [];
}

// The last loaded workspace is kept per user so the app opens instantly on the next visit,
// then refreshes in the background. It's cleared on sign-out.
const CACHE_PREFIX = "angan.ws-cache.v1.";
function readCache(uid: string): Data | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + uid);
    return raw ? ({ ...empty, ...JSON.parse(raw) } as Data) : null;
  } catch {
    return null;
  }
}
function writeCache(uid: string, d: Data) {
  try {
    if (d.workspace) localStorage.setItem(CACHE_PREFIX + uid, JSON.stringify(d));
    else localStorage.removeItem(CACHE_PREFIX + uid);
  } catch {
    // Storage full or unavailable: the cache is only a speed-up.
  }
}
// Serialising a whole workspace blocks the main thread, so it waits for an idle moment (and is dropped on sign-out).
let cacheTimer: ReturnType<typeof setTimeout> | number | undefined;
function cancelCacheWrite() {
  if (cacheTimer === undefined) return;
  if (typeof cancelIdleCallback === "function") cancelIdleCallback(cacheTimer as number);
  clearTimeout(cacheTimer as ReturnType<typeof setTimeout>);
  cacheTimer = undefined;
}
function writeCacheLater(uid: string, d: Data) {
  cancelCacheWrite();
  const run = () => { cacheTimer = undefined; writeCache(uid, d); };
  cacheTimer = typeof requestIdleCallback === "function" ? requestIdleCallback(run, { timeout: 2000 }) : setTimeout(run, 400);
}
function clearCaches() {
  cancelCacheWrite();
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(CACHE_PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    // ignore
  }
}

async function load(): Promise<Data> {
  // Round 1: role (also tells us whether the newer schema is live) and workspace id, together.
  const [roleRes, wsIdRes] = await Promise.all([supabase.rpc("my_role"), supabase.rpc("my_workspace_id")]);
  // No connection: keep what's already on screen instead of treating it as "no workspace".
  if (roleRes.error && isNetworkError(roleRes.error)) throw roleRes.error;
  const v2 = !roleRes.error;
  if (wsIdRes.error) throw wsIdRes.error;
  const wsId = wsIdRes.data;
  if (!wsId) return { ...empty, v2 };

  // Round 2: the workspace row and every table at once (RLS already scopes them to this workspace).
  const today = todayISO();
  const wsP = supabase.from("workspaces").select("*").eq("id", wsId).maybeSingle();
  // Reminders are generated for today first, then read back.
  const remindersP = v2
    ? supabase.rpc("my_reminders", { p_today: today }).then(() =>
        soft<Reminder>(supabase.from("reminders").select("*").gte("for_date", today).order("for_date")))
    : Promise.resolve([] as Reminder[]);
  const extraP = Promise.all([
    v2
      ? Promise.all([
          soft<Invoice>(supabase.from("invoices").select("*").order("period", { ascending: false })),
          soft<MeterReading>(supabase.from("meter_readings").select("*").order("period", { ascending: false })),
          soft<DepositTxn>(supabase.from("deposit_txns").select("*").order("txn_date", { ascending: false })),
          soft<DocumentRow>(supabase.from("documents").select("*").order("created_at", { ascending: false })),
          soft<AuditEvent>(supabase.from("audit_events").select("*").order("at", { ascending: false }).limit(300)),
          soft<Member>(supabase.from("members").select("*").order("created_at")),
          soft<Invite>(supabase.from("invites").select("*").is("accepted_at", null).order("created_at", { ascending: false })),
        ])
      : Promise.resolve([[], [], [], [], [], [], []] as unknown[][]),
    // Bank reconciliation (third migration): an error means the table isn't there yet.
    v2 ? supabase.from("bank_lines").select("*").order("txn_date", { ascending: false }).limit(2000) : Promise.resolve(null),
  ]);
  const coreP = Promise.all([
    rows<Property>(supabase.from("properties").select("*").order("created_at")),
    rows<Unit>(supabase.from("units").select("*").order("label")),
    rows<Tenant>(supabase.from("tenants").select("*").order("name")),
    rows<Lease>(supabase.from("leases").select("*").order("start_date")),
    rows<Payment>(supabase.from("payments").select("*").order("paid_at", { ascending: false })),
    rows<Task>(supabase.from("tasks").select("*").order("created_at", { ascending: false })),
    rows<Expense>(supabase.from("expenses").select("*").order("spent_on", { ascending: false })),
  ]);
  // Swallow rejections of the in-flight requests if an earlier one throws first.
  for (const p of [remindersP, extraP, coreP]) Promise.resolve(p).catch(() => {});

  const { data: ws, error: wsErr } = await wsP;
  if (wsErr) throw wsErr;
  if (!ws) return { ...empty, v2 };
  const [[properties, units, tenants, leases, payments, tasks, expenses], [[invoices, meters, deposits, documents, audit, members, invites], bankRes], reminders] =
    await Promise.all([coreP, extraP, remindersP]);
  const recon = !!bankRes && !bankRes.error;
  return {
    workspace: ws as WorkspaceV2, role: v2 ? ((roleRes.data as Role) ?? "viewer") : "owner", v2,
    properties, units, tenants, leases, payments, tasks, expenses,
    invoices: invoices as Invoice[], meters: meters as MeterReading[], deposits: deposits as DepositTxn[],
    documents: documents as DocumentRow[], reminders, audit: audit as AuditEvent[],
    members: members as Member[], invites: invites as Invite[],
    recon, bankLines: recon ? ((bankRes!.data ?? []) as BankLine[]) : [],
  };
}

/**
 * Keeps the previous array (same identity) for every table whose rows didn't change, so screens that memoise on
 * `d.payments` and friends skip their work after a refresh, and an unchanged workspace causes no re-render at all.
 * `seen` remembers each table's last serialised form so a table is only stringified once per refresh.
 */
function mergeUnchanged(prev: Data, next: Data, seen: Record<string, string>): { data: Data; seen: Record<string, string> } {
  const out: Record<string, unknown> = {};
  const nextSeen: Record<string, string> = {};
  let same = true;
  for (const k of Object.keys(next) as (keyof Data)[]) {
    const v = next[k];
    const json = JSON.stringify(v);
    nextSeen[k] = json;
    if (seen[k] === json && k in prev) out[k] = prev[k];
    else { out[k] = v; same = false; }
  }
  return { data: same ? prev : (out as unknown as Data), seen: nextSeen };
}

/**
 * Loads the signed-in user's whole workspace. Aangan targets 1–50 units,
 * so two rounds of small parallel queries keep every screen instant after first load.
 * Row-level security in Supabase scopes every query to the caller's workspace.
 */
export function DataProvider({ children }: { children: ReactNode }) {
  const { session, loading: authLoading } = useAuth();
  const uid = session?.user.id ?? null;
  const [data, setData] = useState<Data>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Only the newest refresh may write, so overlapping refreshes can't put older data on screen.
  const seq = useRef(0);
  const latest = useRef<Data>(empty);
  const seen = useRef<Record<string, string>>({});

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    if (!uid) {
      latest.current = empty;
      seen.current = {};
      setData(empty);
      setLoading(false);
      return;
    }
    try {
      const next = await load();
      if (mine !== seq.current) return;
      setError(null);
      if (next.workspace) setFormatting(next.workspace.currency, next.workspace.locale);
      const merged = mergeUnchanged(latest.current, next, seen.current);
      seen.current = merged.seen;
      if (merged.data !== latest.current) { latest.current = merged.data; setData(merged.data); writeCacheLater(uid, merged.data); }
    } catch (e) {
      if (mine === seq.current) setError(errorMessage(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    if (authLoading) return;
    if (!uid) {
      clearCaches();
      refresh();
      return;
    }
    const cached = readCache(uid);
    if (cached?.workspace) {
      // Show the last known workspace straight away; fresh data replaces it in a moment.
      setFormatting(cached.workspace.currency, cached.workspace.locale);
      latest.current = cached;
      seen.current = {};
      setData(cached);
      setLoading(false);
    } else {
      latest.current = empty;
      seen.current = {};
      setData(empty);
      setLoading(true);
    }
    refresh();
  }, [uid, authLoading, refresh]);

  // On the mock backend, pick up changes made in another tab (for example a tenant portal request).
  useEffect(() => onMockChange(() => { refresh(); }), [refresh]);

  // Coming back to the app after a while: refresh quietly so it's current without a reload.
  useEffect(() => {
    if (!uid) return;
    let hiddenAt = 0;
    const onVis = () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 60_000) refresh().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [uid, refresh]);

  const value = useMemo(() => ({ ...data, demo: demoMode, loading: loading || authLoading, error, refresh }), [data, loading, authLoading, error, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useData = () => useContext(Ctx);

/** Active (not archived) records only. */
export function useLive() {
  const d = useData();
  return useMemo(
    () => ({
      ...d,
      properties: d.properties.filter((p) => !p.archived_at),
      units: d.units.filter((u) => !u.archived_at),
      tenants: d.tenants.filter((t) => !t.archived_at),
    }),
    [d],
  );
}

/** Owners and managers can change data; viewers are read-only. */
export function useCanWrite() {
  const { role } = useData();
  return role === "owner" || role === "manager";
}
