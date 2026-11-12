# Aangan

Rent, receipts and one-tap WhatsApp reminders for small landlords in India (1–50 units). Landlords see who has paid, issue QR-verified receipts, draft polite reminders they open in WhatsApp, reconcile a bank statement, and ask an AI assistant about their workspace. Tenants get a private portal link.

The app is an installable PWA that also works offline. Without a Supabase project it runs on a built-in mock backend with a sample workspace, so every screen works as a demo.

## Tech

- **Frontend:** React 19, React Router 7, Vite 8, Motion, lucide icons, self-hosted fonts.
- **Data and auth:** Supabase (Postgres with row-level security, Auth, Storage). Schema and RPCs live in `supabase/migrations`.
- **API:** three small, host-neutral handlers in `server/`. The same code runs on Netlify Functions, Vercel Functions and a Cloudflare Worker.
  - `POST /api/assist`: streams the AI assistant's answer (Anthropic Claude).
  - `POST /api/reconcile`: AI suggestions for bank lines the rule-based matcher couldn't place.
  - Daily job at 06:00 IST: builds reminders and applies late fees with `generate_reminders()`.
- **Tests:** Vitest. The tests cover the API handlers, each host's adapter, the deployment configs, and the core money, rent and statement-parsing logic.

## Run locally

```bash
npm ci
cp .env.example .env      # optional: leave empty for demo mode
npm run dev               # frontend only, at http://localhost:5173
npm test                  # unit and API tests
npm run typecheck
```

To try the AI routes locally, run the full stack on one of the hosts:

| Host | Command | Local secrets file |
| --- | --- | --- |
| Netlify | `npm run dev:netlify` | `.env` |
| Vercel | `npx vercel dev` | `.env` |
| Cloudflare | `npm run dev:cloudflare` | `.dev.vars` (copy `.dev.vars.example`) |

## Environment variables

| Name | Where | Needed for |
| --- | --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | **Build** and **runtime** | Live mode. Leave unset for the demo. The API also reads them to check sessions. |
| `VITE_SUPABASE_STORAGE_BUCKET` | Build | Optional. Defaults to `angan`. |
| `ANTHROPIC_API_KEY` | Runtime (secret) | AI assistant and AI matching. Injected automatically on Netlify by AI Gateway. |
| `ANTHROPIC_BASE_URL` | Runtime | Optional proxy or gateway. |
| `SUPABASE_SERVICE_ROLE_KEY` | Runtime (secret) | Daily reminder job. Required on Cloudflare. |
| `CRON_SECRET` | Runtime (secret), Vercel only | Lets Vercel Cron call `/api/cron/daily-reminders`. Use a long random string. |
| `SUPABASE_DB_URL` | Build (secret), production only | Applies `supabase/migrations` during `npm run build`. Also a fallback for the reminder job on Netlify and Vercel. |

Never prefix a secret with `VITE_`. Anything named `VITE_*` is baked into the public JavaScript bundle.

Migrations are skipped automatically on Vercel preview builds and Netlify deploy previews. On Cloudflare, only set `SUPABASE_DB_URL` for the production branch build.

## Deploy to Vercel

1. Import the repository in Vercel. The settings come from `vercel.json`: the Vite framework preset, `npm ci`, `npm run build`, output in `dist`, an SPA fallback, headers, functions in `api/`, and a daily cron.
2. Under **Settings → Environment Variables**, add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET`. Add `SUPABASE_DB_URL` for **Production** only.
3. Deploy, either with a git push or with `npm run deploy:vercel`.
4. Check the deployment: open `/`, open a deep link such as `/app`, ask the assistant something, then open **Settings → Cron Jobs** and click **Run** on `daily-reminders`.

Cron jobs only run on production deployments. The Hobby plan allows one run per day, which is what this job uses.

## Deploy to Cloudflare (Workers + Static Assets)

`wrangler.jsonc` serves `dist/` as static assets with an SPA fallback. Only `/api/*` runs the Worker (`worker/index.ts`), and a Cron Trigger runs the reminder job daily at 06:00 IST. `public/_headers` sets the security and caching headers.

**With Git (Workers Builds):** in the dashboard, go to **Workers & Pages → Create → Import a repository**.
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Build variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (and `SUPABASE_DB_URL` on the production branch only)

**From your machine:**
```bash
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put VITE_SUPABASE_URL       # runtime copy, used to check sessions
npx wrangler secret put VITE_SUPABASE_ANON_KEY
VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... npm run deploy:cloudflare
```

`keep_vars` is on, so variables you set in the dashboard survive every deploy. Cloudflare can't open direct Postgres connections the way Node can, so the reminder job there uses the Supabase REST API with `SUPABASE_SERVICE_ROLE_KEY`.

## Deploy to Netlify

`netlify.toml` already covers it. Functions live in `netlify/functions`, and AI Gateway provides the Anthropic key.

## Before going live

- Run `npm run check` (type check and tests). CI runs the same checks on every push and pull request (`.github/workflows/ci.yml`). It also builds the bundle and dry-runs the Cloudflare Worker bundle.
- In Supabase **Auth → URL Configuration**, add each production domain (Vercel and Cloudflare) to the allowed redirect URLs so sign-in links work.
- Turn on `pg_cron` in Supabase if you want the database to schedule reminders itself as well. Running both is harmless.
