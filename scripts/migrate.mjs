// Applies SQL files in supabase/migrations to the Supabase Postgres database.
// Runs before the Vite build. Skips quietly when SUPABASE_DB_URL is not set,
// so local builds and forks without database access still work.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.log("[migrate] SUPABASE_DB_URL not set, skipping database migrations.");
  process.exit(0);
}
// Preview builds of unmerged branches must not change the shared database.
// Vercel sets VERCEL_ENV, Netlify sets CONTEXT. Set MIGRATE_ON_PREVIEW=1 to opt in (e.g. a separate preview database).
const preview = process.env.VERCEL_ENV === "preview" || ["deploy-preview", "branch-deploy"].includes(process.env.CONTEXT ?? "");
if (preview && process.env.MIGRATE_ON_PREVIEW !== "1") {
  console.log("[migrate] preview build, skipping database migrations (set MIGRATE_ON_PREVIEW=1 to apply them).");
  process.exit(0);
}

// Loaded only when needed, so builds without a database never depend on the driver.
const { default: postgres } = await import("postgres");
const dir = join(import.meta.dirname, "..", "supabase", "migrations");
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
// Surface NOTICEs (e.g. "Storage setup skipped") so a missing bucket is visible in build logs.
const sql = postgres(url, { max: 1, ssl: "require", onnotice: (n) => console.log(`[migrate] notice: ${n.message}`), prepare: false });

try {
  await sql`create schema if not exists angan_meta`;
  await sql`create table if not exists angan_meta.migrations (name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await sql`select name from angan_meta.migrations`).map((r) => r.name));
  for (const file of files) {
    if (done.has(file)) continue;
    const body = await readFile(join(dir, file), "utf8");
    console.log(`[migrate] applying ${file}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into angan_meta.migrations (name) values (${file})`;
    });
  }
  console.log("[migrate] database is up to date.");
} catch (err) {
  console.error("[migrate] failed:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
