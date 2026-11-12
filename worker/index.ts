// Cloudflare Worker entry (see wrangler.jsonc). Static files in dist/ are served by Workers
// Static Assets with single-page-app fallback; only /api/* runs this code (run_worker_first).
import { handleAssist } from "../server/assist.js";
import { stringEnv } from "../server/env.js";
import { bad } from "../server/http.js";
import { handleReconcile } from "../server/reconcile.js";
import { logReminderResult, runDailyReminders } from "../server/reminders.js";

interface Fetcher { fetch(req: Request): Promise<Response> }
interface ExecutionContext { waitUntil(p: Promise<unknown>): void }
export interface WorkerEnv { ASSETS?: Fetcher; [key: string]: unknown }

export default {
  async fetch(req: Request, env: WorkerEnv): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === "/api/assist") return handleAssist(req, stringEnv(env));
    if (pathname === "/api/reconcile") return handleReconcile(req, stringEnv(env));
    if (pathname.startsWith("/api/")) return bad(404, "Not found.");
    if (env.ASSETS) return env.ASSETS.fetch(req);
    return new Response("Not found", { status: 404 });
  },

  // Cron Trigger from wrangler.jsonc: 06:00 IST daily. Uses the Supabase REST API (no TCP Postgres on Workers).
  async scheduled(_controller: unknown, env: WorkerEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runDailyReminders(stringEnv(env)).then(logReminderResult));
  },
};
