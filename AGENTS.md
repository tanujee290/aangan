# AGENTS.md

## What this is
Aangan is a PWA for small Indian landlords: a React + Vite single-page app on Supabase, plus three small API endpoints. It deploys unchanged to **Netlify, Vercel and Cloudflare Workers**.

## Layout
- `src/`: the SPA. `pages/` holds the screens, `components/` shared UI, `state/` React contexts, and `lib/` pure logic (rent, reports, reconcile, format) plus the Supabase client.
  - `src/lib/mock/` is an in-browser mock of the Supabase backend. It runs whenever the `VITE_SUPABASE_*` variables are unset (demo mode) and must stay in step with `supabase/migrations`.
- `server/`: **host-neutral** API logic. Each handler takes a Web `Request` and a plain `env` object and returns a `Response`. Never read `process.env` in here. Adapters pass the env in.
  - `assist.ts`, `reconcile.ts`: AI routes. The Anthropic client factory is injectable for tests.
  - `reminders.ts`: the daily job. It uses Supabase REST first, then an optional SQL runner.
  - `reminders-pg.ts`: a Node-only Postgres runner. **Never import it from `worker/`**: Workers can't use the TCP driver.
- Host adapters (thin wrappers, no logic):
  - `netlify/functions/*.mts`: Netlify Functions (paths in `config`).
  - `api/**/*.ts`: Vercel Functions (named `POST`/`GET` exports). `api/cron/*` is protected by `CRON_SECRET`.
  - `worker/index.ts`: Cloudflare Worker (`fetch` for `/api/*`, `scheduled` for cron).
- Config: `netlify.toml`, `vercel.json`, `wrangler.jsonc`, and `public/_headers` (headers for Netlify and Cloudflare; Vercel's copy lives in `vercel.json`).
- `supabase/migrations/`: SQL applied by `scripts/migrate.mjs` during `npm run build` (skipped without `SUPABASE_DB_URL` and on preview builds).
- `tests/`: Vitest. `tests/deploy-config.test.ts` fails if the three hosts drift apart in routes, cron schedule, SPA fallback or headers.

## Conventions
- Relative imports inside `server/`, `api/`, `worker/` and `netlify/` use the `.js` extension (resolved to `.ts`). Vercel's Node ESM runtime needs this.
- To add an API route: write the handler in `server/`, then add **all three** adapters and a test. The config test enforces this for routes the browser calls.
- Keep the cron schedule (`30 0 * * *` UTC = 06:00 IST) the same in `vercel.json`, `wrangler.jsonc` and `netlify/functions/daily-reminders.mts`.
- Secrets are never `VITE_*`. Error responses are JSON `{ error }` with `Cache-Control: no-store`.
- Run `npm run check` before shipping.
