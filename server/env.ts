// Runtime-neutral environment access. Every host (Netlify, Vercel, Cloudflare) passes its
// own variables in as a plain object, so the handlers never read process.env directly.
export type Env = Record<string, string | undefined>;

/** Copies the string values out of a Cloudflare `env` (which also holds bindings like ASSETS). */
export function stringEnv(source: Record<string, unknown>): Env {
  const out: Env = {};
  for (const [k, v] of Object.entries(source)) if (typeof v === "string") out[k] = v;
  return out;
}

/** Supabase project settings. The VITE_ names are shared with the browser build; the plain names win when set. */
export function supabaseEnv(env: Env) {
  const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
  const anonKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || "";
  return { url, anonKey, configured: Boolean(url && anonKey) };
}
