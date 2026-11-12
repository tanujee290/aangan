import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createMockClient } from "./mock/client";
import { onExternalChange, resetMockDatabase, MOCK_MANAGER_EMAIL, MOCK_OWNER_EMAIL, MOCK_PASSWORD } from "./mock/store";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);

/**
 * Private Supabase Storage bucket for documents. The migration creates `angan` (the original
 * name, kept so existing files stay reachable); override with VITE_SUPABASE_STORAGE_BUCKET.
 */
export const STORAGE_BUCKET = (import.meta.env.VITE_SUPABASE_STORAGE_BUCKET as string | undefined) || "angan";
/**
 * With no Supabase project connected, the app runs on a mock Supabase backend inside the browser
 * (src/lib/mock). It has the same tables, policies, triggers and RPCs as supabase/migrations,
 * keeps its data in this browser, and starts with a fictional sample workspace.
 */
export const demoMode = !supabaseConfigured;

export const supabase: SupabaseClient = demoMode
  ? (createMockClient() as unknown as SupabaseClient)
  : createClient(url!, anonKey!);

/** Sample accounts on the mock backend. */
export const MOCK_ACCOUNTS = { owner: MOCK_OWNER_EMAIL, manager: MOCK_MANAGER_EMAIL, password: MOCK_PASSWORD };

/** Signs in to one of the sample accounts on the mock backend. */
export async function signInSample(as: "owner" | "manager" = "owner") {
  return supabase.auth.signInWithPassword({ email: MOCK_ACCOUNTS[as], password: MOCK_ACCOUNTS.password });
}

/** Wipes the mock backend back to the sample workspace. */
export async function resetMock() {
  await resetMockDatabase();
  window.location.assign("/app");
}

/** Calls `cb` when another tab changes the mock database. Does nothing with a real Supabase project. */
export function onMockChange(cb: () => void): () => void {
  if (!demoMode) return () => {};
  const off = onExternalChange(cb);
  return () => { off(); };
}

export function errorMessage(err: unknown): string {
  if (!err) return "Something went wrong.";
  if (typeof err === "string") return err;
  if (typeof err === "object" && err && "message" in err) return String((err as { message: unknown }).message);
  return "Something went wrong.";
}

/** Throws the Supabase error if there is one, otherwise returns the data. */
export async function must<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data;
}
