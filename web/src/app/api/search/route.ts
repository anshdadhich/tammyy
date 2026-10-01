import { createHash, randomUUID } from "crypto";
import { requireHrDb, getSessionUser } from "@/lib/auth-user";
import { jobSchema } from "@/lib/validators";
import type { JobReq } from "@/lib/matching/types";
import { buildJobQueryText, embedQuery, assertEmbeddingDim, EMBEDDING_DIM } from "@/lib/matching/voyage";
import { buildFtsTerms } from "@/lib/matching/hybrid";
import { matchChunks, type MatchChunksParams } from "@/lib/matching/mongo-retrieval";
import { applyContactPrefs, lockContacts, revealedCandidateIds } from "@/lib/contact-prefs";
import { checkSearchQuota } from "@/lib/quotas";
import { defaultOpenAIProvider, judgeTop, type JudgeInput, type JudgeResult } from "@/lib/matching/judge";
import { blendWithJudge, matchLevel, scoreCandidate, metadataTechnologies, type ScoreContext } from "@/lib/scoring-live";
import { withWideEvent } from "@/lib/observe";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { redactPii } from "@/lib/redact";
import { readJsonBody } from "@/lib/http";
import { AppDoc, Collections } from "@/lib/mongo";

const MATCH_COUNT = 200;
const PER_CANDIDATE_CHUNKS = 3;
const CACHE_WINDOW_MS = 60 * 60 * 1000;
const JUDGE_TIMEOUT_MS = 25000;
const JUDGE_CONCURRENCY = 5;
const MAX_PROJECTS_DEEP = 6;
const MAX_EXP_ATTACH = 5;
const MAX_PROJECTS_ATTACH = 6;
const MAX_OSSTP_ATTACH = 6;

const CAND_COLS_BASE = [
  "full_name", "headline", "domain", "total_experience_years", "min_salary", "salary_frequency",
  "linkedin_url", "github_url", "portfolio_url", "resume_url", "photo_url", "profile_strength",
  "remote_preference", "location_city", "availability_status", "show_email", "show_phone",
  "show_linkedin", "show_github", "show_portfolio", "show_resume", "show_photo",
] as const;
const CONTACT_COLS = ["contact_email", "contact_phone"] as const;
const JUDGE_CAND_COLS = [
  "full_name", "headline", "domain", "total_experience_years", "min_salary",
  "location_city", "remote_preference", "availability_status",
] as const;

/** Mongo projection for a column list (`_id` comes along; mapped to `id`). */
function projection(cols: readonly string[]): Record<string, 1> {
  const p: Record<string, 1> = {};
  for (const c of cols) p[c] = 1;
  return p;
}

/** `_id` -> `id` (the response contract) and strips `_id` from payloads. */
function toRow(doc: AppDoc): Record<string, unknown> {
  const { _id, ...rest } = doc;
  return { ...rest, id: _id };
}

