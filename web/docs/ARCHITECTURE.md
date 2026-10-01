# ReverseHiring - Historical Architecture Notes

> This document is an archived implementation audit, not the current architecture specification. It contains old UI flows and claims that no longer match the repository. Current UI routes are listed in `web/README.md`; inspect `web/src/app/`, `web/src/lib/`, and the active SQL files before changing behavior. Keep this archive for migration history; do not treat its “deleted” labels or historical risk list as current without checking the code.

> NOTE (2026-09-28): Supabase-Auth rewrite landed after this doc. Current truth:
> passwordless OTP sessions (not HMAC cookies); `POST /api/contact` (singular)
> does not exist - use `POST /api/contacts`; `_actions.tsx` is gone (admin acts
> via `POST /api/admin/employers` directly); `lib/matching/scoring.ts` deleted
> (live scoring is `lib/scoring-live.ts`); `lookup` returns `{exists, token}`,
> never an id; `STRICT_HR_VERIFY` no longer gates anything (fail-closed always).
> Sections below marked previous-UI remain historical.
>
> NOTE (2026-09-12): UI removed - `web/` is now API-only (`/api/*` + `GET /` JSON index).
> Flows A/B/D/E and landing/admin/dashboard pages below describe the PREVIOUS
> Next.js UI and no longer exist in code. Backend flows (API routes, `lib/`,
> Inngest pipeline, Supabase schema) remain accurate.
>
> NOTE (2026-10-01): Supabase fully removed — MongoDB is now the only backend.
> Auth = email+password (scrypt hashes in `lib/password.ts`) with an opaque
> `tammy_session` cookie resolved against the `sessions` collection
> (`lib/auth-user.ts`, `lib/session.ts`); `users` owns roles directly (no
> `auth_id`, no OTP/`supabase.auth`). Data = official `mongodb` driver
> (`lib/mongo.ts`) — all sections below describing Postgres tables, RLS,
> PostgREST queries, `supabaseAdmin()`, the `match_chunks` RPC (now app-side
> cosine in `lib/matching/mongo-retrieval.ts`), Supabase Storage (now local
> disk via `lib/storage.ts`), or `@supabase/*` clients are historical. The
> `supabase/` SQL + `web/.env` Supabase vars are gone; env is `MONGODB_URI` /
> `MONGODB_DB`. Seed: `web/scripts/seed-mongo.mjs`.

> ONE record of what the code DOES. Verified against `web/src/**`, `supabase/*.sql`,
> `web/scripts/*`, `web/package.json`, `web/.env.example` (names only).
> `docs/` (repo-root, 14 files) predates implementation - §11 lists every divergence.
> No secrets below; env names only.

---

## 1. Product concept + user flows

**Concept:** reverse hiring. Candidates file ONE structured dossier once; verified
employers search the talent DB; every match cites evidence + gaps; contact is
open on match (no unlock/approval). Landing: `web/src/app/page.tsx:26-197`
(server component, static marketing; former CTAs → `/candidate`, `/hire` now 404
- **all UI routes below were removed; only the landing page and JSON API remain.**
Flows A–C describe the deleted UI and are kept for historical context only).

### Flow A - candidate onboarding (`/candidate`, client) - `web/src/app/candidate/page.tsx:59-742` *(deleted)*

4-step wizard (`STEPS`, `candidate/page.tsx:56`): 0 Basics → 1 Profile & skills →
2 Proof of work (experience/projects/education) → 3 Resume & terms (prefs + review +
consent). Per-step validation (`validateStep`, `:243-268`); back/next with focus
move (`:270-281`); draft persisted to `localStorage rh-candidate-draft-v1` on every
keystroke and restored on mount (`:108-128`); autofill test data (`:418-456`).
Client validates with `candidateSchema` then `POST /api/candidates`
(`:307-367`); queued photo/resume files upload AFTER submit once `candidateId`
exists (`:375-400`).

**Drive gate (hard gate, blocks submit):** resume is REQUIRED - Drive link OR PDF
(`:257-260`, `:284-301`). If link and no file: `GET /api/drive-check?url=` must
return `reachable`, else submit blocked + share-help shown (`:293-300`). Phone OR
LinkedIn required (email alone insufficient) (`:302-306`); consent checkbox
required (`z.literal(true)`, `lib/validators.ts:150-152`). Photo URL optional;
photo file JPG/PNG ≤10 MB, resume PDF ≤10 MB, client pre-validated
(`candidate/page.tsx:166-174`) and server re-validated (`api/uploads/route.ts:89-104`).

### Flow B - employer search (`/hire`, client) - `web/src/app/hire/page.tsx:25-391` *(deleted)*

3-step job form (role → skills → context), client `jobSchema` validation
(`hire/page.tsx:67-84`), autofill demo job (`:146-166`), `POST /api/search`
`{job, limit:20, deep}` (`:118-123`). Thinking-trace UI (filter → hybrid →
scoring → [deep judge]) with fake staged timers (`:102-116`); skeletons while
loading; empty states for 0 results / pre-search (`:306-320`). Results =
`MatchCard`s with evidence (max 4: row + judge merged), gaps, contact string,
score/level, salary/location fit (`:328-386`). Per-card actions: Open dossier
(`/candidate/[id]`), Shortlist (`POST /api/shortlists {candidate_id}`,
`:170-190`), Log contact (`POST /api/contact {candidate_id, channel, message}`,
`:203-225`). **Deep toggle** (`Switch`, `:290`) adds LLM judge of top-10,
slower (`:114`).

### Flow C - admin/verify

Employer files company at `/employer/verify` (client, `employer/verify/page.tsx:28-297`):
requires signed-in `users.role employer|admin` (`:54-69`); insert/update
`employers` row via cookie RLS client; `pending` on first submit, stays `verified`
on edit-if-verified (`:127-129`); rejected → resubmit path (`:204-206`).
Admin desk `/admin` (server, `admin/page.tsx:6-245`): `requireRole("admin")` else
denied card (`:7-25`); lists pending employers (oldest first, 50) + recent
candidates (20) + searches (10) + audit (20) + counts; verify/reject via client
`_actions.tsx:11-31` → `POST /api/admin/employers`. Bootstrap: `GET
/api/admin/bootstrap?email=` promotes first admin only (403 after,
`api/admin/bootstrap/route.ts:6-27`); `scripts/bootstrap-admin.mjs` same + verifies
all pending.

