# Maison Aurore Roster — Supabase + Vercel/Netlify

Zero-cost, no-server deployment.
React frontend · TypeScript engine · Supabase PostgreSQL · Vercel or Netlify hosting.

---

## Architecture

```
Browser (React + TS engine)
  │
  ├── reads/writes ──→ Supabase (PostgreSQL + REST API)
  │                    staff, vic_clients, scoring_weights, roster_history
  │
  └── hosted on ──→ Vercel  (free tier, auto-deploys from GitHub)
                 or Netlify (free tier, auto-deploys from GitHub)
```

No backend server. The roster engine runs in the browser as TypeScript.
Everything is free within generous platform limits.

---

## Quick start (5 steps)

### Step 1 — Create a Supabase project (free)

1. Go to https://supabase.com → New project
2. Choose a name (e.g. `maison-roster`) and set a database password
3. Wait ~2 minutes for provisioning

### Step 2 — Run the database migration

1. In the Supabase dashboard, click **SQL Editor → New query**
2. Paste the contents of `supabase/migrations/001_schema.sql`
3. Click **Run** — this creates all tables and seeds the 25 staff members

### Step 3 — Copy your credentials

In the Supabase dashboard → **Project Settings → API**:
- Copy **Project URL** (looks like `https://xxxx.supabase.co`)
- Copy **anon / public** key

```bash
cd frontend
cp .env.example .env
# Edit .env and fill in your URL and anon key
```

### Step 4 — Run locally

```bash
cd frontend
npm install
npm run dev
# Open http://localhost:5173
```

### Step 5 — Deploy to Vercel (free)

#### Option A — Vercel UI (easiest)

1. Push this repo to GitHub
2. Go to https://vercel.com → Import project → select your repo
3. Set build settings:
   - Framework: **Vite**
   - Root directory: `frontend`
   - Build command: `npm run build`
   - Output directory: `dist`
4. Add environment variables:
   - `VITE_SUPABASE_URL` → your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` → your Supabase anon key
5. Click **Deploy** — done ✓

#### Option B — Vercel CLI

```bash
npm install -g vercel
cd frontend
vercel --prod
# Follow prompts, then set env vars:
vercel env add VITE_SUPABASE_URL
vercel env add VITE_SUPABASE_ANON_KEY
vercel --prod  # redeploy with env vars
```

#### Option C — Netlify (alternative to Vercel)

1. Go to https://netlify.com → Add new site → Import from Git
2. Set build settings:
   - Base directory: `frontend`
   - Build command: `npm run build`
   - Publish directory: `frontend/dist`
3. Add environment variables (same as Vercel)
4. Deploy

---

## GitHub Actions CI/CD

After deploying, set these secrets in your GitHub repo (Settings → Secrets → Actions):

| Secret | Where to find it |
|---|---|
| `VITE_SUPABASE_URL` | Supabase → Project Settings → API |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
| `VERCEL_TOKEN` | vercel.com → Account Settings → Tokens |
| `VERCEL_ORG_ID` | Run `vercel link` → check `.vercel/project.json` |
| `VERCEL_PROJECT_ID` | Run `vercel link` → check `.vercel/project.json` |

Every push to `main` then auto-deploys to Vercel.

---

## Project structure

```
roster-supabase/
├── supabase/
│   └── migrations/001_schema.sql   ← run this in Supabase SQL editor
├── frontend/
│   ├── src/
│   │   ├── App.tsx                 ← roster dashboard
│   │   ├── engine.ts               ← TypeScript roster engine (runs in browser)
│   │   ├── supabaseClient.ts       ← all DB read/write operations
│   │   ├── types.ts                ← shared TypeScript types
│   │   └── admin/AdminPanel.tsx    ← staff/VIC/weights admin panel
│   ├── .env.example                ← copy to .env, fill in Supabase creds
│   └── package.json
├── vercel.json                     ← Vercel deployment config
├── netlify.toml                    ← Netlify deployment config
└── .github/workflows/deploy.yml   ← GitHub Actions CI/CD
```

---

## Free tier limits

| Service | Free limit | Notes |
|---|---|---|
| Supabase | 500 MB DB, 2 GB bandwidth/mo | Plenty for a boutique roster |
| Vercel | 100 GB bandwidth/mo, unlimited deploys | More than enough |
| Netlify | 100 GB bandwidth/mo, 300 build mins/mo | Also fine |

---

## Locking down the admin panel in production

The current schema uses open RLS policies for demo purposes.
To restrict writes to authenticated users only:

```sql
-- In Supabase SQL editor:
-- Remove the open write policies:
drop policy "anon write staff"      on staff;
drop policy "anon write vic_clients" on vic_clients;
drop policy "anon write vic_advisors" on vic_advisors;
drop policy "anon write weights"    on scoring_weights;

-- Replace with auth-required policies:
create policy "auth write staff"
  on staff for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Repeat for other tables...
```

Then add Supabase Auth (email/password or SSO) to the admin panel.