function normalizeQueryText(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

function canonicalFilters(job: JobReq): string {
  const sorted = (arr: string[]): string[] => [...arr].map((s) => s.trim().toLowerCase()).sort();
  return JSON.stringify({
    d: (job.domain ?? "").trim().toLowerCase(),
    s: (job.seniority ?? "").trim().toLowerCase(),
    m: sorted(job.must_have_skills ?? []),
    n: sorted(job.nice_to_have_skills ?? []),
    emin: job.experience_min ?? null,
    emax: job.experience_max ?? null,
    smin: job.salary_min ?? null,
    smax: job.salary_max ?? null,
    loc: (job.location ?? "").trim().toLowerCase(),
    rem: job.remote_allowed === true,
  });
}

function searchHash(queryText: string, job: JobReq, deep: boolean): string {
  return createHash("sha256").update(`${normalizeQueryText(queryText)}\n${canonicalFilters(job)}\ndeep:${deep ? 1 : 0}`).digest("hex");
}

function parseStoredEmbedding(v: unknown): number[] | null {
  try {
    let arr: unknown = v;
    if (typeof v === "string") {
      const t = v.trim();
      if (!t.startsWith("[") || !t.endsWith("]")) return null;
      arr = t.slice(1, -1).split(",").map(Number);
    }
    if (!Array.isArray(arr)) return null;
    const nums = (arr as unknown[]).map(Number);
    assertEmbeddingDim(nums);
    return nums;
  } catch {
    return null;
  }
}

function isJudgePayload(v: unknown): v is JudgeResult {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  return Array.isArray(r.interview_questions) && typeof r.overall_score === "number";
}

export const POST = withWideEvent("/api/search", async (request, wev) => {
  const session = await getSessionUser();
  const hr = await requireHrDb(session);
  if (hr instanceof Response) return hr;
  const reader = hr.client;
  const quota = await checkSearchQuota(hr.employerId);
  wev.add({ quota_plan: quota.plan, quota_used: quota.used, quota_limit: quota.limit });
  if (!quota.ok) {
    return Response.json(
      { error: "Monthly search limit reached for your plan.", upgrade: true, used: quota.used, limit: quota.limit, plan: quota.plan },
      { status: 429 },
    );
  }
  const revealedIds = await revealedCandidateIds(hr.employerId);
  const read = await readJsonBody(request, 256 * 1024);
  if (!read.ok) return read.response;
  const body = read.body as { deep?: unknown; limit?: unknown; job?: unknown } | null;
  const deep = body?.deep === true;
  const rl = rateLimit(request, {
    key: deep ? "search-deep" : "search",
    limit: deep ? 10 : 60,
    windowMs: deep ? 10 * 60_000 : 60_000,
  });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs);
  const rawLimit = typeof body?.limit === "number" && Number.isFinite(body.limit) ? body.limit : 30;
  const limitInput = Number(rawLimit);
  const limit = Math.min(Math.max(Number.isFinite(limitInput) ? Math.floor(limitInput) : 30, 1), deep ? 10 : 30);
  const parsed = jobSchema.safeParse(body?.job);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }
  const j = parsed.data as {
    title: string; domain?: string; seniority?: string;
    must_have?: string[]; nice_to_have?: string[];
    min_exp?: number; max_exp?: number;
    salary_min?: number; salary_max?: number;
    location?: string; remote_policy?: string;
    description?: string;
  };

  const seniorityBands: Record<string, { min: number; max: number }> = {
    intern: { min: 0, max: 1 },
    junior: { min: 0, max: 2 },
    mid: { min: 2, max: 5 },
    senior: { min: 5, max: 8 },
    lead: { min: 7, max: 12 },
    staff: { min: 8, max: 15 },
  };
  const seniorityBand = seniorityBands[(j.seniority ?? "").trim().toLowerCase()];
  const rangeUnconstrained = (j.min_exp ?? 0) <= 0 && (j.max_exp ?? 50) >= 50;
  const jobReq: JobReq = {
    job_title: j.title,
    domain: j.domain,
    seniority: j.seniority,
    must_have_skills: j.must_have ?? [],
    nice_to_have_skills: j.nice_to_have ?? [],
    experience_min: seniorityBand && rangeUnconstrained ? seniorityBand.min : (j.min_exp ?? null),
    experience_max: seniorityBand && rangeUnconstrained ? seniorityBand.max : (j.max_exp ?? null),
    salary_min: j.salary_min ?? null,
    salary_max: j.salary_max ?? null,
    location: j.location ?? null,
    remote_allowed: j.remote_policy === "remote",
    core_responsibilities: j.description ? [j.description] : [],
    raw_description: j.description ?? j.title,
  };

  const queryText = buildJobQueryText(jobReq);
  const qhash = searchHash(queryText, jobReq, deep);
  wev.add({
    job_title: jobReq.job_title,
    domain: jobReq.domain ?? null,
    seniority: jobReq.seniority ?? null,
    must_have: jobReq.must_have_skills.length,
    limit,
    deep,
  });

  const since = new Date(Date.now() - CACHE_WINDOW_MS).toISOString();

  const attachProfileRows = async (target: Record<string, unknown>[]): Promise<void> => {
    for (const r of target) {
      r.work_experiences = [];
      r.projects = [];
      r.education = [];
      r.open_source_contributions = [];
    }
    const ids = [...new Set(target.map((r) => String(r.id ?? "")).filter(Boolean))];
    if (!ids.length) return;
    try {
      const [expRows, projRows, eduRows, ossRows] = await Promise.all([
        reader.collection<AppDoc>(Collections.workExperiences)
          .find(
            { candidate_id: { $in: ids } },
            { projection: projection(["candidate_id", "company_name", "job_title", "start_date", "end_date", "is_current", "description", "achievements", "tech_stack"]) },
          )
          .sort({ start_date: -1 })
          .limit(ids.length * MAX_EXP_ATTACH)
          .toArray(),
        reader.collection<AppDoc>(Collections.projects)
          .find(
            { candidate_id: { $in: ids } },
            { projection: projection(["candidate_id", "title", "description", "problem_statement", "tech_stack", "role_in_project", "project_link", "repo_link", "deployment_link", "impact_summary", "project_type"]) },
          )
          .limit(ids.length * MAX_PROJECTS_ATTACH)
          .toArray(),
        reader.collection<AppDoc>(Collections.education)
          .find(
            { candidate_id: { $in: ids } },
            { projection: projection(["candidate_id", "institution", "degree", "field_of_study", "start_year", "end_year", "achievements"]) },
          )
          .sort({ start_year: -1 })
          .limit(ids.length * MAX_EXP_ATTACH)
          .toArray(),
        reader.collection<AppDoc>(Collections.openSourceContributions)
          .find(
            { candidate_id: { $in: ids } },
            { projection: projection(["candidate_id", "repo_name", "repo_url", "description", "pr_links", "tech_stack", "role"]) },
          )
          .limit(ids.length * MAX_OSSTP_ATTACH)
          .toArray(),
      ]);
      const assign = (key: string, data: AppDoc[], cap: number, keepId: boolean): void => {
        const buckets = new Map<string, Record<string, unknown>[]>();
        for (const raw of data) {
          const cid = String(raw.candidate_id ?? "");
          if (!cid) continue;
          const { _id, ...rest } = raw;
          const entry: Record<string, unknown> = { ...rest };
          delete entry.candidate_id;
          delete entry._id;
          if (keepId) entry.id = _id;
          const bucket = buckets.get(cid) ?? [];
          if (bucket.length < cap) bucket.push(entry);
          buckets.set(cid, bucket);
        }
        for (const r of target) {
          const bucket = buckets.get(String(r.id ?? ""));
          if (bucket?.length) r[key] = bucket;
        }
      };
      assign("work_experiences", expRows, MAX_EXP_ATTACH, false);
      assign("projects", projRows, MAX_PROJECTS_ATTACH, true);
      assign("education", eduRows, MAX_EXP_ATTACH, false);
      assign("open_source_contributions", ossRows, MAX_OSSTP_ATTACH, false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[search] attach profiles failed detail=${redactPii(msg.slice(0, 200))}`);
    }
  };

  const attachContacts = async (target: Record<string, unknown>[]): Promise<void> => {
    const ids = [...new Set(target.map((r) => String(r.id ?? "")).filter(Boolean))];
    if (!ids.length) return;
    try {
      const docs = await reader
        .collection<AppDoc>(Collections.candidates)
        .find(
          { _id: { $in: ids }, visibility_status: "visible" },
          { projection: projection(CONTACT_COLS) },
        )
        .toArray();
      const byId = new Map(docs.map((c) => [String(c._id), c]));
      for (const r of target) {
        const c = byId.get(String(r.id ?? ""));
        if (!c) continue;
        if (c.contact_email !== undefined) r.contact_email = c.contact_email;
        if (c.contact_phone !== undefined) r.contact_phone = c.contact_phone;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[search] contacts fetch failed detail=${redactPii(msg.slice(0, 200))}`);
    }
  };

  const finalize = (rows: Record<string, unknown>[]): Record<string, unknown>[] =>
    rows.map((r) => {
      const withPrefs = applyContactPrefs(r as Parameters<typeof applyContactPrefs>[0]) as unknown as Record<string, unknown>;
      if (revealedIds && !revealedIds.has(String(r.id ?? ""))) return lockContacts(withPrefs);
      return withPrefs;
    });

  const findRecentSearch = async (): Promise<{ id: string; created_at: Date; query_embedding: unknown } | null> => {
    try {
      const doc = await reader
        .collection<AppDoc>(Collections.searches)
        .find(
          { employer_id: hr.employerId, query_hash: qhash, created_at: { $gt: new Date(since) } },
          { projection: { created_at: 1, query_embedding: 1 } },
        )
        .sort({ created_at: -1 })
        .limit(1)
        .next();
      return doc
        ? { id: String(doc._id), created_at: doc.created_at as Date, query_embedding: doc.query_embedding }
        : null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[search] hash lookup failed, legacy fallback detail=${redactPii(msg.slice(0, 200))}`);
      try {
        const doc = await reader
          .collection<AppDoc>(Collections.searches)
          .find(
            { employer_id: hr.employerId, query_text: queryText, created_at: { $gt: new Date(since) } },
            { projection: { created_at: 1 } },
          )
          .sort({ created_at: -1 })
          .limit(1)
          .next();
        return doc
          ? { id: String(doc._id), created_at: doc.created_at as Date, query_embedding: null }
          : null;
      } catch {
        return null;
      }
    }
  };

  const corpusUnchanged = async (createdAt: Date): Promise<boolean> => {
    try {
      const doc = await reader
        .collection<AppDoc>(Collections.candidates)
        .find(
          { visibility_status: "visible", updated_at: { $gt: createdAt } },
          { projection: { _id: 1 } },
        )
        .limit(1)
        .next();
      return !doc;
    } catch {
      return false;
    }
  };

  const loadCachedMatches = async (searchId: string): Promise<Record<string, unknown>[] | null> => {
    try {
      const mrows = await reader
        .collection<AppDoc>(Collections.candidateMatches)
        .find(
          { search_id: searchId },
          { projection: { candidate_id: 1, score: 1, match_reasons_json: 1 } },
        )
        .sort({ score: -1 })
        .limit(limit)
        .toArray();
      if (!mrows.length) return null;
      const candIds = [...new Set(mrows.map((m) => String(m.candidate_id ?? "")).filter(Boolean))];
      const candDocs = candIds.length
        ? await reader
            .collection<AppDoc>(Collections.candidates)
            .find(
              { _id: { $in: candIds }, visibility_status: "visible" },
              { projection: projection(CAND_COLS_BASE) },
            )
            .toArray()
        : [];
      const byId = new Map(candDocs.map((c) => [String(c._id), c]));
      return mrows.map((m) => {
        const c = byId.get(String(m.candidate_id ?? ""));
        return {
          candidate_id: m.candidate_id,
          score: m.score,
          match_reasons_json: m.match_reasons_json,
          candidates: c ? toRow(c) : null,
        } as unknown as Record<string, unknown>;
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[search] cached matches load failed detail=${redactPii(msg.slice(0, 200))}`);
      return null;
    }
  };

  const recent = await findRecentSearch();
  let reusedEmbedding: number[] | null = null;
  if (recent?.query_embedding) reusedEmbedding = parseStoredEmbedding(recent.query_embedding);

  if (recent?.id && (await corpusUnchanged(recent.created_at))) {
    const cached = await loadCachedMatches(recent.id);
    if (cached?.length) {
      if (deep) {
        const judged = cached.filter((m) => isJudgePayload((m as { match_reasons_json?: unknown }).match_reasons_json));
        if (judged.length) {
          const flattened: Record<string, unknown>[] = [];
          for (const m of judged) {
            const mm = m as { candidates?: Record<string, unknown> | null; candidate_id?: unknown; score?: unknown; match_reasons_json?: unknown };
            const c = mm.candidates;
            if (!c || typeof c !== "object") continue;
            flattened.push({ ...c, id: c.id ?? mm.candidate_id, judge: mm.match_reasons_json, overall_score: typeof mm.score === "number" ? mm.score : null });
          }
          if (flattened.length) {
            await attachProfileRows(flattened);
            await attachContacts(flattened);
            const results = finalize(flattened);
            wev.add({ cached: true, deep_cached: true, result_count: results.length, search_id: recent.id });
            return Response.json({ results, queryText, searchId: recent.id, cached: true, deep: true });
          }
        }
      } else {
        const flattened: Record<string, unknown>[] = [];
        for (const m of cached) {
          const mm = m as { candidates?: Record<string, unknown> | null; candidate_id?: unknown; score?: unknown; match_reasons_json?: unknown };
          const c = mm.candidates;
          if (!c || typeof c !== "object") continue;
          flattened.push({
            ...c,
            id: c.id ?? mm.candidate_id,
            overall_score: typeof mm.score === "number" ? mm.score : null,
            sub_scores: (mm.match_reasons_json as Record<string, unknown> | null) ?? {},
          });
        }
        if (flattened.length) {
          await attachProfileRows(flattened);
          await attachContacts(flattened);
          const results = finalize(flattened);
          wev.add({ cached: true, result_count: results.length, search_id: recent.id });
          return Response.json({ results, queryText, searchId: recent.id, cached: true });
        }
      }
    }
  }

  type Chunk = { candidate_id: string; distance?: number; content_text?: string; chunk_type?: string; metadata_json?: unknown };
  let chunks: Chunk[] = [];
  let embedFailed = false;
  let rpcFallback = false;
  let qvec: number[] | null = reusedEmbedding;
  if (!qvec) {
    try {
      qvec = await embedQuery(queryText);
      assertEmbeddingDim(qvec, EMBEDDING_DIM);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[search] embed failed detail=${redactPii(msg.slice(0, 200))}`);
      embedFailed = true;
      qvec = null;
    }
  }
  wev.add({ embed_failed: embedFailed, embed_reused: reusedEmbedding != null });

  if (qvec) {
    const ftsTerms = buildFtsTerms(jobReq, 20);
    const baseParams: MatchChunksParams = {
      query_embedding: qvec,
      match_count: MATCH_COUNT,
      p_domain: jobReq.domain?.trim() ? jobReq.domain.trim() : null,
      p_min_exp: jobReq.experience_min ?? null,
      p_salary_max: jobReq.salary_max ?? null,
      p_location: jobReq.location?.trim() ? jobReq.location.trim() : null,
      p_candidate_ids: null,
      p_availability: null,
      p_chunk_types: null,
      p_fts_terms: ftsTerms.length ? ftsTerms : null,
      p_per_candidate: PER_CANDIDATE_CHUNKS,
    };
    try {
      chunks = await matchChunks(reader, baseParams);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[search] filtered rpc failed, fallback detail=${redactPii(msg.slice(0, 200))}`);
      rpcFallback = true;
      try {
        chunks = await matchChunks(reader, {
          ...baseParams,
          p_domain: null,
          p_min_exp: null,
          p_salary_max: null,
          p_location: null,
          p_fts_terms: null,
        });
      } catch (e2) {
        const msg2 = e2 instanceof Error ? e2.message : String(e2);
        console.error(`[search] rpc fallback failed detail=${redactPii(msg2.slice(0, 200))}`);
      }
    }
  }

  let rows: Record<string, unknown>[] = [];
  if (chunks.length) {
    const byCand = new Map<string, { best: number; hits: Chunk[] }>();
    for (const c of chunks) {
      if (!c.candidate_id) continue;
      let g = byCand.get(c.candidate_id);
      if (!g) {
        g = { best: Infinity, hits: [] };
        byCand.set(c.candidate_id, g);
      }
      const d = typeof c.distance === "number" ? c.distance : Infinity;
      if (d < g.best) g.best = d;
      if (g.hits.length < PER_CANDIDATE_CHUNKS) g.hits.push(c);
    }
    for (const g of byCand.values()) {
      g.hits.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
    }
    const ranked = [...byCand.entries()].sort((a, b) => a[1].best - b[1].best).slice(0, limit);
    const ids = ranked.map(([id]) => id);
    if (ids.length) {
      const cands = await reader
        .collection<AppDoc>(Collections.candidates)
        .find(
          { _id: { $in: ids }, visibility_status: "visible" },
          { projection: projection(CAND_COLS_BASE) },
        )
        .toArray();
      const byId = new Map(cands.map((c) => [String(c._id), toRow(c)]));
      const grouped: Record<string, unknown>[] = [];
      for (const [id, g] of ranked) {
        const c = byId.get(id);
        if (c) grouped.push({ ...c, best_distance: g.best, matched_chunks: g.hits.length });
      }
      rows = grouped;
    }
    try {
      const scoreIds = rows.map((r) => String(r.id));
      const chunkTechByCand = new Map<string, string[]>();
      for (const c of chunks) {
        if (!c.candidate_id || !scoreIds.includes(c.candidate_id)) continue;
        const techs = metadataTechnologies(c.metadata_json);
        if (!techs.length) continue;
        const arr = chunkTechByCand.get(c.candidate_id) ?? [];
        for (const t of techs) {
          if (!arr.some((x) => x.toLowerCase() === t.toLowerCase())) arr.push(t);
        }
        chunkTechByCand.set(c.candidate_id, arr);
      }
      const [skillDocs, projDocs] = await Promise.all([
        reader.collection<AppDoc>(Collections.candidateSkills)
          .find({ candidate_id: { $in: scoreIds } }, { projection: { candidate_id: 1, skill_id: 1 } })
          .toArray(),
        reader.collection<AppDoc>(Collections.projects)
          .find({ candidate_id: { $in: scoreIds } }, { projection: { candidate_id: 1, tech_stack: 1 } })
          .toArray(),
      ]);
      const skillIds = [...new Set(skillDocs.map((s) => String(s.skill_id ?? "")).filter(Boolean))];
      const skillNameById = new Map<string, string>();
      if (skillIds.length) {
        const skillRows = await reader
          .collection<AppDoc>(Collections.skills)
          .find({ _id: { $in: skillIds } }, { projection: { name: 1 } })
          .toArray();
        for (const s of skillRows) {
          if (typeof s.name === "string" && s.name) skillNameById.set(String(s._id), s.name);
        }
      }
      const skillsByCand = new Map<string, string[]>();
      for (const s of skillDocs) {
        const name = skillNameById.get(String(s.skill_id ?? ""));
        if (!name) continue;
        const cid = String(s.candidate_id ?? "");
        if (!cid) continue;
        const arr = skillsByCand.get(cid) ?? [];
        arr.push(name);
        skillsByCand.set(cid, arr);
      }
      const projsByCand = new Map<string, { id: string; tech: string[] }[]>();
      for (const p of projDocs) {
        const cid = String(p.candidate_id ?? "");
        if (!cid) continue;
        const arr = projsByCand.get(cid) ?? [];
        arr.push({ id: String(p._id), tech: (p.tech_stack as string[] | null) ?? [] });
        projsByCand.set(cid, arr);
      }
      const allProjIds = [...projsByCand.values()].flat().map((p) => p.id);
      const depthByProj = new Map<string, { complexity: number; evidence: string }>();
      if (allProjIds.length) {
        const depthRows = await reader
          .collection<AppDoc>(Collections.projectDepthAnalysis)
          .find(
            { project_id: { $in: allProjIds } },
            { projection: { project_id: 1, complexity_score: 1, evidence_quality: 1 } },
          )
          .toArray();
        for (const d of depthRows) {
          if (d.project_id == null) continue;
          depthByProj.set(String(d.project_id), {
            complexity: typeof d.complexity_score === "number" ? d.complexity_score : 5,
            evidence: typeof d.evidence_quality === "string" ? d.evidence_quality : "moderate",
          });
        }
      }
      rows = rows
        .map((r) => {
          const cid = String(r.id);
          const projs = projsByCand.get(cid) ?? [];
          const skillProjects = new Map<string, number>();
          for (const p of projs) {
            for (const t of p.tech) skillProjects.set(t.trim().toLowerCase(), (skillProjects.get(t.trim().toLowerCase()) ?? 0) + 1);
          }
          const listed = skillsByCand.get(cid) ?? [];
          const chunkTechs = chunkTechByCand.get(cid) ?? [];
          const mergedSkills = [...listed, ...chunkTechs.filter((t) => !listed.some((x) => x.toLowerCase() === t.toLowerCase()))];
          const ctx: ScoreContext = {
            skills: mergedSkills,
            skillProjects,
            depths: projs.map((p) => depthByProj.get(p.id) ?? { complexity: 5, evidence: "moderate" as const }),
            minSalary: typeof r.min_salary === "number" ? r.min_salary : null,
            salaryFreq: typeof r.salary_frequency === "string" ? r.salary_frequency : null,
            totalExp: typeof r.total_experience_years === "number" ? r.total_experience_years : null,
            remotePref: typeof r.remote_preference === "string" ? r.remote_preference : null,
            locationCity: typeof r.location_city === "string" ? r.location_city : null,
            availability: typeof r.availability_status === "string" ? r.availability_status : null,
            profileStrength: typeof r.profile_strength === "number" ? r.profile_strength : null,
          };
          const dist = typeof r.best_distance === "number" ? r.best_distance : null;
          const { sub, total, level } = scoreCandidate(jobReq, dist, ctx);
          return {
            ...r,
            overall_score: total,
            match_level: level,
            sub_scores: sub,
            top_skills: mergedSkills.slice(0, 4),
          };
        })
        .sort((a, b) => (Number(b.overall_score) || 0) - (Number(a.overall_score) || 0));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[search] scoring failed detail=${redactPii(msg.slice(0, 200))}`);
    }
  }
  let unrankedFallback = false;
  if (!rows.length) {
    const docs = await reader
      .collection<AppDoc>(Collections.candidates)
      .find({ visibility_status: "visible" }, { projection: projection(CAND_COLS_BASE) })
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray();
    rows = docs.map(toRow);
    unrankedFallback = rows.length > 0;
  }
  wev.add({ result_count: rows.length, chunk_hits: chunks.length, unranked_fallback: unrankedFallback });

  let searchId: string | null = null;
  const searchPayload: Record<string, unknown> = {
    employer_id: hr.employerId,
    query_text: queryText,
    filters_json: jobReq,
    result_count: rows.length,
  };
  try {
    const full: AppDoc = {
      ...searchPayload,
      _id: randomUUID(),
      query_hash: qhash,
      query_embedding: qvec ?? null,
      created_at: new Date(),
    };
    const res = await reader.collection<AppDoc>(Collections.searches).insertOne(full);
    searchId = String(res.insertedId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[search] search insert with hash failed, legacy fallback detail=${redactPii(msg.slice(0, 200))}`);
    try {
      const res = await reader.collection<AppDoc>(Collections.searches).insertOne({
        ...searchPayload,
        _id: randomUUID(),
        created_at: new Date(),
      });
      searchId = String(res.insertedId);
    } catch {
      searchId = null;
    }
  }

  const saveMatches = async (entries: { candidate_id: string; score: number | null; reasons: Record<string, unknown> }[]): Promise<void> => {
    if (!searchId || !entries.length) return;
    const payload: AppDoc[] = entries
      .filter((m) => m.candidate_id)
      .map((m) => ({
        _id: randomUUID(),
        search_id: searchId as string,
        candidate_id: m.candidate_id,
        score: m.score,
        match_reasons_json: m.reasons,
        status: "shown",
        created_at: new Date(),
      }));
    if (!payload.length) return;
    try {
      const matches = reader.collection<AppDoc>(Collections.candidateMatches);
      await Promise.all(
        payload.map((doc) =>
          matches.updateOne(
            { search_id: doc.search_id, candidate_id: doc.candidate_id },
            { $setOnInsert: doc },
            { upsert: true },
          ),
        ),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[search] matches upsert failed, insert fallback detail=${redactPii(msg.slice(0, 200))}`);
      try {
        await reader.collection<AppDoc>(Collections.candidateMatches).insertMany(payload);
      } catch (e2) {
        const msg2 = e2 instanceof Error ? e2.message : String(e2);
        console.error(`[search] matches insert failed detail=${redactPii(msg2.slice(0, 200))}`);
      }
    }
  };

  if (searchId && !deep) {
    const scored = rows.filter((r) => typeof r.overall_score === "number");
    await saveMatches(
      scored.map((r) => ({
        candidate_id: String(r.id ?? ""),
        score: r.overall_score as number,
        reasons: (r.sub_scores ?? {}) as Record<string, unknown>,
      })),
    );
  }
  if (!deep) {
    await attachProfileRows(rows);
    await attachContacts(rows);
    const results = finalize(rows);
    const degradedOut = embedFailed || rpcFallback || unrankedFallback;
    wev.add({ degraded: degradedOut });
    return Response.json({ results, queryText, searchId, degraded: degradedOut || undefined });
  }

  if (unrankedFallback) {
    await attachProfileRows(rows);
    await attachContacts(rows);
    const results = finalize(rows);
    wev.add({ deep: true, degraded: true, unranked_fallback: true });
    return Response.json({ results, queryText, searchId, deep: true, degraded: true, deepError: "No strong matches - showing recent profiles." });
  }

  try {
    const top = rows.slice(0, 10);
    const topIds = top.map((r) => String(r.id ?? "")).filter((s): s is string => s.length > 0);
    const [judgeCands, judgeProjs] = await Promise.all([
      topIds.length
        ? reader
            .collection<AppDoc>(Collections.candidates)
            .find(
              { _id: { $in: topIds }, visibility_status: "visible" },
              { projection: projection(JUDGE_CAND_COLS) },
            )
            .toArray()
        : Promise.resolve([] as AppDoc[]),
      topIds.length
        ? reader
            .collection<AppDoc>(Collections.projects)
            .find(
              { candidate_id: { $in: topIds } },
              { projection: { candidate_id: 1, title: 1, description: 1, tech_stack: 1, impact_summary: 1 } },
            )
            .toArray()
        : Promise.resolve([] as AppDoc[]),
    ]);
    const candById = new Map(judgeCands.map((c) => [String(c._id), toRow(c)]));
    const projsById = new Map<string, Record<string, unknown>[]>();
    for (const p of judgeProjs) {
      const cid = String(p.candidate_id ?? "");
      if (!cid) continue;
      const bucket = projsById.get(cid) ?? [];
      if (bucket.length < MAX_PROJECTS_DEEP) {
        // Rest-sibling strip: judge payloads must not carry the Mongo _id.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { _id, ...rest } = p;
        bucket.push(rest as Record<string, unknown>);
      }
      projsById.set(cid, bucket);
    }
    const inputs: JudgeInput[] = top.map((r) => {
      const cid = String(r.id ?? "");
      return { candidate_id: cid, job: jobReq, candidateJson: { candidate: candById.get(cid) ?? r, projects: projsById.get(cid) ?? [] } };
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const judged = (await Promise.race([
      judgeTop(inputs, defaultOpenAIProvider(), JUDGE_CONCURRENCY, { timeoutMs: JUDGE_TIMEOUT_MS }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Deep judge overall deadline exceeded")), 40000);
      }),
    ])) as Array<JudgeResult | null>;
    if (timer) clearTimeout(timer);
    const judgeNulls = judged.filter((jj) => jj == null).length;
    wev.add({ judge_nulls: judgeNulls, judged: judged.length });
    const merged = top.map((r, i) => {
      const jj = judged[i];
      const rules = typeof r.overall_score === "number" ? (r.overall_score as number) : null;
      const jscore = jj && typeof jj.overall_score === "number" ? jj.overall_score : null;
      const blended = rules != null ? blendWithJudge(rules, jscore) : jscore;
      return { ...r, judge: jj, overall_score: blended, match_level: blended != null ? matchLevel(blended) : r.match_level };
    });
    merged.sort((a, b) => (typeof b.overall_score === "number" ? b.overall_score : -1) - (typeof a.overall_score === "number" ? a.overall_score : -1));
    if (searchId) {
      await saveMatches(
        merged.map((m) => {
          const mm = m as Record<string, unknown>;
          const jj = mm.judge as JudgeResult | null;
          return {
            candidate_id: String(mm.id ?? ""),
            score: typeof mm.overall_score === "number" ? (mm.overall_score as number) : (jj?.overall_score ?? null),
            reasons: ((jj ?? {}) as unknown) as Record<string, unknown>,
          };
        }),
      );
    }
    wev.add({ judged: merged.length, deep: true, degraded: embedFailed || rpcFallback || judgeNulls === merged.length });
    await attachProfileRows(merged);
    await attachContacts(merged);
    const results = finalize(merged);
    return Response.json({ results, queryText, searchId, deep: true, degraded: (embedFailed || rpcFallback || (merged.length > 0 && judgeNulls === merged.length)) || undefined });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[search] deep judge failed detail=${redactPii(msg.slice(0, 200))}`);
    await attachProfileRows(rows);
    await attachContacts(rows);
    const results = finalize(rows);
    return Response.json({ results, queryText, searchId, deepError: "Deep read unavailable. Showing rule-ranked results.", degraded: true });
  }
});