### Flow D - shortlist/contact (audit-only, NOT a gate)

`contact_log` is append-only audit. Contact visible directly on match cards /
dossier (`hire/page.tsx:346`, `candidate/[id]/page.tsx:201-216`). Logging =
`POST /api/contact` OR `POST /api/contacts` (duplicate routes, §7) → row +
best-effort candidate email. Shortlist = `POST /api/shortlists` → row +
best-effort `newMatchEmail`. Manual dedupe in code (NULL-safe, §7).

### Flow E - dashboard (`/dashboard`, client) - `dashboard/page.tsx:29-273`

Load by candidate UUID OR contact email → `GET /api/candidates?id|email`
(`:46-47`): shows dossier header + visibility toggle (PATCH visible/hidden/
inactive, `:65-87`), public-dossier link, Export JSON (client blob, `:89-98`),
Delete profile (DELETE + confirm, `:100-118`), AI summary, who-contacted-me
(`contact_log` ≤50), matches/shortlists (≤50 each).

---

## 2. Tech stack (exact, `web/package.json:11-30`)

| Piece | Version | Why |
|---|---|---|
| `next` | `16.3.4` | App Router, server/client split, route handlers, `next/font` |
| `react` / `react-dom` | `19.2.8` | UI |
| `@supabase/ssr` `^0.12.6`, `@supabase/supabase-js` `^2.115.0` | - | Auth + Postgres + Storage; 3 clients (§8) |
| `inngest` `^4.20.0` | - | Background profile pipeline (async AI, retries) |
| `resend` `^6.26.0` | - | Transactional email, no-op without key |
| `zod` `^4.5.4` | - | Shared client+server validation (`lib/validators.ts`) |
| `tailwindcss` `^4` + `@tailwindcss/postcss` | - | Styling via `globals.css` tokens |
| `typescript` `^5`, `eslint` `^9` + `eslint-config-next` | - | Types, lint |
| Voyage embeddings | `voyage-4-lite`, 1024-dim, plain `fetch` (no SDK) | `lib/matching/voyage.ts:12-84` |
| LLM | OpenRouter OpenAI-compatible, `minimax/minimax-m3:free` cheap+judge | `lib/matching/judge.ts:74-120`, `.env.example:10-13` |
| Fonts | `next/font/google`: Plus Jakarta Sans + Instrument Serif + JetBrains Mono → CSS vars | `app/layout.tsx:2-8,17` |
| Canvas art | hand-rolled `FlowerLattice`, `BondType` (2D), `DdiivvShader` (WebGL2) | §10 guards |

No ORM, no pg client lib (all DB via Supabase JS + one RPC), no test runner
(no vitest/jest in `package.json` - scripts are `.mjs`/curl only, §9).
`web/next.config.ts:1-7` is empty default. `web/supabase/storage.sql` is a
byte-identical copy of `supabase/storage.sql` (mirror, apply either once).

