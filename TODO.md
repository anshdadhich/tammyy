# TODO — full audit findings (from 5 subagent audits)

Source: parallel read-only audits of search/scoring, API routes/data layer,
auth/security, frontend/UI, and Cloudflare runtime, plus the FTS ranking item.
**Status legend:** `FIXED` = patched in the current (uncommitted) working tree,
`TODO` = not yet done. Line refs point at the code as of this writing.

---

## A. Cloudflare runtime (Task 5) — includes the two biggest items in the list

1. **[critical][FIXED]** Workflow steps run outside the request path, so
   `getCloudflareContext()` was empty and every pipeline step threw — the
   profile pipeline was dead on deploy. `src/lib/cf.ts` now has
   `setRuntimeEnv()` and `ProfilePipelineWorkflow.run` publishes `this.env`
   before any step (`src/cloudflare/profile-pipeline.ts`).
2. **[critical][FIXED]** Same root cause broke secret reads (`RESEND_API_KEY`,
   `OPENROUTER_API_KEY`, …) inside workflow steps — `process.env` is only
   populated during fetch init. Added `populateSecrets()` mirroring binding
   secrets into `process.env` in the workflow entry.
3. **[bug][FIXED]** Vectorize `topK` exceeded the API cap (50 with
   `returnMetadata: "all"`); a 600 fetch budget made queries fail and search
   silently returned zero. Now capped at 50.
