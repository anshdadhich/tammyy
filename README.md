# Reverse Hiring - get discovered, hire fast

Candidates create one deep profile once. Employers search with AI understanding
(not keywords) and see best matches with contact directly (open-contact model:
no unlock gate; `contact_log` is audit-only).

Monorepo layout: `web/` (Next.js app: portfolio pages + HR search + JSON API) + `docs/` (blueprint).

Data + auth live in MongoDB (no external services): email + password login with
scrypt-hashed passwords and an httpOnly `tammy_session` cookie resolved against
the `sessions` collection.

The app includes the candidate profile flow, employer search, admin verification, and JSON API. Current UI routes are listed in `web/README.md`; route files under `web/src/app/` are the source of truth.

## Quickstart

### 1. MongoDB

Start a local MongoDB (8.x) — no schema to run; collections are created on demand:

- `MONGODB_URI` defaults to `mongodb://127.0.0.1:27017`
- `MONGODB_DB` defaults to `tammy`

Optional demo data (canonical skills + demo candidates so search works without a Voyage key):

```bash
cd web
node scripts/seed-mongo.mjs
```

### 2. Env vars (names only - copy `web/.env.example` to `web/.env.local`)

- `MONGODB_URI`, `MONGODB_DB` (optional - defaults work locally)
- `VOYAGE_API_KEY`
- `OPENROUTER_API_KEY`
- `JUDGE_MODEL`
- `INNGEST_EVENT_KEY`
- `INNGEST_SIGNING_KEY`
- `RESEND_API_KEY` (optional - email sends are graceful no-ops without it)
- `RESEND_FROM` (optional - defaults to Resend onboarding sender)
- `SESSION_SECRET` (recommended on prod - signs lookup/email-change tokens)
- `BOOTSTRAP_SECRET` (recommended on prod - locks `/api/admin/bootstrap`)
- `NEXT_PUBLIC_SITE_URL` (optional - used in email links)

### 3. Run the app

```bash
cd web
npm install
npm run dev        # http://localhost:3000
```

Pages include `/`, `/join`, `/talent/[id]`, `/hire`, `/hire/login`, `/hire/search`, `/admin`, `/settings`.

### 4. Inngest dev (background pipeline: normalize → summary → depth → chunks → embed)

```bash
cd web
npx inngest-cli@latest dev   # serves local worker; app endpoint is /api/webhooks/inngest
```

If Inngest is offline, `POST /api/candidates` still saves the profile (202) and
the worker picks it up later.

### 5. QA smoke

```bash
BASE_URL=http://localhost:3000 bash web/scripts/smoke.sh
# Windows:
#   $env:BASE_URL="http://localhost:3000"; powershell -File web/scripts/smoke.ps1
```

Checks `GET /` → 200 and expected unauthenticated API responses.

## API cheatsheet

- `POST /api/candidates` → 202 `{ candidateId, status: "processing" }`
- `PUT /api/candidates` `{ id, ...fields }` → 202 (owner edit, replaces child rows)
- `POST /api/search` `{ job, limit?, deep? }` → `{ results, queryText, searchId }`
- `POST /api/shortlists` `{ candidate_id, job_id?, employer_id?, status?, notes? }` → emails candidate (best-effort)
- `POST /api/candidates/lookup` `{ email }` → `{ exists }` (rate-limited existence check; id never disclosed; full bundles only via `GET /api/candidates?id=`)
- `POST /api/contacts` `{ candidate_id, job_id?, employer_id?, channel?, message? }` → audit-logs + emails candidate (best-effort)

All email sends are wrapped in try/catch - missing `RESEND_API_KEY` never breaks an API response.

## Deploy notes (Vercel + MongoDB)

- MongoDB: create a cluster (e.g. MongoDB Atlas) → set `MONGODB_URI` / `MONGODB_DB`. Auth indexes (unique `users.email`, sessions TTL) are created automatically on first login.
- Vercel: import `web/` as the project root, set all env vars above (server: `MONGODB_URI`, `VOYAGE_API_KEY`, `OPENROUTER_API_KEY`, `RESEND_API_KEY`, `SESSION_SECRET`, `BOOTSTRAP_SECRET`), deploy. Prod hardening: HR verification is fail-closed by default (no flag needed) + set `BOOTSTRAP_SECRET` (locks `/api/admin/bootstrap`).
- Admin bootstrap: sign up first, then `POST /api/admin/bootstrap` with the bootstrap secret to promote your account to admin.
- Inngest: create an Inngest project, set `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` in Vercel, point Inngest to `https://<app>/api/webhooks/inngest` as the serving endpoint.
- File uploads are stored on local disk (`STORAGE_DIR`, default `<project>/storage`) — mount a persistent volume or swap `lib/storage.ts` for object storage when moving beyond a single instance.
- Seeding: run `node scripts/seed-mongo.mjs` only for staging; never on prod (demo `@demo.local` rows).
