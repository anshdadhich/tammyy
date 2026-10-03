# Reverse Hiring - get discovered, hire fast

Candidates create one deep profile once. Employers search with AI understanding
(not keywords) and see best matches with contact directly (open-contact model:
no unlock gate; `contact_log` is audit-only).

Monorepo layout: `web/` (Next.js app: portfolio pages + HR search + JSON API) + `docs/` (blueprint).

Data + auth run entirely on Cloudflare: D1 (records + auth), Vectorize +
Workers AI embeddings (semantic search), R2 (files), Workflows (the profile
pipeline), Durable Objects (password hashing + rate limits). Email is custom
scrypt passwords with an httpOnly `tammy_session` cookie resolved against the
`sessions` table.

The app includes the candidate profile flow, employer search, admin verification, and JSON API. Current UI routes are listed in `web/README.md`; route files under `web/src/app/` are the source of truth.

## Quickstart

### 1. Env vars (names only - copy `web/.env.example` to `web/.env.local`)

- `SESSION_SECRET` (signs lookup/email-change/ownership tokens)
- `BOOTSTRAP_SECRET` (locks `/api/admin/bootstrap`)
- `BOOTSTRAP_ADMIN_EMAIL` (pins which account bootstrap may promote)
- `OPENROUTER_API_KEY` (optional - summary/depth/judge LLM; graceful no-op)
- `JUDGE_MODEL` / `CHEAP_MODEL` (optional - model selection)
- `RESEND_API_KEY` / `RESEND_FROM` (optional - email sends are graceful no-ops)
- `NEXT_PUBLIC_SITE_URL` (used in email links)

### 2. Run the app

```bash
cd web
npm install
npm run dev        # http://localhost:3000
```

Pages include `/`, `/join`, `/talent/[id]`, `/hire`, `/hire/login`, `/hire/search`, `/admin`, `/settings`.

### 3. Background pipeline (normalize -> summary -> depth -> chunks -> embed)

Runs as a Cloudflare Workflow (`profile-pipeline`): one durable step per
stage, resumes after crashes, triggered from `/api/candidates` and
`/api/candidates/summary`. No external worker service needed.

### 4. QA smoke

```bash
BASE_URL=http://localhost:3000 bash web/scripts/smoke.sh
```

Checks `GET /` -> 200 and expected unauthenticated API responses.

## API cheatsheet

- `POST /api/candidates` → 202 `{ candidateId, status: "processing" }`
- `PUT /api/candidates` `{ id, ...fields }` → 202 (owner edit, replaces child rows)
- `POST /api/search` `{ job, limit?, deep? }` → `{ results, queryText, searchId }`
- `POST /api/shortlists` `{ candidate_id, job_id?, employer_id?, status?, notes? }` → emails candidate (best-effort)
- `POST /api/candidates/lookup` `{ email }` → `{ exists }` (rate-limited existence check; id never disclosed; full bundles only via `GET /api/candidates?id=`)
- `POST /api/contacts` `{ candidate_id, job_id?, employer_id?, channel?, message? }` → audit-logs + emails candidate (best-effort)

All email sends are wrapped in try/catch - missing `RESEND_API_KEY` never breaks an API response.

## Deploy notes (Cloudflare free tier)

The whole stack runs on Cloudflare: Workers (Next.js via `@opennextjs/cloudflare`), D1 (records), Vectorize + Workers AI (semantic search), R2 (files), Durable Objects (password hashing, rate limits), Workflows (profile pipeline). No other vendors required; Resend stays optional for email.

### 1. Create the Cloudflare resources (free tier)

```bash
cd web
npx wrangler d1 create tammy            # paste the database_id into wrangler.jsonc
npx wrangler r2 bucket create tammy-media
npx wrangler vectorize index create tammy-profile-chunks-512 --dimensions=512 --metric=cosine
```

### 2. Apply the D1 schema

```bash
npx wrangler d1 migrations apply tammy --remote
```

### 3. Set secrets

```bash
npx wrangler secret put SESSION_SECRET
npx wrangler secret put BOOTSTRAP_SECRET
# optional: presigned direct-to-R2 uploads (photo bytes skip the Worker)
npx wrangler secret put R2_ACCOUNT_ID
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
npx wrangler secret put OPENROUTER_API_KEY   # deep-read judge + summaries
npx wrangler secret put RESEND_API_KEY       # optional email
```

### 4. Build and deploy

```bash
npm run deploy     # opennextjs-cloudflare build && deploy
```

Then sign up and promote the admin once:
`POST /api/admin/bootstrap` with the bootstrap secret in the `x-bootstrap-secret` header.

### Capacity notes (free tier)

- Workers: 100k requests/day. Password hashing runs in a Durable Object (30s CPU) because no production-strength hash fits the 10ms request budget; search similarity runs in Vectorize for the same reason.
- Vectorize free: 5M stored dimensions ≈ 9.7k chunks at 512 dims (qwen3-embedding-0.6b MRL-truncated from 1024). This is the first limit to watch; $5/mo Workers Paid doubles it.
- D1 free: 500MB (~100k candidate rows once vectors live in Vectorize).
- R2 free: 10GB, zero egress. Presigned PUTs keep upload bytes off the Worker entirely.
- File uploads store `{uuid}/{filename}` keys; access control stays in `GET /api/uploads`, which re-checks the session (and emits presigned GETs when R2 S3 credentials are configured).
