// Guards the deployment configs so Netlify, Vercel and Cloudflare stay in step.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const json = (f: string) => JSON.parse(read(f).replace(/^\s*\/\/.*$/gm, ""));
const vercel = json("vercel.json");
const wrangler = json("wrangler.jsonc");
const pkg = json("package.json");
const SCHEDULE = "30 0 * * *";

describe("deployment config", () => {
  it("builds the same way everywhere", () => {
    expect(vercel.buildCommand).toBe("npm run build");
    expect(vercel.outputDirectory).toBe("dist");
    expect(wrangler.assets.directory).toBe("./dist");
    expect(read("netlify.toml")).toMatch(/publish = "dist"/);
    expect(pkg.scripts.build).toContain("vite build");
  });

  it("serves the app shell for client-side routes", () => {
    expect(wrangler.assets.not_found_handling).toBe("single-page-application");
    const spa = vercel.rewrites.find((r: { destination: string }) => r.destination === "/index.html");
    const re = new RegExp(`^${spa.source}$`);
    expect(re.test("/app/tenants")).toBe(true);
    expect(re.test("/t/abc123")).toBe(true);
    expect(re.test("/api/assist")).toBe(false);
    expect(re.test("/assets/index-abc.js")).toBe(false);
    expect(read("netlify.toml")).toMatch(/to = "\/index.html"/);
  });

  it("runs the API before static assets on Cloudflare", () => {
    expect(wrangler.main).toBe("worker/index.ts");
    expect(wrangler.assets.run_worker_first).toContain("/api/*");
    expect(wrangler.compatibility_flags).toContain("nodejs_compat");
  });

  it("exposes every API route the browser calls on every host", () => {
    const browser = read("src/lib/assist.ts") + read("src/lib/reconcile.ts");
    const worker = read("worker/index.ts");
    for (const route of ["assist", "reconcile"]) {
      expect(browser).toContain(`"/api/${route}"`);
      expect(existsSync(new URL(`../api/${route}.ts`, import.meta.url))).toBe(true);
      expect(read(`netlify/functions/${route}.mts`)).toContain(`path: "/api/${route}"`);
      expect(worker).toContain(`"/api/${route}"`);
    }
  });

  it("schedules the daily reminder job at 06:00 IST on every host", () => {
    expect(vercel.crons).toEqual([{ path: "/api/cron/daily-reminders", schedule: SCHEDULE }]);
    expect(existsSync(new URL("../api/cron/daily-reminders.ts", import.meta.url))).toBe(true);
    expect(wrangler.triggers.crons).toEqual([SCHEDULE]);
    expect(read("netlify/functions/daily-reminders.mts")).toContain(`schedule: "${SCHEDULE}"`);
  });

  it("sends the same security and caching headers on every host", () => {
    const headers = read("public/_headers");
    const all = vercel.headers.find((h: { source: string }) => h.source === "/(.*)").headers as { key: string; value: string }[];
    for (const { key, value } of all) expect(headers).toContain(`${key}: ${value}`);
    for (const path of ["/sw.js", "/manifest.webmanifest", "/index.html"]) {
      expect(headers).toMatch(new RegExp(`${path.replace(/\./g, "\\.")}\\n  Cache-Control: no-cache`));
      expect(vercel.headers.some((h: { source: string }) => h.source === path)).toBe(true);
    }
    expect(headers).toContain("/assets/*\n  Cache-Control: public, max-age=31536000, immutable");
  });

  it("never exposes server secrets to the browser bundle", () => {
    const env = read(".env.example");
    for (const secret of ["ANTHROPIC_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL", "CRON_SECRET"]) {
      expect(env).not.toMatch(new RegExp(`VITE_${secret}`));
    }
    expect(read(".gitignore")).toMatch(/^\.env$/m);
    expect(read(".gitignore")).toMatch(/^\.dev\.vars$/m);
  });
});
