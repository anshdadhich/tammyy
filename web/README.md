# Tammy - file once, get discovered

Next.js App Router app for candidate profiles, employer search, admin verification, and the JSON API.

## Run

```bash
npm install
npm run dev     # http://localhost:3000
```

## Pages

- `/` - product landing page
- `/join` - candidate profile onboarding and editing
- `/talent/[id]` - candidate dossier
- `/hire` - employer landing page
- `/hire/login` - employer sign-in and verification
- `/hire/search` - employer candidate search
- `/admin` - employer verification queue
- `/settings` - session and theme settings

## Endpoints

- `POST /api/candidates` → 202 `{ candidateId, status: "processing" }`
- `PUT /api/candidates` `{ id, ...fields }` → 202 (edit, replaces child rows)
- `GET /api/candidates?id=...` → full dossier bundle (email lookup is `POST /api/candidates/lookup`)
- `POST /api/search` `{ job, limit? }` → `{ results, queryText, searchId }`
- `POST /api/shortlists` / `GET /api/shortlists?candidate_id=...`
- `POST /api/contacts` (HR outreach, audit + best-effort email)
- `POST /api/uploads` (photo/resume, after the candidate row exists)

The API also includes OTP auth, profile lookup and batch reads, file uploads,
session management, and admin endpoints. Route handlers under `src/app/api/`
are the source of truth for exact request and response contracts.

## Smoke

```bash
BASE_URL=http://localhost:3000 bash scripts/smoke.sh
# Windows:
#   $env:BASE_URL="http://localhost:3000"; powershell -File scripts/smoke.ps1
```
