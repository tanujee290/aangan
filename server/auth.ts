import { supabaseEnv, type Env } from "./env.js";

/**
 * Checks the caller's Supabase access token.
 * Returns null when Supabase isn't connected (the site runs as a sample-data preview),
 * true for a valid session and false otherwise.
 */
export async function signedIn(req: Request, env: Env): Promise<boolean | null> {
  const { url, anonKey, configured } = supabaseEnv(env);
  if (!configured) return null;
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ") || auth.length < 20) return false;
  try {
    const res = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: auth } });
    return res.ok;
  } catch {
    return false;
  }
}