Env NAMES (`web/.env.example:1-24`): `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`VOYAGE_API_KEY`, `OPENROUTER_BASE_URL`, `OPENROUTER_API_KEY`, `CHEAP_MODEL`,
`JUDGE_MODEL`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `RESEND_API_KEY`,
`RESEND_FROM`, `NEXT_PUBLIC_SITE_URL`. (Never read `.env.local`.)

---

## 3. Database (from `supabase/schema.sql`; RLS plain words; storage; prefs)

Extensions: `pgcrypto`, `vector`, `pg_trgm`, `unaccent` (`schema.sql:18-21`) +
immutable `f_unaccent(text)` wrapper for indexes (`:27-32`) + `set_updated_at()`
trigger (`:35-43`, attached to candidates/profiles/employers/jobs `:344-362`).

### 3a. Every table/column

**`users`** (`:52-60`): `id` PK uuid, `auth_id` UNIQUE (→ auth.users, no FK),
`email` UNIQUE NOT NULL, `role` ∈ candidate/employer/admin, `status` ∈
active/suspended/deleted dflt active, `email_verified` bool dflt false,
`created_at`.

**`candidates`** (`:65-101`): `id` PK, `user_id` → users SET NULL,
`full_name` NOT NULL, `headline`, `domain`, `current_position`,
`total_experience_years` ≥0, `education_level`, `location_city`,
`location_country` dflt 'India', `remote_preference` ∈
remote_only/hybrid/onsite/flexible, `open_to_relocation` bool dflt false,
`min_salary` ≥0, `salary_currency` dflt INR, `salary_frequency` ∈
monthly/yearly/hourly/**stipend** dflt monthly, `salary_negotiable` dflt true,
`notice_period`, `availability_status` ∈ immediate/notice/inactive, `photo_url`,
OPEN-CONTACT `contact_email/phone`, `linkedin/github/portfolio/resume_url`,
`visibility_status` ∈ visible/hidden/inactive dflt visible,
`consent_status`, `profile_strength` 0-100, `freshness_updated_at` dflt now,
`created_at`, `updated_at` (auto-bump trigger).

**`candidate_profiles`** (`:104-114`): `id`, `candidate_id` UNIQUE → candidates
CASCADE, `summary_markdown`, `summary_json` dflt {}, `original_resume_text`,
`profile_json` dflt {}, timestamps. (Pipeline only writes
summary_markdown/json; `original_resume_text`/`profile_json` never written by
app code - always NULL/{} in practice.)

**`work_experiences`** (`:117-131`): `id`, `candidate_id` CASCADE, `company_name`,
`job_title`, `employment_type`, `start_date/end_date` DATE, `is_current` dflt
false, `description`, `achievements`, `tech_stack` TEXT[] dflt {}, `evidence_links`
TEXT[] dflt {}, `created_at`. (API writes all but `employment_type`/
`evidence_links` - always NULL/{} from onboarding.)

**`projects`** (`:134-153`): `id`, `candidate_id` CASCADE, `title` NOT NULL,
`description`, `problem_statement`, `tech_stack` [], `role_in_project`,
`project_link`, `repo_link`, `deployment_link`, `impact_summary`, `metrics`
(never written by API - always NULL), `challenges_faced` (never written -
folded into `impact_summary` with `|` separators,
`api/candidates/route.ts:142`), `project_type` ∈
personal/academic/freelance/production/open_source/prototype, dates, `created_at`.

**`project_depth_analysis`** (`:156-171`): `id`, `project_id` → projects CASCADE,
`complexity_score` 1-10, `technical_complexity` ∈ low/medium/high/very_high,
`architectural_concepts` [], `business_impact` (pipeline never sets - NULL),
`autonomy_level` ∈ solo/contributed/led/unknown, `evidence_quality` ∈
weak/moderate/strong, `project_maturity` (never set - NULL),
`relevance_tags` [], `estimated_seniority_signal` ∈ intern/junior/mid/senior/
unknown (never set - NULL), `raw_ai_analysis` jsonb, `created_at`. Pipeline
upserts `ON CONFLICT(project_id)` - but table has NO unique constraint on
`project_id` (`profile-pipeline.ts:86-95`), so the upsert degrades to insert on
re-run (duplicate depth rows possible).

**`education`** (`:174-183`): `id`, `candidate_id` CASCADE, `institution`,
`degree`, `field_of_study`, `start_year/end_year` 1900-2100, `achievements`
(API writes "" path → NULL-ish; years parsed from free text via `/\d{4}/g`,
`api/candidates/route.ts:147-157`).

**`skills`** (`:186-192`): `id`, `name` UNIQUE (canonical e.g. `Next.js`,
`scikit-learn`, `OpenAI API`), `aliases` [], `category` ∈ frontend/backend/
mobile/data_ai/devops_cloud/tools, `created_at`. Seeded ~46 rows
(`seed_skills.sql:7-53`).

**`candidate_skills`** (`:195-204`): PK(`candidate_id`,`skill_id`), CASCADE /
RESTRICT, `experience_years` ≥0 (onboarding never sets - NULL),
`proficiency_level` ∈ beginner/intermediate/advanced/expert (never set),
`source` ∈ self_reported/extracted/verified, `evidence_strength` 0-100 (never
set). Onboarding links exact-name matches only, `self_reported`
(`api/candidates/route.ts:159-167`).

**`profile_chunks`** (`:210-221`): `id`, `candidate_id` CASCADE, `chunk_type` ∈
summary/experience/project/education/skills, `content_text` NOT NULL,
`metadata_json` (`{domain}` | `{project_id, technologies}` in practice),
`embedding vector(1024)` NULL until embedded, `embedding_model` dflt
`voyage-4-lite`, `embedding_dim` dflt 1024, `created_at`. HNSW cosine index
(`:470-475`, m=16, ef=64).

**`employers`** (`:224-236`): `id`, `user_id` → users SET NULL, `company_name`
NOT NULL, `company_email`, `website`, `company_size`, `industry`,
`verification_status` ∈ pending/verified/rejected/suspended dflt pending,
timestamps.

**`jobs`** (`:239-262`): `id`, `employer_id` → employers CASCADE, `title` NOT
NULL, `domain`, `seniority`, `description`, `responsibilities`,
`must_have_skills` [] / `nice_to_have_skills` [], `min/max_experience`,
`salary_min/max`, `salary_currency` dflt INR, `location`, `remote_policy`,
`employment_type`, `start_date`, `status` ∈ draft/active/paused/closed dflt
active, timestamps. (No API writes jobs - the deleted `/hire` UI searched WITHOUT
persisting a job row; `job_id` is NULL on all live searches.)

**`job_requirements`** (`:265-281`): PK `job_id` → jobs CASCADE, `must_have` /
`nice_to_have` [], `seniority`, `domain`, `location`, `salary_range` jsonb,
`remote_policy`, `core_responsibilities` [], `implied_technical_needs` [],
`full_parsed` jsonb, `embedding vector(1024)` + model/dim, `created_at`. **Dead
table**: zero writers in app code (no JD parser exists).

**`searches`** (`:284-292`): `id`, `employer_id` (NULL on live searches - search
is anonymous, `api/search/route.ts:152-157` inserts without it) → employers
CASCADE, `job_id` SET NULL (always NULL live), `query_text` (built query, the
cache key), `filters_json` (the JobReq), `result_count`, `created_at`.

**`candidate_matches`** (`:295-306`): `id`, `search_id` SET NULL, `job_id` SET
NULL (always NULL), `candidate_id` CASCADE, `score` 0-100 NULLABLE (NULL = fast
mode cache seed), `sub_scores` (never written - always {}), `match_reasons_json`
({} fast, judge object deep), `status` ∈ shown/shortlisted/contacted/rejected/
hired dflt shown, `created_at`.

**`shortlists`** (`:309-319`): `id`, `employer_id` CASCADE (NULL in practice -
hire page sends no employer_id), `candidate_id` CASCADE NOT NULL, `job_id` SET
NULL (NULL in practice), `status` ∈ saved/contacted/interviewing/offered/hired/
rejected dflt saved, `notes`, `created_at`, UNIQUE(employer_id,candidate_id,
job_id) - **NULLs don't dedupe in Postgres**, so code does manual JS dedupe
(`api/shortlists/route.ts:70-79`).

**`contact_log`** (`:322-330`): `id`, `employer_id` SET NULL (NULL in practice),
`candidate_id` CASCADE, `job_id` SET NULL, `channel` ∈ email/phone/platform/
other, `message`, `created_at`. Audit-only.

**`audit_logs`** (`:333-341`): `id`, `actor_id` (NULL = system; app never sets
it - always NULL), `action` (contact, employer_verified/rejected; contact route
also mirrors `contact`), `target_type`, `target_id`, `metadata`, `created_at`.

**`show_*` prefs (NOT in `schema.sql`, migration OPTIONAL):**
`show_email/phone/linkedin/github/portfolio/resume/photo` BOOL DEFAULT TRUE
added ONLY by `supabase/contact_prefs.sql:3-9`. The `applyContactPrefs` filter
exists but nothing sets the flags (form dropped per-channel toggles), so all
contact stays visible. Do not run the migration unless the toggles return.

### 3b. Indexes (`schema.sql:369-475`)

Btree: visibility+domain, salary, experience, location, availability, user_id,
freshness DESC; skills both dirs; work/projects/education/depth FKs; employer
user/verification; jobs employer/status/domain + GIN `must_have_skills`;
searches employer/job; matches search/job+score DESC/candidate; shortlists ×3;
contact_log ×2; audit (actor,time DESC)+(target). Trigram GIN
`f_unaccent(col) gin_trgm_ops` on candidate name/headline/role, company/title,
project title, job title, skill name, chunk content (`:445-462`). FTS GIN
`to_tsvector('english', content_text)` (`:465-466`) - unused by app (no
`tsquery` call anywhere). HNSW cosine on both embedding columns (`:470-475`).

### 3c. RLS model, plain words (`schema.sql:489-864`)

No anon policies → anon gets nothing. `authenticated` role granted everything
(`:869-873`) but RLS still filters. Helpers (SECURITY DEFINER, `:509-568`):
`is_admin`, `my_user_id`, `my_candidate_id`, `my_verified_employer_id` (NULL
unless verified), `is_verified_employer`, `owns_candidate`, `candidate_is_visible`.

- **Candidates own everything** under their id (candidates/profiles/work/
  projects/education/skills/chunks: owner ALL + admin; verified-employer SELECT
  only when `visibility_status='visible'` - **INCLUDING contact columns, no
  gate** (`:599-603` + mirrors). Depth: employer read via project join (`:660-668`).
- **`skills` reference:** any authenticated SELECT; admin-only write (`:683-702`).
- **`employers`:** owner ALL only (`:729-733`) - no cross-read.
- **`jobs`:** owner ALL + other verified employers may SELECT `status='active'`
  (`:738-757`) - market transparency (no UI uses it yet).
- **`searches/shortlists/contact_log`:** verified-employer-id-scoped ALL
  (`:793-797`, `:829-833`, `:841-845`); candidates may SELECT rows about
  themselves (`matches_candidate_read :823-826`, `shortlists_candidate_read
  :835-838`, `contactlog_candidate_read :848-851`) - transparency without gate.
  `candidate_matches` employer write requires owning search OR job (`:801-821`).
- **`audit_logs`:** any authenticated may INSERT; only admin SELECT (`:856-864`).
- **Backend bypass:** every API route + pipeline uses `supabaseAdmin()`
  (service_role, bypasses RLS). RLS bites only direct browser reads
  (login/signup linking, employer/verify form, admin page uses admin client
  anyway). **Consequence: route-level auth is mostly absent (§8).**

### 3d. Storage (`supabase/storage.sql:1-120`, mirrored in `web/`)

Private buckets `resumes|photos|portfolios` (`:25-30`). Browsers NEVER touch
Storage directly - `POST /api/uploads` (service_role) uploads + mints 1h signed
URL + writes path onto candidate row (`resume_url|photo_url|portfolio_url` per
`KIND_COLUMN`, `api/uploads/route.ts:49-53,135-143`); `GET /api/uploads` mints
fresh 1h URL for `{candidate_uuid}/{filename}` (`:151-180`, `PATH_RE` + `..`
reject `:163`). Policies additionally allow: owners CRUD own
`{candidate_id}/…` prefix (regex-guarded uuid cast, `:38-106`); verified
employers SELECT any visible candidate's files (`:112-120`). **Two parallel
resume paths:** Storage object path (uploads) vs external URL (Drive link in
`resume_url`) - `candidate/[id]` handles both (`signedLink`, `[id]/page.tsx:33-49`).

### 3e. Seeds

`seed_skills.sql`: ~46 canonical + aliases, upsert on name. `seed_demo.sql`:
1 verified demo employer + 2 jobs + 6 candidates (`@demo.local`, fixed
`aaaaaaaa…`/`bbbb…`/`cccc…` UUIDs) + 2 zero-vector (1024-dim) chunks each -
`match_chunks` returns ties → recency fallback without `VOYAGE_API_KEY`
(`seed_demo.sql:9-18`); wipe with `DELETE … WHERE contact_email LIKE
'%@demo.local'`.

---

## 4. AI / matching pipeline end to end

### 4a. Normalization - `lib/skills.ts:136-156`, `lib/validators.ts:115-119,167-176`

Free-text skills → canonical via `SKILL_ALIASES` map (JS→JavaScript,
Postgres→PostgreSQL, ML→Machine Learning…), case-insensitive dedupe. Applied as
zod `.transform(normalizeSkills)` on candidate `skills`, job `must_have`/
`nice_to_have` - so server sees canonical; client sends raw. Dropdowns use
`CANONICAL_SKILLS` (~70 entries covering tech + UI/Figma/SEO/Sales/Excel) +
`DOMAINS` (10) + `SENIORITIES` (intern–lead; note: `lead` has no counterpart in
`Seniority` type's `unknown`-style depth signals, harmless).

### 4b. Summary + project depth (cheap LLM) - `lib/ai.ts:1-39`

`chat()` → `defaultOpenAIProvider(cheapModel())`, `CHEAP_MODEL → JUDGE_MODEL →
minimax/minimax-m3:free` fallback (`matching/judge.ts:76-78`); returns NULL on
missing key (never throws). `generateCandidateSummary` (factual analyst, 8k
input/8k output cap, `:16-25`); `analyzeProjectDepth` (STRICT JSON:
technical_complexity/complexity_score/architectural_concepts/evidence_quality/
autonomy_level/relevance_tags/strengths/limitations, brace-extract parse,
`:27-39`).

### 4c. Chunking (implemented ⊂ documented)

Pipeline builds **2 shapes only** (`profile-pipeline.ts:39-54`): 1 `summary`
(`headline + domain + exp` - thin by design) + N `project` (`title +
description + tech + impact`, metadata `{project_id, technologies}`).
Documented `experience|education|skills` chunk types exist in CHECK constraint
and seed (`seed_demo` writes summary+project) but the pipeline never emits them.

### 4d. Embeddings - `lib/matching/voyage.ts:12-84`

`POST https://api.voyageai.com/v1/embeddings`, model **`voyage-4-lite`**,
`input_type: document` (chunks) vs `query` (job). Batch w/ index-order guard
(`:59-66`); throws w/ status+body slice on failure. Query text =
`Role / Domain / Must-have / Nice-to-have / Responsibilities`
(`buildJobQueryText`, `:87-106`). Dim recorded per row (`embedding_dim =
vectors[i].length`, `profile-pipeline.ts:106-107`) - 1024 in practice.

