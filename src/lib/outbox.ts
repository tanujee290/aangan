// Offline capture. Payments, expenses and new tasks entered without a connection are kept
// in this device's storage and sent to Supabase, in order, once the app is back online.
// Receipt numbers are still issued by record_payment() at sync time, so numbering stays sequential.
import { useSyncExternalStore } from "react";
import { supabase, errorMessage } from "./supabase";
import { isOnline } from "./network";

export type OutboxKind = "payment" | "expense" | "task";
export interface OutboxItem {
  id: string;
  kind: OutboxKind;
  /** Short human description, e.g. "₹18,500 from Kavya Iyer". */
  label: string;
  payload: Record<string, unknown>;
  created_at: string;
  /** The Supabase user who captured it; only that user's session ever sends it. */
  user: string;
  /** Set when the server rejected the item; it then waits for the user instead of retrying forever. */
  error?: string;
}

const KEY = "angan.outbox.v1";
let items: OutboxItem[] = load();
const listeners = new Set<() => void>();

function load(): OutboxItem[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}
function save(next: OutboxItem[]) {
  items = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage full or blocked */ }
  listeners.forEach((l) => l());
}
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => { if (e.key === KEY) { items = load(); listeners.forEach((l) => l()); } });
}

const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

/** The signed-in user's queued items. */
export function useOutbox(userId: string | undefined) {
  const all = useSyncExternalStore(subscribe, () => items, () => items);
  return userId ? all.filter((i) => i.user === userId) : [];
}

/** True for errors that mean "no connection" rather than "the server said no". */
export function isNetworkError(err: unknown) {
  if (!isOnline()) return true;
  return /failed to fetch|load failed|networkerror|network request failed|fetch failed/i.test(errorMessage(err));
}

/** Offline capture works on both backends; the mock one can also simulate an outage. */
export const offlineCapture = true;

export async function enqueue(kind: OutboxKind, label: string, payload: Record<string, unknown>) {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user.id;
  if (!user) throw new Error("Your session has ended. Sign in again to save this.");
  save([...items, { id: crypto.randomUUID(), kind, label, payload, created_at: new Date().toISOString(), user }]);
}

export function discard(id: string) {
  save(items.filter((i) => i.id !== id));
}

async function send(item: OutboxItem) {
  const p = item.payload;
  const res = item.kind === "payment"
    ? await supabase.rpc("record_payment", p)
    : await supabase.from(item.kind === "expense" ? "expenses" : "tasks").insert(p);
  if (res.error) throw res.error;
}

let flushing = false;
/** Sends queued items in order. Returns how many were saved. Stops at the first network failure. */
export async function flush(): Promise<number> {
  if (flushing || items.length === 0 || !isOnline()) return 0;
  flushing = true;
  let sent = 0;
  try {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user.id;
    if (!user) return 0;
    for (const item of [...items]) {
      if (item.error || item.user !== user) continue;
      try {
        await send(item);
        save(items.filter((i) => i.id !== item.id));
        sent++;
      } catch (err) {
        if (isNetworkError(err)) break;
        save(items.map((i) => (i.id === item.id ? { ...i, error: errorMessage(err) } : i)));
      }
    }
  } finally {
    flushing = false;
  }
  return sent;
}

export function retry(id: string) {
  save(items.map((i) => (i.id === id ? { ...i, error: undefined } : i)));
  return flush();
}
