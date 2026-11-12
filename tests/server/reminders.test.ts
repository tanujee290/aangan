import { describe, expect, it, vi } from "vitest";
import { cronAuthorized } from "../../server/cron";
import { istDate, runDailyReminders } from "../../server/reminders";

const NOW = new Date("2026-11-11T19:00:00Z"); // 00:30 on 12 Nov in India

describe("istDate", () => {
  it("uses the Indian calendar day", () => {
    expect(istDate(NOW)).toBe("2026-11-12");
    expect(istDate(new Date("2026-11-11T18:00:00Z"))).toBe("2026-11-11");
  });
});

describe("runDailyReminders", () => {
  it("calls the generate_reminders RPC with a legacy service_role JWT", async () => {
    const f = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => Response.json(7));
    vi.stubGlobal("fetch", f);
    const r = await runDailyReminders({ SUPABASE_URL: "https://demo.supabase.co/", SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOi.payload.sig" }, { now: NOW });
    expect(r).toEqual({ ok: true, via: "rest", rows: 7 });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://demo.supabase.co/rest/v1/rpc/generate_reminders");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ p_today: "2026-11-12" });
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer eyJhbGciOi.payload.sig");
  });

  it("sends new sb_secret_ keys only as apikey", async () => {
    const f = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => Response.json(0));
    vi.stubGlobal("fetch", f);
    await runDailyReminders({ VITE_SUPABASE_URL: "https://demo.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_abc" });
    const headers = f.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.apikey).toBe("sb_secret_abc");
    expect(headers.Authorization).toBeUndefined();
  });

  it("reports Supabase errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("permission denied", { status: 403 })));
    const r = await runDailyReminders({ SUPABASE_URL: "https://demo.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" });
    expect(r).toMatchObject({ ok: false, via: "rest" });
    expect(!r.ok && r.error).toContain("403");
  });

  it("falls back to a direct Postgres connection", async () => {
    const viaSql = vi.fn(async () => 3);
    const r = await runDailyReminders({ SUPABASE_DB_URL: "postgres://x" }, { viaSql, now: NOW });
    expect(r).toEqual({ ok: true, via: "sql", rows: 3 });
    expect(viaSql).toHaveBeenCalledWith("postgres://x", "2026-11-12");
  });

  it("reports Postgres errors", async () => {
    const r = await runDailyReminders({ SUPABASE_DB_URL: "postgres://x" }, { viaSql: async () => { throw new Error("timeout"); } });
    expect(r).toEqual({ ok: false, via: "sql", error: "timeout" });
  });

  it("does nothing when no database is configured", async () => {
    expect(await runDailyReminders({})).toMatchObject({ ok: false, via: "none" });
    // SUPABASE_DB_URL alone is not enough on hosts without a Postgres driver (Cloudflare).
    expect(await runDailyReminders({ SUPABASE_DB_URL: "postgres://x" })).toMatchObject({ ok: false, via: "none" });
  });
});

describe("cronAuthorized", () => {
  const req = (auth?: string) => new Request("https://aangan.test/api/cron/daily-reminders", { headers: auth ? { Authorization: auth } : {} });
  it("accepts the exact bearer secret", () => expect(cronAuthorized(req("Bearer s3cret"), "s3cret")).toBe(true));
  it("rejects a wrong or missing secret", () => {
    expect(cronAuthorized(req("Bearer nope!!"), "s3cret")).toBe(false);
    expect(cronAuthorized(req(), "s3cret")).toBe(false);
  });
  it("refuses everything when no secret is configured", () => expect(cronAuthorized(req("Bearer "), undefined)).toBe(false));
});