### 4e. Hybrid retrieval - implemented vs planned

**Was planned, now DELETED 2026-09-09** (`lib/matching/hybrid.ts`,
`lib/matching/scoring.ts` removed; had wrong column names, zero importers).

**Live retrieval** (`api/search/route.ts:95-144`): `embedQuery(queryText)` →
`rpc("match_chunks", {query_embedding, match_count:200})`. RPC
(`match_chunks.sql:3-22`): cosine `<=>` over `embedding IS NOT NULL` +
`visibility_status='visible'`, 200 rows. Voyage throw → `chunks=[]` → **recency
fallback** (`ORDER created_at DESC LIMIT`, `:136-144`). Zero-vector seeds tie at
distance ~1.0 → same fallback ordering.

### 4f. Group-by-candidate + cap (`api/search/route.ts:110-134`)

Chunks grouped by `candidate_id`; rank key = BEST (min) distance; **max 3 chunks
per candidate** (`:116`) so one chunk-rich profile can't dominate. Sort by best
distance, slice to `limit` (clamped 1-30, dflt 30; hire page sends 20). Hydrate
via `candidates SELECT … IN(ids) + visible` (`CAND_COLS`, `:107`), re-emit in
rank order with `best_distance + matched_chunks`. Comment credits "Qwen fixes"
(`:9-11`).