4. **[bug][FIXED]** Vectorize returns `score`, not `distance` — every chunk was
   scored at distance=1 (this was the search/ranking auditor's #1 too).
   Now converts `distance = 1 - score` (cosine metric).
5. **[bug][TODO-DECISION]** Recall cap: Vectorize has no pagination, so retrieval can
   only see the top-50 chunks. Widen by fetching ids from Vectorize (no
   metadata) then joining chunk text from D1 (`profile_chunks.content_text`),
   or push filters into Vectorize metadata filtering.
6. **[bug][FIXED]** D1 bound-parameter cap (100/query): the visibility query is
   batched (90-id batches), but `inArray(..., p_candidate_ids)`
   (`retrieval.ts:180`) is caller-controlled and unbatched — chunk it and
   filter in JS instead.
7. **[bug][TODO]** Upload/download paths blow the 10ms CPU budget with R2
   unbound: `request.formData()` + 10MB `arrayBuffer()` + full-file regex
   scans (`uploads/route.ts:67-80, 279, 324`) and full-buffer downloads
   (`:485`). Require the presign path in production (503 otherwise) and
   stream range reads.
8. **[bug][FIXED]** Per-key rate limits were spoofable via first-hop
   `x-forwarded-for`. Now prefers `cf-connecting-ip`
   (`src/lib/rate-limit.ts`).
9. **[bug][TODO]** Orphaned vectors accumulate in Vectorize when chunk text
   changes — old ids are never deleted (`deleteChunksForCandidate` exists but
   is never called; `profile-pipeline.ts:234-242` only reuses unchanged ids).
   Diff old vs new ids and `deleteByIds` the leftovers.
10. **[bug][TODO]** Nondeterministic chunk ids break step idempotency: summary
    chunk id is `summary-${crypto.randomUUID()}` and `content_hash` is a
    random UUID (`profile-pipeline.ts:48, 248`), so re-runs can't detect
    unchanged content and compound #9. Derive both from SHA-256 of
    candidateId + content.
11. **[bug][FIXED]** `embedTexts` dropped blank strings, breaking index
    alignment for callers that zip vectors back to inputs. Now throws on
    blank input and returns one vector per input.
12. **[bug][FIXED]** Workflow instance ids inconsistent: routes use
    `candidateId-${Date.now()}` (`candidates/route.ts:543`,
    `candidates/summary/route.ts:38`) so reruns pile up; `enqueueProfilePipeline`
    (`profile-pipeline.ts:286`) uses `id: candidateId` and is dead code. Pick
    one scheme, dedupe, wire up or delete the helper.
13. **[inconsistency][FIXED]** `StorageNotConfiguredError` is thrown but
    `isStorageNotConfigured` is never used, so uploads report a generic 500
    instead of "storage not configured" (`storage.ts:31-44`,
    `uploads/route.ts:352`). Map it to 503 with a clear message.
14. **[inconsistency][FIXED]** `.gitignore:34` (`.env*`) also ignores
    `.env.example`, so the sample env file can't be shared. Add
    `!.env.example`.
15. **[inconsistency][FIXED]** `.env.example` documents the old stack
    (MongoDB/Inngest/Voyage) and `mongodb@^7.7.0` is an unused dependency
    (`package.json`). Rewrite for the actual bindings (SESSION_SECRET,
    RESEND_*, OPENROUTER_*, BOOTSTRAP_*) and drop `mongodb`.
16. **[inconsistency][FIXED]** `EMBEDDING_TIMEOUT_MS` is declared but never
    applied to `env.AI.run` (`embeddings.ts:9, 36`). Race the call against it.
17. **[improvement][TODO]** `incrementalCache: "dummy"` (`open-next.config.ts`)
    makes any future `revalidate`/ISR a silent no-op. Switch to the R2
    incremental cache + `NEXT_INC_CACHE_R2_BUCKET` when R2 lands.
18. **[improvement][FIXED]** RateLimiter DO prune trigger switched from the
    near-dead modulo-of-size check to an absolute fetch counter (prune-on-load
    was already added).
19. **[improvement][TODO]** Vectorize metadata near the 10KiB/vector cap:
    slice `project_title` and cap serialized metadata size before upsert
    (`retrieval.ts:215`), keeping `content_text`/`candidate_id` intact.
20. **[improvement][TODO]** Cached search path re-parses large JSON blobs per
    request inside the 10ms budget (`search/route.ts:383-415`). Flatten to
    columns or cap cached rows.
21. **[ops][TODO]** Set deployed secrets via `wrangler secret put` for
    SESSION_SECRET, BOOTSTRAP_SECRET, RESEND_*, OPENROUTER_*, BOOTSTRAP_ADMIN_EMAIL
    (the last one is now mandatory for `/api/admin/bootstrap`).
22. **[verified-no-change]** MRL truncation is the correct Matryoshka prefix
    (`embeddings.ts:16-18`). One residual check: confirm
    `tammy-profile-chunks-512` really is 512-dim (`wrangler vectorize describe`).
23. **[verified-no-change]** Compat flags (`nodejs_compat`,
    `global_fetch_strictly_public`), DO `new_sqlite_classes`, and
    `WORKER_SELF_REFERENCE` are all correct as configured.

---

## B. Search & scoring (Task 1 + the FTS item)

24. **[bug][FIXED]** Vectorize `score` vs `distance` — see A4.
25. **[bug][FIXED]** Freshness subscore was dead: the scoring select never
    fetched `updated_at`. Now included (`search/route.ts` scoring select).
26. **[bug][FIXED]** Salary unit mismatch: retrieval and scoring now
    annualize by frequency (incl. `weekly`), and the validator enum accepts
    `weekly`. **[TODO remainder]** The job side has no frequency at all — a
    monthly-entered cap still silently excludes everyone. Either annualize
    the job side (`JobReq.salary_frequency` is declared but never set) or
    label the UI input as annual (`search-client.tsx:439-445`).
27. **[bug][FIXED]** FTS regex `\b…\b` could never match terms ending in
    non-word chars (C++, C#, .NET) and FTS was a hard filter, dropping those
    candidates entirely. Now lookarounds `(?<![\w])…(?![\w])`.
28. **[bug][FIXED]** Retrieval failure was misreported as "no strong matches" —
    `matchChunks` swallowed Vectorize errors and returned `[]`, making the
    route's fallback dead code. Now rethrows so the route can set `degraded`
    honestly.
29. **[bug][FIXED]** The 40s deep-judge `Promise.race` discarded completed
    judge work on timeout. Removed — per-call judge timeouts already bound it.
30. **[bug][FIXED]** Deep cache silently dropped candidates whose judge failed
    (rows with no judge payload were filtered out of cached results). Cached
    rebuild now keeps rule-scored rows too.
31. **[inconsistency][FIXED]** `SubScores` was duplicated and stale in
    `matching/types.ts` (missing `freshness`). Duplicate removed.
32. **[inconsistency][FIXED]** Remote/location scoring: an onsite job no longer
    passes a remote-only candidate at 0.8; city match is now scored from
    `locationCity` (`scoring-live.ts`).
33. **[inconsistency][FIXED]** "inactive" availability now scores 0.15 instead
    of the unknown-value 0.4.
34. **[inconsistency][FIXED]** Seniority-band fill is unreachable for API
    clients: `jobSchema` defaults `max_exp` to 5 but `rangeUnconstrained`
    requires ≥50 (`search/route.ts:129`, `validators.ts:190`). Default
    `max_exp` to 50 or treat schema defaults as unconstrained. (An attempted
    fix landed but is dead code — `parsed.data` always carries the keys.)
35. **[inconsistency][FIXED]** Attach caps kept arbitrary rows (no ORDER BY).
    Now ordered by recency (`start_date`/`created_at`/`end_year` DESC).
36. **[improvement][FIXED]** Judge depth fetch scanned the entire
    `projectDepthAnalysis` table. Now filtered to the top candidates' project
    ids.
37. **[improvement][FIXED]** Judge input is incomplete both ways: the job
    payload omits salary/location/remote/exp_max (`judge.ts:52-66`) and the
    candidate payload omits skills, education, OSS, `salary_frequency`
    (`search/route.ts` judge inputs) — so `salary_fit/location_fit/seniority_fit`
    are hardcoded "unknown". Pass the full fields.
38. **[inconsistency][FIXED]** Salary frequency vocabularies now agree
    (hourly/weekly/monthly/yearly everywhere).
39. **[inconsistency][FIXED]** Location filter is now a real prefix match
    (`%pattern%` → `pattern%`), comment corrected.
40. **[inconsistency][TODO]** Hardcoded/duplicated judge config: route
    redefines `JUDGE_TIMEOUT_MS`, the 40s magic number is gone but the model
    resolution is inconsistent (`CHEAP_MODEL` vs `JUDGE_MODEL` honored in
    different places). Consolidate into `judge.ts`.
41. **[inconsistency][TODO]** Mongo-era residue: `metadataStringArray` probes
    nested `metadata_json`/`metadata` (Vectorize metadata is flat) and
    `loadCachedMatches` fabricates a Mongo-style populate shape. Clean both.
42. **[improvement][TODO]** `p_availability` retrieval param is always null
    from the route — dead code (`retrieval.ts:119-121`). Wire it through or
    delete it.
43. **[known-item][FIXED]** FTS terms were a filter, not a ranking signal
    (no BM25/RRF). Implemented two-arm hybrid retrieval with Reciprocal Rank
    Fusion in `retrieval.ts` (semantic cosine arm + lexical term-frequency arm,
    `1/(60+rank)` fusion). **[TODO verify]** and **[TODO CPU]** — the lexical
    arm currently scans `profile_chunks` in JS (`lexicalArm`, limit 600 rows),
    which is a CPU-budget risk at corpus scale; move scoring into SQL
    (FTS index or per-term `LIKE` counts) before real traffic.

---

## C. Auth & security (Task 3)

44. **[critical][FIXED]** `/api/auth/claim` allowed account takeover: it set
    passwords on passwordless rows (any role) and linked orphan candidate
    rows with zero proof of email ownership. Now: candidate-role gate, session
    revocation on password set, and a signed ownership token required
    (`claim/route.ts`).
45. **[critical][FIXED]** The email-change "verification" token was minted for
    the requester and returned in the response — proving nothing. Now emailed
    to the new address only; the response never contains it
    (`session/email-change/route.ts`).
46. **[critical][FIXED]** Supporting piece: `/api/auth/verify-email` sends the
    ownership-confirmation link (same response regardless of account state —
    no enumeration).
47. **[bug][FIXED]** Rate limits failed open on counter errors; `auth-*` and
    `admin-*` keys now fail closed (`rate-limit.ts`).
48. **[bug][FIXED]** RateLimiter DO allowed malformed requests to pass and
    colliding `undefined` keys; now validates `key`/`limit`/`windowMs` and
    rejects invalid ops (`cloudflare/rate-limiter.ts`).
49. **[bug][FIXED]** Bootstrap endpoint accepted the secret in the request body
    and allowed promoting any row when `BOOTSTRAP_ADMIN_EMAIL` was unset. Now
    header-only secret and a mandatory allowlist (`admin/bootstrap/route.ts`).
50. **[improvement][FIXED]** Session cookie `Secure` no longer depends on
    `NODE_ENV === "production"` (unset on Workers meant HTTP cookies). Now
    Secure whenever not explicit dev (`session.ts`).
51. **[improvement][FIXED]** scrypt verification trusted stored params (crafted
    hash could burn unbounded DO CPU). Now caps `n ≤ 2^15`, `r ≤ 16`, `p ≤ 8`.
52. **[improvement][FIXED]** RateLimiter DO cold-loaded every key ever written;
    expired keys are now pruned on load.
53. **[improvement][FIXED]** Password-set paths revoke existing sessions
    (both claim and signup paths).
54. **[improvement][TODO]** Password policy is minimal (≥8 chars only) and
    registration/password state is probeable (distinct 409 "exists" and
    "Incorrect password" responses). Consider a breach-list check and
    response consolidation where UX allows.
55. **[improvement][FIXED]** CSRF: same-origin Origin/Referer check added to readJsonBody as defense-in-depth.
    Holds for the current POST/DELETE-only mutation surface; add per-session
    CSRF tokens for defense-in-depth or document the invariant.

---

## D. Frontend & UI (Task 4)

56. **[bug][FIXED]** Enter in the ChipPicker input both added a chip and
    advanced the step (or published on step 7). `stopPropagation()` added
    (`join-fields.tsx`).
57. **[bug][FIXED]** Wizard error banner was wiped by `goTo()` right after it
    was set — error ordering fixed (`join-wizard.tsx`).
58. **[bug][FIXED]** DitherCanvas never re-uploaded its GL buffer after
    `webglcontextrestored`, so a GPU reset left a blank canvas. Buffer is
    rebuilt on restore (`DitherCanvas.tsx`).
59. **[bug][FIXED]** Admin plan select showed "free" for every employer
    (stored plan was never returned) and touching it silently sent
    `set_plan`. `listAdminEmployers` now returns `plan` and the UI seeds from
    it (`admin-employers.tsx`, `admin-employers.ts`).
60. **[bug][FIXED]** Talent page rendered 404 on transient fetch failure (it
    self-fetches via `NEXT_PUBLIC_SITE_URL` falling back to localhost).
    404 now means "missing"; real failures throw to the error boundary
    (`talent/[id]/page.tsx`).
61. **[bug][FIXED]** Nav auto-hide yanked the open mobile menu off-screen.
    Hide is skipped while the menu is open (`AppNav.tsx`).
62. **[bug][FIXED]** `layoutId` pills animated via motion springs that ignored
    `prefers-reduced-motion`. Both pills use `useReducedMotion()` with
    `duration: 0`.
63. **[bug][FIXED]** Talent salary line mislabeled unknown frequencies as
    "/ month".
64. **[inconsistency][FIXED]** Dev-only "Autofill test data" button is now
    gated behind `NODE_ENV !== "production"`.
65. **[inconsistency][FIXED]** Per-field password toggles: `showConfirm` state
    exists but the confirm field may still lack its own show/hide button —
    finish the split (`login-form.tsx`).
66. **[a11y][FIXED]** Skip link now moves focus (`<main tabIndex={-1}>`).
67. **[a11y][FIXED]** `aria-live` no longer re-announces the whole stage list
    every 450ms; single "Step n of N" status line (`searching-panel.tsx`).
68. **[a11y][FIXED]** Password show/hide buttons keyboard-reachable
    (`tabIndex={-1}` removed).
69. **[a11y][FIXED]** Fake `role="combobox"` on the native datalist input
    misinforms screen readers (`join-wizard.tsx:929-944`). Drop the attrs.
70. **[a11y][FIXED]** Admin tablist — now aria-pressed toggle buttons/`aria-controls`/roving
    tabindex (`admin-employers.tsx:103-111`). Use `aria-pressed` toggles or
    real tab semantics.
71. **[a11y][TODO]** Admin domain-match verdict exists only in a hover `title`
    (`admin-employers.tsx:150`) — invisible to touch/AT.
72. **[forms][FIXED]** Logout has pending handling and won't double-fire.
73. **[forms][FIXED]** Admin `busy` guard is ref-based now (two rapid clicks on
    different rows both submit) — use a ref-based guard
    (`admin-employers.tsx:72-74`).
74. **[forms][FIXED]** Admin clears rows while loading with no loading indicator during
    tab switches — add a skeleton/clear.
75. **[forms][FIXED]** `runSearch` has AbortController + 90s timeout; a hung request parks
    the searching panel forever. AbortController + cancel button
    (`search-client.tsx:113-166`).
76. **[forms][FIXED]** Wizard renders gated on `hydrated` the empty form
    (`setTimeout(0)` restore) — gate render on `hydrated`
    (`join-wizard.tsx:231-238`).
77. **[mobile][FIXED]** Coarse-pointer 44px tap targets for `.chip-x`,
    `.btn-sm`, `.nav-avatar`.
78. **[reduced-motion][FIXED]** Checklist replay and the searching-panel stage
    clock now snap to the end state under `prefers-reduced-motion`.
79. **[inconsistency][FIXED]** Dead reduced-motion overrides cleaned; `.spin` exempted
    (`globals.css:2179-2184`) are overridden by the blanket `*` rule — delete
    them or exempt `.spin`.
80. **[inconsistency][FIXED]** Duplicated nav rules consolidated (`.site-brand`,
    `.site-nav-actions`, `.site-nav-link`, `.site-navbar-wrap`,
    `.match-mode-switcher`) with later blocks overriding earlier — fold the
    "Sliding nav pill" section back into the originals (`globals.css`).
81. **[verified-no-change]** Logged-out nav is uniform (Candidates / Employers /
    Match engine / FAQ), landing anchors + scroll-spy resolve correctly, both
    `layoutId` pills are single-instance, duplicate-submit guards present on
    all forms, empty states exist, contrast passes AA in both themes, and the
    z-index stack has no conflicts.

---

## E. API routes & data layer (Task 2 — preserved from the stalled agent's final thoughts)

82. **[bug][FIXED]** Shortlists upsert now backed by `shortlists_unique` (job_id '' sentinel, migration 0001 applied) that does
    not exist — only PK on `id`, so `onConflictDoNothing()`
    (`shortlists/route.ts:278`) never conflicts and duplicates accumulate
    (the fallback select at `:281` is dead). Fix needs care: SQLite treats
    NULLs as distinct in unique indexes, so use a partial unique index or a
    normalized `job_id` sentinel.
83. **[bug][FIXED]** Search cached path projection aligned with fresh path (no user_id/consent_status) and `consent_status`
    (`search/route.ts:366` spreads the full candidate row) while the fresh
    path selects explicit columns and excludes them. Cached results expose
    them to HR viewers — align the projections.
84. **[bug][TODO]** PUT email change is not transactional: `users.email` is
    updated before `candidates.contact_email` (`candidates/route.ts:1188-1202`
    then later) — a failure between them leaves identity mismatch. Wrap in
    `db.transaction`/`batch`.
85. **[bug][FIXED]** PUT skills replace preserves non-self-reported links: the
    block deletes all `candidate_skills` rows and re-inserts only
    `canon`/`self_reported` names (`candidates/route.ts:~1390-1440`), and the
    restore path also uses `source: "self_reported"`. Preserve non-self-reported
    links.
86. **[bug][TODO]** `replaceChildren` delete+insert is not transactional
    (`candidates/route.ts`); the restore path re-inserts with **new random ids**
    and drops `evidence_links`, so a failed insert loses original ids. Use
    `db.batch`.
87. **[bug][TODO]** Uploads `finalize` recomputes the object path with a fresh
    `Date.now()` and never reads the client's `path` — it can never find the
    uploaded object (`uploads/route.ts` `handleJsonUpload`). Also no UI caller
    exists yet (join wizard takes `photo_url` as a text field). Fix the
    contract (accept `b.path`, validate it) before wiring the UI.
88. **[inconsistency][TODO]** Deep cache stores judge payloads as
    `match_reasons_json`, so a later **non-deep** cache hit reads the judge
    payload as `sub_scores` — shape mismatch. Tag rows with a result kind.
89. **[inconsistency][TODO]** Cached non-deep results omit `match_level` and
    `top_skills` (fresh path includes them) — UI degrades silently
    (`search/route.ts:366` flatten vs `:657-659`).
90. **[inconsistency][TODO-DECISION]** `corpusUnchanged` only checks the `candidates`
    table; pipeline-completed chunks (`profile_chunks` written later) don't
    bump `candidates.updated_at`, so a cached search can ignore an enriched
    profile for up to an hour. Bump `updated_at` (or a dedicated version) when
    the pipeline finishes.
91. **[inconsistency][TODO]** Cached searches don't insert a `searches` row, so
    they're free against the quota; and `/api/search` rate limits omit
    `principal` (falls back to client IP only) while other routes scope by
    session email. Decide intended semantics and align.
92. **[inconsistency][TODO]** Contacts GET owner path returns 403 for all
    `requireOwnerDb` failures, masking 401/500 (`contacts/route.ts`).
93. **[inconsistency][TODO]** Shortlists DELETE without `job_id` only removes
    rows where `job_id IS NULL` — rows with a job survive. Scope mismatch
    between POST and DELETE.
94. **[improvement][TODO]** Quota check + `searches` insert are non-atomic
    (`checkSearchQuota` then insert) — concurrent searches can overshoot the
    limit. Dedup/lock or accept documented softness.
95. **[improvement][TODO]** `setEmployerPlan` doesn't reset `cycle_started_at`
    and the column is vestigial (counting uses month-start directly). Either
    use it or drop it (`quotas.ts`).
96. **[improvement][FIXED]** `verifyCaptchaHook` verifies with Turnstile when CAPTCHA_REQUIRED=1
    (≥8 chars), it never verifies with the provider (`candidates/route.ts`).
    Wire real Turnstile verification when `CAPTCHA_REQUIRED=1`.
97. **[improvement][TODO]** Candidate existence oracle: POST returns 409 with
    `candidateId` and `/api/candidates/lookup` exposes `exists` for any email.
    Intended for the join wizard, but worth an explicit decision/audit.
98. **[verified-no-change]** Cascade delete coverage is complete: every table
    referencing `candidates` (candidate_profiles, work_experiences, projects,
    project_depth_analysis, education, candidate_skills, profile_chunks,
    open_source_contributions, candidate_matches, shortlists, contact_log) is
    deleted explicitly and has `ON DELETE CASCADE` as backstop. Cursor
    keyset pagination logic (shortlists/contacts) is correct for desc order,
    and `nextCursor` encoding is right.

---

## F. Ops reminders

- **[ops][BLOCKING R2]** R2 still needs the dashboard enable
  (https://dash.cloudflare.com/c8f053aaf62b857a3c50378c1d66d8bc/r2) — then
  create `tammy-media`, restore the `MEDIA` binding in `wrangler.jsonc`,
  switch `open-next.config.ts` back to the R2 incremental cache, and create
  an R2 API token for presigned uploads.
- Deployed secrets (A21) must be uploaded before the pipeline works in prod.
- Confirm `tammy-profile-chunks-512` is actually 512-dim (A22).
