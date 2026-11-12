import { supabaseEnv, type Env } from "./env.js";

// Builds every workspace's reminder list each morning (06:00 IST) by calling
// generate_reminders() in Supabase. It also applies late fees past the grace period.
// pg_cron inside Supabase does the same job when available; running both is harmless
// because reminders are unique per lease, period and day.
//
// Two ways to reach the database, tried in order:
// 1. Supabase REST RPC with SUPABASE_SERVICE_ROLE_KEY: plain fetch, works on every host (incl. Cloudflare Workers).
// 2. A direct Postgres connection with SUPABASE_DB_URL: Node hosts only (Netlify, Vercel), passed in as `viaSql`.

export type ReminderResult =
  | { ok: true; via: "rest" | "sql"; rows: number }
  | { ok: false; via: "rest" | "sql" | "none"; error: string };

export type SqlRunner = (dbUrl: string, today: string) => Promise<number>;

/** Today's date in India, as YYYY-MM-DD. */
export function istDate(now = new Date()) {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

export async function runDailyReminders(env: Env, opts: { viaSql?: SqlRunner; now?: Date } = {}): Promise<ReminderResult> {
  const today = istDate(opts.now);
  const { url } = supabaseEnv(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (url && serviceKey) {
    try {
      const headers: Record<string, string> = { apikey: serviceKey, "Content-Type": "application/json" };
      // Legacy service_role keys are JWTs and go in Authorization too; new sb_secret_ keys must not.
      if (serviceKey.startsWith("eyJ")) headers.Authorization = `Bearer ${serviceKey}`;
      const res = await fetch(`${url}/rest/v1/rpc/generate_reminders`, {
        method: "POST",
        headers,
        body: JSON.stringify({ p_today: today }),
      });
      if (!res.ok) return { ok: false, via: "rest", error: `Supabase answered ${res.status}: ${(await res.text()).slice(0, 200)}` };
      const n = Number(await res.json());
      return { ok: true, via: "rest", rows: Number.isFinite(n) ? n : 0 };
    } catch (err) {
      return { ok: false, via: "rest", error: (err as Error).message };
    }
  }

  if (env.SUPABASE_DB_URL && opts.viaSql) {
    try {
      return { ok: true, via: "sql", rows: await opts.viaSql(env.SUPABASE_DB_URL, today) };
    } catch (err) {
      return { ok: false, via: "sql", error: (err as Error).message };
    }
  }

  return { ok: false, via: "none", error: "Neither SUPABASE_SERVICE_ROLE_KEY (with SUPABASE_URL) nor SUPABASE_DB_URL is set, nothing to do." };
}

export function logReminderResult(r: ReminderResult) {
  if (r.ok) console.log(`[daily-reminders] built ${r.rows} reminder rows (${r.via}).`);
  else if (r.via === "none") console.log(`[daily-reminders] ${r.error}`);
  else console.error(`[daily-reminders] failed (${r.via}): ${r.error}`);
}