### 4g. Scoring weights (rules side exists, NOT wired into live search)

`lib/matching/scoring.ts:16-38`: `final = .25 semantic + .25 skill + .20 depth +
.15 constraints + .10 seniority` → `round(*100)`; `matchLevel` ≥75 strong / ≥50
partial / else weak (`:40-44`); `semanticFromDistance=(2-d)/2` (`:47-50`);
`skillScore` evidence-weighted (0/0.6/1 per skill, must .75 + nice .25, `:57-84`);
`depthScore` complexity×evidence, 0.6 max + 0.4 mean (`:102-115`);
`constraintsScore` salary×location 50/50, missing = neutral-good (`:121-147`);
`seniorityScore` exp .7 + title .3, >1.5× max = 0.6 overqualified (`:163-184`).
**Live `/api/search` fast path returns NO scores** (`score:null` persisted,
`:159-171`); rules helpers have zero callers outside their module.

### 4h. LLM judge rubric (deep mode only) - `lib/matching/judge.ts:45-233`

System prompt (`:45-53`): hiring-manager, 4 dims × 25 (technical depth /
relevance / impact-ownership / red-flags inverted 25=clean), use-only-provided,
strict JSON (`total_score + 4 subscores + best_project_match + fit + 2 questions
+ gaps + matched/missing/strengths/risks`). User prompt = job JSON + candidate
JSON sliced (job desc 4k, candidate 12k, `:55-71`). Provider: OpenRouter
chat-completions, `JUDGE_MODEL → minimax/m3:free` dflt, temp 0.2, `json_object`
mode, `HTTP-Referer/X-Title` headers (`:80-120`). `parseJudgeOutput` strips
fences, `total_score ?? Σ4`, clamps 0-100, level 75/50, questions ≤5 (`:139-192`).
`judgeTop(inputs, provider, concurrency=5 from route, dflt 10)` - worker-pool
parallel, per-item try/catch → null (`:210-233`). Deep path
(`api/search/route.ts:174-208`): top-10 rows → parallel fetch candidate+projects
→ judge → merge `{...row, judge}` → persist `score=judge.overall_score`.
Judge throw → 200 with `deepError` (graceful). Suggested `blendWithJudge`
0.7/0.3 (`scoring.ts:187-190`) documented but **never called** - merged rows
carry raw judge beside scoreless row.

### 4i. Search cache + invalidation (`api/search/route.ts:56-93,149-172`)

Fast mode only (`deep` bypasses). Key = exact `queryText`; TTL 1h (latest
`searches` row `created_at` newer than now-1h). Invalidation: ANY visible
candidate `updated_at > cached.created_at` → miss (single-row probe, `:70-75`).
Hit with rows → return `candidate_matches` joined candidates + `applyContactPrefs`
+ `{cached:true}`. Miss → live run → insert `searches` (no employer/job ids) +
seed `candidate_matches` (`score:null`, `{}`, `shown`) for cache seeding
(non-deep only). Deep persists scored rows but never reads cache.

### 4j. Quality score - `profile-pipeline.ts:114-127`

`q=20 +15 hasProjects +10 anyTech +15 anyImpact +10 anyDesc>100ch +10 hasExp
+10 ≥3 skills (limit-5 probe) +5 headline`, capped 100 → `profile_strength` +
`freshness_updated_at=now`. Evidence-rich outranks vague. (Seed demo rows carry
hand-set 64-90.)

---

## 5. Background jobs (Inngest)

Trigger: `POST /api/candidates` → `inngest.send("candidate.profile.submitted",
{candidateId})` in try/catch (dev-server-offline tolerant,
`api/candidates/route.ts:170-174`). Function `processProfile`
(`lib/profile-pipeline.ts:12-150`, registered `lib/inngest.ts:1-7`, served at
`api/inngest/route.ts:1-5`): `fetch-candidate → fetch-projects → build-chunks →
summary-depth (cheap LLM; summary upsert + per-project depth upsert loop) →
embed-store (Voyage batch → `embedding` string literal → DELETE+INSERT chunks) →
quality-score → mark-active (profile-ready email only; visibility NEVER forced,
`:129-146`)`. Returns `{candidateId, chunks}`. No explicit retry config -
Inngest step defaults ("step retries" per `lib/inngest.ts:7` comment).
**Failure semantics:** candidate-not-found throws (retried); LLM null → skip
write; **Voyage throw in `embed-store` throws → step retries, NO chunks stored
until success** (profile stays chunkless = invisible to vector search, visible
to recency fallback only if a prior chunk row exists - fresh candidates have
none until first embed succeeds); email always best-effort. No DLQ/slack, no
cron, no job_requirements writer.

