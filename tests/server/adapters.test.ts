import { describe, expect, it, vi } from "vitest";
import worker from "../../worker/index";
import * as vercelAssist from "../../api/assist";
import * as vercelReconcile from "../../api/reconcile";
import * as vercelCron from "../../api/cron/daily-reminders";
import netlifyAssist, { config as netlifyAssistConfig } from "../../netlify/functions/assist.mts";
import netlifyReconcile, { config as netlifyReconcileConfig } from "../../netlify/functions/reconcile.mts";
import { config as netlifyCronConfig } from "../../netlify/functions/daily-reminders.mts";
import { post } from "../helpers";

describe("Cloudflare Worker", () => {
  const assets = { fetch: vi.fn(async () => new Response("<html>app</html>", { headers: { "Content-Type": "text/html" } })) };

  it("routes /api/assist and /api/reconcile to the shared handlers", async () => {
    // No ANTHROPIC_API_KEY in env: the handler answers 503, proving the route reached it.
    for (const path of ["/api/assist", "/api/reconcile"]) {
      const res = await worker.fetch(post(path, {}), { ASSETS: assets });
      expect(res.status).toBe(503);
    }
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it("only passes string vars to the handlers", async () => {
    const res = await worker.fetch(new Request("https://aangan.test/api/assist"), { ASSETS: assets, ANTHROPIC_API_KEY: "k", SOME_BINDING: {} });
    expect(res.status).toBe(405);
  });

  it("answers unknown API paths with a JSON 404", async () => {
    const res = await worker.fetch(new Request("https://aangan.test/api/nope"), { ASSETS: assets });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found." });
  });

  it("serves everything else from static assets", async () => {
    const res = await worker.fetch(new Request("https://aangan.test/app/tenants"), { ASSETS: assets });
    expect(await res.text()).toContain("app");
    expect(assets.fetch).toHaveBeenCalledOnce();
  });

  it("runs the reminder job on the cron trigger", async () => {
    const waitUntil = vi.fn();
    await worker.scheduled({}, {}, { waitUntil });
    expect(waitUntil).toHaveBeenCalledOnce();
    await waitUntil.mock.calls[0][0];
  });
});

describe("Vercel Functions", () => {
  it("wires the API routes to the shared handlers", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_ANON_KEY", "");
    expect((await vercelAssist.POST(post("/api/assist", {}))).status).toBe(503);
    expect((await vercelReconcile.POST(post("/api/reconcile", {}))).status).toBe(503);
  });

  it("protects the cron route with CRON_SECRET", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret");
    const url = "https://aangan.test/api/cron/daily-reminders";
    expect((await vercelCron.GET(new Request(url))).status).toBe(401);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("SUPABASE_DB_URL", "");
    const ok = await vercelCron.GET(new Request(url, { headers: { Authorization: "Bearer cron-secret" } }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: false, via: "none" });
  });
});

describe("Netlify Functions", () => {
  it("serve the same API paths and schedule", async () => {
    expect(netlifyAssistConfig.path).toBe("/api/assist");
    expect(netlifyReconcileConfig.path).toBe("/api/reconcile");
    expect(netlifyCronConfig.schedule).toBe("30 0 * * *");
    expect((await netlifyAssist(new Request("https://aangan.test/api/assist"))).status).toBe(405);
    expect((await netlifyReconcile(new Request("https://aangan.test/api/reconcile"))).status).toBe(405);
  });
});