---

## 6. Observability, emails, audit/contact logs

**Wide events** (`lib/observe.ts:1-55`): ONE JSON log per request via
`withWideEvent(route, handler)`; `wev.add()` business fields. **Only
`/api/search` is wrapped** (`api/search/route.ts:12`; fields: job_title, domain,
seniority, must_have count, limit, deep, cached, result_count, chunk_hits,
judged, search_id). Tail-sampled: status≥500 / error / >2000 ms always, else
10% (`observe.ts:26-28`); never throws; 500 catch-all (`:50-53`).

**Emails** (`lib/email.ts:1-120`): `sendEmail` via Resend; no-op
`{skipped:true}` without `RESEND_API_KEY` or bad recipient (`:24-32`); Resend
errors swallowed to skipped (`:43-51`). Templates: `profileReadyEmail`,
`newMatchEmail`, `contactLoggedEmail` (all link `NEXT_PUBLIC_SITE_URL`,
dflt localhost). Callers: pipeline ready mail, shortlist mail (generic "a role
you match"/"An employer" - no job/company lookup,
`api/shortlists/route.ts:93-100`), contact mail (generic in `/api/contact`
vs job+company-resolved in `/api/contacts`, `:55-72`).

**Audit/contact logs:** `contact_log` rows on both contact routes; `audit_logs`
mirror only in `/api/contact` (`action:'contact'`, no actor/metadata,
`api/contact/route.ts:45-54`) and employer verify/reject (`action:
employer_verified|rejected` + company metadata,
`api/admin/employers/route.ts:79-88`). No view/search/export logging despite
admin page copy claiming it (`admin/page.tsx:209-213`).

---

## 7. API reference (every route; all JSON; all use `supabaseAdmin` unless noted)

| Route | Method | Request | Response / codes |
|---|---|---|---|
| `/api/search` | POST | `{job: JobInput, limit? 1-30 dflt 30, deep?}` (zod `jobSchema`) | 200 `{results, queryText, searchId, cached?, deep?, deepError?}`; 400 zod errors; 500 via wide-event wrapper. Fast rows = candidate cols + `best_distance/matched_chunks`, NO scores; deep rows add `judge` (nullable entries tolerated) |
| `/api/candidates` | GET `?id=` XOR `?email=` | uuid-validated id or ilike email | 200 `{candidate, profile{summary_markdown/json,updated_at}, contact_log[50], matches[50], shortlists[50]}`; 400 missing/bad id; 404 not found |
| `/api/candidates` | POST | `CandidateInput` (name/email/phone|linkedin, location, role, domain, skills≥1, experiences/projects/education arrays, links, salary block, remote_pref, availability, `visibility` dflt visible, `consent:true`) | 202 `{candidateId, status:'processing'}` + Inngest fire-and-forget; 400 zod; 500 user/candidate insert fail. Reuses `users` row by email; child rows best-effort; maps remote remote/hybrid/onsite→remote_only/… (`:84-96`); portfolio_url ← portfolio OR linkedin (`:108`) |
| `/api/candidates` | PATCH | `{id, visibility_status: visible\|hidden\|inactive}` | 200 `{candidate}`; 400; 404 |
| `/api/candidates` | DELETE `?id=` or body `{id}` | uuid | 200 `{ok:true}` (cascades); 400; 500 |
| `/api/contact` | POST | `{candidate_id, job_id?, employer_id?, channel: email\|phone\|platform\|other, message? ≤4000}` | 201 `{contactId}` + audit mirror + generic mail; 400; 404 candidate; 500 |
| `/api/contacts` | POST | same, `channel` dflt `platform` | 201 `{id, status:'logged'}` + job/company-resolved mail; 400; 500. **Duplicate of `/api/contact`** (hire page uses `/api/contact`) |
| `/api/contacts` | GET `?candidate_id?&limit=1-100 dflt 50` | - | 200 `{results[{id,employer_id,candidate_id,job_id,channel,created_at}]}`; 500 |
| `/api/shortlists` | GET `?employer_id?&candidate_id?&job_id=` | uuids, "" dropped | 200 `{results[≤100 + candidates(id,full_name,headline,contact_email/phone)]}`; 400; 500 |
| `/api/shortlists` | POST | `{candidate_id, job_id?, employer_id?, notes? ≤2000}` | 201 `{shortlist}` (+generic mail) or 200 `{shortlist, deduped:true}`; 400; 404 candidate/job; 500 |
| `/api/shortlists` | DELETE `?id=` / `{id}` / `{candidate_id,job_id?,employer_id?}` (null-aware) | - | 200 `{ok:true}`; 400; 500 |
| `/api/uploads` | POST multipart | `file, kind: resume\|photo\|portfolio, candidate_id` (10 MB; resume=pdf; photo=jpg/png; portfolio=pdf/jpg/png; ext+mime double-check) | 201 `{bucket,path,signedUrl,expiresIn:3600}` + candidate col write; 400 validation; 404 orphan; 409 dup; 500 sign fail. `runtime:nodejs, force-dynamic` |
| `/api/uploads` | GET `?bucket=resumes\|photos\|portfolios&path={uuid}/{file}` | - | 200 same shape; 400 bad bucket/path; 404 missing |
| `/api/drive-check` | GET `?url=` | http(s) | 200 `{status: reachable\|restricted\|unknown\|invalid, reason?/note?/http?}`; 400 non-URL. Drive: `uc?export=download&id=` + UA spoof, login-wall/403/404→restricted, html→reachable-with-confirm (`:20-40`); non-Drive: HEAD check, 8s timeout |
| `/api/admin/employers` | GET `?status=pending\|…\|all` | **admin only** (`requireRole`) | 200 `{employers[≤100 + account_email]}`; 401/403; 500 |
| `/api/admin/employers` | POST `{employerId, action: verify\|reject}` | admin | 200 `{employer}` + audit; 400; 401/403; 500 |
| `/api/admin/bootstrap` | GET `?email=` | open, first-run only | 200 `{ok,admin}`; 400 bad email; 403 admin exists; 404 email not signed up |
| `/api/inngest` | GET/POST/PUT | `serve({client, functions})` | Inngest protocol |
| `/auth/callback` | GET `?code=&role?=&next?=` | code exchange → cookies → ensure users row → role redirect | 302 (`/admin`, `/employer/verify`, `/candidate`); missing code/session → `/login?error=` |

---

## 8. Auth model

Roles `candidate|employer|admin` (`lib/auth.ts:4`). Supabase Auth owns
credentials; `public.users` owns roles (`auth_id` link). **Three Supabase
clients** (`lib/supabase.ts:8-31`, `lib/supabase-server.ts:6-28`):
`supabasePublic` (anon, unused-by-pages), `supabaseBrowser` (cookie-synced,
all client pages), `supabaseServer` (cookie RLS user), `supabaseAdmin`
(service_role, ALL routes + pipeline + admin/dossier pages). `getSessionUser`
reads auth user then users row via admin client (`auth.ts:36-55`, null-safe);
`requireRole` throws `AuthError(401)` anon/no-row, `403` suspended/role-mismatch
(`:64-82`). **Middleware** (`middleware.ts`, since **deleted**) only refreshed
session on every non-static request - enforces NOTHING. Enforcement points:
`api/admin/*` (401/403 JSON), `/admin` (denied card), `/employer/verify`
(client redirect + role message), `/auth/callback` (links pre-existing email
rows, sets `auth_id`, `email_verified:true`, role from `?role` → metadata →
candidate dflt; `next` allow-listed to `/`-paths). Login/signup
(`login/page.tsx:25-76`, `signup/page.tsx:18-50`) link-or-create users rows by
`auth_id` then email, route home by role (admin→`/admin`,
employer→`/employer/verify`, else `/candidate`). **Gap: every non-admin API
(candidates/search/shortlists/contacts/uploads/drive-check) is unauthenticated
- anyone can create candidates, log contacts, mint signed URLs for any known
candidate UUID, toggle any visibility, delete any profile.** RLS is bypassed
by design (service_role) and not re-checked in code.

---

## 9. Scripts + test status

| Script | What | Creds / notes |
|---|---|---|
| `scripts/smoke.sh` / `smoke.ps1` (`:1-34`) | GET `/` =200; POST `{}` to search/shortlists/contacts =400 | `BASE_URL` dflt localhost:3000; exit 1 on fail |
| `scripts/e2e-test.mjs` (`:1-57`) | fast search contains "Test Candidate" → shortlist save+list → `/api/contact` 201 → candidate GET → deep search responds (judge-missing tolerated) | expects **`reset-test-data`** seed (name "Test Candidate"), NOT `seed_demo.sql` names; reads `.env.local` at runtime (URL only); `BASE_URL` |
| `scripts/reset-test-data.mjs` (`:1-79`) | wipes 17 tables FK-order → deletes `@test.com`/`@demo.local` auth users → creates auth+users → verified employer+job → candidate+skills+project+summary+2 zero-vector chunks | **TEST creds (safe):** `admin@test.com` / `employer@test.com` / `candidate@test.com`, all `Test@1234`; reads `.env.local` service key at runtime |
| `scripts/bootstrap-admin.mjs` (`:1-44`) | promote oldest user if no admin (masked log) + verify all pending employers | runtime `.env.local`; exits if no users |

No unit framework, no CI config in repo. E2E `loadEnv` parses `.env.local`
(simple `KEY=val` regex, strips quotes) but only uses URL/key for Supabase.
Smoke covers validation-shape (400-not-500) only, not happy paths.

---

## 10. Optimizations inventory + gaps/risks/backlog

**Live optimizations:**
- Group-by-candidate + 3-chunk cap + best-distance rank, 200-chunk RPC window
  (`api/search/route.ts:95-134`).
- Search cache 1h + single-probe invalidation on `candidates.updated_at`
  (fast path only; deep always live, `:56-93`).
- Parallel judge worker-pool (concurrency 5 from route, `:185`), parallel
  candidate+projects fetch per judged row (`:179-184`), per-item null tolerance
  (`judge.ts:210-233`).
- Pipeline caps: judge input 12k/4k slices, summary 8k/8k, project depth 4k
  input (`judge.ts:55-71`, `ai.ts:21-38`); child-row + email + audit all
  best-effort try/catch; recency fallback on Voyage/RPC fail.
- Observability sampling: 10% happy-traffic, 100% errors/slow (`observe.ts:26-28`).
- `DdiivvShader` GPU guards: 2.4 MP cap, DPR ≤2, 30 fps ambient cap
  (time-accumulated so motion stays on schedule), IntersectionObserver +
  `visibilitychange` + `prefers-reduced-motion` freeze, WebGL2 fail → `onError`
  (`DdiivvShader.webgl.tsx:285,294-324,362-368,389-394,455-466`); 2D engines
  (`FlowerLattice`, `BondType`) same intersection/visibility/reduced-motion +
  DPR ≤2 + debounced resize (`FlowerStrip.tsx:12-54`, `BondLogo.tsx:20-67`);
  `BondLogo` lazy-loads `Press Start 2P` via `document.fonts.load` (`:35-39`).
- Fonts via `next/font/google` (self-hosted, CSS vars, no render-blocking
  Google request) (`layout.tsx:6-8`); resume iframe `loading=lazy` +
  click-to-load (`ResumeViewer.tsx:11-43`); accordion is CSS-grid (zero-lag,
  `ExperienceAccordion.tsx:39-48`).

**Known gaps / risks / backlog (all verified):**
1. Unauthenticated mutating APIs (§8) - ANY caller can write candidates,
   shortlists, contact logs, delete profiles, mint file URLs.
2. ~~`hybrid.ts` + `scoring.ts` rules~~ DELETED 2026-09-09 (were dead:
    wrong column names, zero importers). Live search = RPC + group-by-candidate
    + judge-merge only; fast results unscored. `job_requirements` table + FTS
    index + `CandidateRow` type remain unused.
3. Pipeline emits 2 chunk shapes (summary+project); experience/education/skills
   chunks, `original_resume_text`, `profile_json`, `metrics`, `business_impact`,
   `project_maturity`, `estimated_seniority_signal` never populated.
4. `project_depth_analysis` lacks UNIQUE(`project_id`) → re-runs duplicate rows
   despite `onConflict:"project_id"` intent.
5. `embed-store` all-or-nothing: Voyage outage = zero chunks = candidate
   unsearchable (no partial/keyword index to fall back to per-candidate).
6. Cache key is exact query text (whitespace/case variants miss); no
   employer/job scoping (anonymous shared cache); `score:null` rows pollute
   `candidate_matches` analytics.
7. Duplicate `/api/contact` vs `/api/contacts` (different response shapes,
   mail richness, GET support) - keep one.
8. `contact-prefs` dormant BY DESIGN (per-channel toggles dropped from the
   form; `supabase/contact_prefs.sql` optional, nothing in API code references
   `show_*`, filter treats missing flags as visible). Do NOT run the migration
   unless per-channel visibility returns to the form.
9. `shortlists`/`contact_log`/`searches` `employer_id`/`job_id` NULL in practice
   (no job CRUD, no session binding) → per-employer history/analytics broken.
10. No rate limiting on search despite hire-page copy claiming it
    (`hire/page.tsx:232`); no search audit rows; `audit_logs.actor_id` always
    NULL.
11. `matching/README.md` TODO section describes unbuilt integration (pg client,
    grouping, fast/deep split) as future - all built differently since.
12. `web/README.md` is stock create-next-app (Geist/Vercel) - describes nothing
    real. `DESIGN-SYSTEM.md` token values drift from `globals.css` (e.g. royal
    `#1d4ed8` vs `#bc3b24`, paper `#efe6d0` vs `#fafaf8`).

---

## 11. What `docs/` got WRONG vs implementation (explicit corrections)

1. **Embedding model: `voyage-4-lite` (1024-dim), NOT alternatives.**
   `docs/07` says "text-embedding-3-large or BGE-M3"; code + schema + seeds +
   env are unanimous voyage-4-lite (`voyage.ts:14-15`, `schema.sql:207-220`,
   `.env.example:6-7`, `seed_demo.sql:11`). Any `voyage-3-lite` reference is stale.
2. **LLM: OpenRouter `https://openrouter.ai/api/v1`, `minimax/minimax-m3:free`
   for BOTH cheap and judge** (`judge.ts:74-85`, `.env.example:10-13`). NOT
   OpenAI-direct; NOT `gpt-4o-mini` (only appears as a stale comment in
   `matching/README.md:23`).
3. **"Hidden-contact gate removed" is accurate - but `show_*` prefs were NOT
   dropped.** `docs/09` + README claim pure open-contact; implementation
   ADDS optional per-channel filtering: `applyContactPrefs`
   (`lib/contact-prefs.ts:13-23`) nulls any channel whose `show_*===false`,
   applied in fast search (`api/search/route.ts:83-86,146`), deep search, and
   dossier page (`candidate/[id]/page.tsx:79-83`). This is candidate-chosen
   channel hiding, not an approval gate - docs conflate the two.
4. **`contact_prefs.sql` is REQUIRED, not superseded.** `schema.sql` does NOT
   create `show_*` columns; only `supabase/contact_prefs.sql:3-9` does (7× BOOL
   NOT NULL DEFAULT TRUE). Without running it the filter is a silent no-op;
   with it, defaults keep everything visible. Run order: schema → contact_prefs.
5. **Hybrid SQL builders don't match the schema (dead code).** `docs/07-08`
   funnel (prefilter → vector+keyword → RRF → rules → judge → blend) is
   implemented as: RPC vector → group-by-candidate → optional judge-merge.
   `hybrid.ts` references `is_visible/consent_to_match/is_active/remote_ok/
   location/pc.text/pc.metadata` - schema has `visibility_status/
   consent_status/location_city/remote_preference/content_text/metadata_json`.
   RRF, keyword arm, hard-filter SQL, `combineRanks` never execute.
6. **Scoring weights live in code, not docs.** Effective rule weights
   `.25/.25/.20/.15/.10` + `blendWithJudge` .7/.3 (`scoring.ts:16-22,187-190`)
   supersede `docs/12`'s "alt simple" 0.35/0.25/0.15/0.10/0.10/0.05 sketch -
   and neither runs in live fast search (unscored rows).
7. **Judge output shape ≠ docs/13 §5 claim.** Live parser keeps
   `total_score/4 subscores/best_project_match/fit/questions/gaps/
   matched/missing/strengths/risks` and hardcodes `salary/location/seniority_fit:
   "unknown"` (`judge.ts:170-191`) - no salary/location/seniority labels from
   the LLM despite `MatchScore` type declaring them.
8. **Chunk inventory: 2 shapes, not 5.** `docs/08` lists
   summary/experience/project/education/skills; pipeline emits summary+project
   only (`profile-pipeline.ts:39-54`).
9. **Pipeline step list: 7 `step.run`s, not "normalize → summary → depth →
   chunks → embed".** Live: fetch-candidate → fetch-projects → build-chunks →
   summary-depth → embed-store → quality-score → mark-active. No separate
   normalize step (normalization is zod-transform at intake); chunks built
   BEFORE summary (summary text never embedded - summary chunk is just
   headline+domain+exp).
10. **Quality-score formula is code-only** (§4j) - absent from all `docs/`.
11. **Cache design is code-only** (exact-text key, 1h TTL, `updated_at`-probe
    invalidation, deep bypass, §4i) - `docs/` describes "cache repeat
    searches" as TODO (`matching/README.md:44`).
12. **Two contact routes exist; docs describe one flow.** Both write the same
    table with different response/mail behavior (§6-7).
13. **Salary `stipend` frequency IS in schema** (`schema.sql:80-81`) though
    validators allow only hourly/monthly/yearly (`validators.ts:35,133-139`) -
    UI can never submit `stipend`; DB accepts it from raw SQL only.
14. **`users.status`/`employers` suspension paths** exist in schema + `requireRole`
    (403 on suspended) but no UI/API sets suspended - dead state.
15. **Docs promise search rate-limit + view/export audit; neither exists**
    (hire copy `hire/page.tsx:232`, admin copy `admin/page.tsx:209-213` vs §6).
