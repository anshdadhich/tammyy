import { createHash, randomUUID } from "crypto";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireHrDb, getSessionUser } from "@/lib/auth-user";
import { jobSchema } from "@/lib/validators";
import type { JobReq } from "@/lib/matching/types";
import { embedQuery, EMBEDDING_DIM } from "@/lib/embeddings";
import { buildFtsTerms } from "@/lib/matching/hybrid";
import { matchChunks, type MatchChunksParams, type MatchChunksRow } from "@/lib/matching/retrieval";
import { applyContactPrefs, lockContacts, revealedCandidateIds } from "@/lib/contact-prefs";
import { checkSearchQuota } from "@/lib/quotas";
import { defaultOpenAIProvider, judgeTop, type JudgeInput, type JudgeResult } from "@/lib/matching/judge";
import { blendWithJudge, matchLevel, scoreCandidate, metadataTechnologies, type ScoreContext } from "@/lib/scoring-live";
import { withWideEvent } from "@/lib/observe";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { redactPii } from "@/lib/redact";
import { readJsonBody } from "@/lib/http";

const MATCH_COUNT = 200;
const PER_CANDIDATE_CHUNKS = 3;
const CACHE_WINDOW_MS = 60 * 60 * 1000;
const JUDGE_TIMEOUT_MS = 25000;
const JUDGE_CONCURRENCY = 5;
const MAX_PROJECTS_DEEP = 6;
const MAX_EXP_ATTACH = 5;
const MAX_PROJECTS_ATTACH = 6;
const MAX_OSSTP_ATTACH = 6;

function buildJobQueryText(job: {
  job_title: string;
  must_have_skills: string[];
  nice_to_have_skills?: string[];
  core_responsibilities?: string[];
  domain?: string;
}): string {
  const parts = [
    `Role: ${job.job_title}`,
    job.domain ? `Domain: ${job.domain}` : "",
    `Must-have: ${job.must_have_skills.join(", ")}`,
    job.nice_to_have_skills?.length
      ? `Nice-to-have: ${job.nice_to_have_skills.join(", ")}`
      : "",
    job.core_responsibilities?.length
      ? `Responsibilities: ${job.core_responsibilities.join("; ")}`
      : "",
  ].filter(Boolean);
  return parts.join("\n");
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

function isJudgePayload(v: unknown): v is JudgeResult {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  return Array.isArray(r.interview_questions) && typeof r.overall_score === "number";
}

export const POST = withWideEvent("/api/search", async (request, wev) => {
  const session = await getSessionUser();
  const hr = await requireHrDb(session);
  if (hr instanceof Response) return hr;
  const db = await getDb();
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
  const rl = await rateLimit(request, {
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
        db
          .select({
            candidate_id: schema.workExperiences.candidate_id,
            company_name: schema.workExperiences.company_name,
            job_title: schema.workExperiences.job_title,
            start_date: schema.workExperiences.start_date,
            end_date: schema.workExperiences.end_date,
            is_current: schema.workExperiences.is_current,
            description: schema.workExperiences.description,
            achievements: schema.workExperiences.achievements,
            tech_stack: schema.workExperiences.tech_stack,
          })
          .from(schema.workExperiences)
          .where(inArray(schema.workExperiences.candidate_id, ids))
          .limit(ids.length * MAX_EXP_ATTACH),
        db
          .select({
            id: schema.projects.id,
            candidate_id: schema.projects.candidate_id,
            title: schema.projects.title,
            description: schema.projects.description,
            problem_statement: schema.projects.problem_statement,
            tech_stack: schema.projects.tech_stack,
            role_in_project: schema.projects.role_in_project,
            project_link: schema.projects.project_link,
            repo_link: schema.projects.repo_link,
            deployment_link: schema.projects.deployment_link,
            impact_summary: schema.projects.impact_summary,
            project_type: schema.projects.project_type,
          })
          .from(schema.projects)
          .where(inArray(schema.projects.candidate_id, ids))
          .limit(ids.length * MAX_PROJECTS_ATTACH),
        db
          .select({
            candidate_id: schema.education.candidate_id,
            institution: schema.education.institution,
            degree: schema.education.degree,
            field_of_study: schema.education.field_of_study,
            start_year: schema.education.start_year,
            end_year: schema.education.end_year,
            achievements: schema.education.achievements,
          })
          .from(schema.education)
          .where(inArray(schema.education.candidate_id, ids))
          .limit(ids.length * MAX_EXP_ATTACH),
        db
          .select({
            candidate_id: schema.openSourceContributions.candidate_id,
            repo_name: schema.openSourceContributions.repo_name,
            repo_url: schema.openSourceContributions.repo_url,
            description: schema.openSourceContributions.description,
            pr_links: schema.openSourceContributions.pr_links,
            tech_stack: schema.openSourceContributions.tech_stack,
            role: schema.openSourceContributions.role,
          })
          .from(schema.openSourceContributions)
          .where(inArray(schema.openSourceContributions.candidate_id, ids))
          .limit(ids.length * MAX_OSSTP_ATTACH),
      ]);
      const assign = (key: string, data: Record<string, unknown>[], cap: number, keepId: boolean): void => {
        const buckets = new Map<string, Record<string, unknown>[]>();
        for (const raw of data) {
          const cid = String(raw.candidate_id ?? "");
          if (!cid) continue;
          const entry: Record<string, unknown> = { ...raw };
          delete entry.candidate_id;
          if (!keepId) delete entry.id;
          const bucket = buckets.get(cid) ?? [];
          if (bucket.length < cap) bucket.push(entry);
          buckets.set(cid, bucket);
        }
        for (const r of target) {
          const bucket = buckets.get(String(r.id ?? ""));
          if (bucket?.length) r[key] = bucket;
        }
      };
      assign("work_experiences", expRows as unknown as Record<string, unknown>[], MAX_EXP_ATTACH, false);
      assign("projects", projRows as unknown as Record<string, unknown>[], MAX_PROJECTS_ATTACH, true);
      assign("education", eduRows as unknown as Record<string, unknown>[], MAX_EXP_ATTACH, false);
      assign("open_source_contributions", ossRows as unknown as Record<string, unknown>[], MAX_OSSTP_ATTACH, false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[search] attach profiles failed detail=${redactPii(msg.slice(0, 200))}`);
    }
  };

  const attachContacts = async (target: Record<string, unknown>[]): Promise<void> => {
    const ids = [...new Set(target.map((r) => String(r.id ?? "")).filter(Boolean))];
    if (!ids.length) return;
    try {
      const docs = await db
        .select({
          id: schema.candidates.id,
          contact_email: schema.candidates.contact_email,
          contact_phone: schema.candidates.contact_phone,
        })
        .from(schema.candidates)
        .where(
          and(
            inArray(schema.candidates.id, ids),
            eq(schema.candidates.visibility_status, "visible"),
          ),
        );
      const byId = new Map(docs.map((c) => [c.id, c]));
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

  const findRecentSearch = async (): Promise<{ id: string; created_at: string } | null> => {
    try {
      const rows = await db
        .select({ id: schema.searches.id, created_at: schema.searches.created_at })
        .from(schema.searches)
        .where(
          and(
            eq(schema.searches.employer_id, hr.employerId),
            eq(schema.searches.query_hash, qhash),
            gt(schema.searches.created_at, since),
          ),
        )
        .orderBy(desc(schema.searches.created_at))
        .limit(1);
      return rows[0] ?? null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[search] hash lookup failed detail=${redactPii(msg.slice(0, 200))}`);
      return null;
    }
  };

  const corpusUnchanged = async (createdAt: string): Promise<boolean> => {
    try {
      const rows = await db
        .select({ id: schema.candidates.id })
        .from(schema.candidates)
        .where(
          and(
            eq(schema.candidates.visibility_status, "visible"),
            gt(schema.candidates.updated_at, createdAt),
          ),
        )
        .limit(1);
      return !rows[0];
    } catch {
      return false;
    }
  };

  const loadCachedMatches = async (searchId: string): Promise<Record<string, unknown>[] | null> => {
    try {
      const mrows = await db
        .select({
          candidate_id: schema.candidateMatches.candidate_id,
          score: schema.candidateMatches.score,
          match_reasons_json: schema.candidateMatches.match_reasons_json,
        })
        .from(schema.candidateMatches)
        .where(eq(schema.candidateMatches.search_id, searchId))
        .orderBy(desc(schema.candidateMatches.score))
        .limit(limit);
      if (!mrows.length) return null;
      const candIds = [...new Set(mrows.map((m) => m.candidate_id).filter(Boolean))];
      const candDocs = candIds.length
        ? await db
            .select()
            .from(schema.candidates)
            .where(
              and(
                inArray(schema.candidates.id, candIds),
                eq(schema.candidates.visibility_status, "visible"),
              ),
            )
        : [];
      const byId = new Map(candDocs.map((c) => [c.id, c]));
      return mrows.map((m) => {
        const c = byId.get(m.candidate_id);
        return {
          candidate_id: m.candidate_id,
          score: m.score,
          match_reasons_json: m.match_reasons_json,
          candidates: c ? { ...c, id: c.id } : null,
        } as unknown as Record<string, unknown>;
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[search] cached matches load failed detail=${redactPii(msg.slice(0, 200))}`);
      return null;
    }
  };

  const recent = await findRecentSearch();
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

  type Chunk = MatchChunksRow;
  let chunks: Chunk[] = [];
  let embedFailed = false;
  let retrievalFallback = false;
  let qvec: number[] | null = null;
  if (!qvec) {
    try {
      qvec = await embedQuery(queryText);
      if (qvec.length !== EMBEDDING_DIM) throw new Error("embedding dim mismatch");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[search] embed failed detail=${redactPii(msg.slice(0, 200))}`);
      embedFailed = true;
      qvec = null;
    }
  }
  wev.add({ embed_failed: embedFailed });

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
      chunks = await matchChunks(baseParams);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[search] filtered retrieval failed, fallback detail=${redactPii(msg.slice(0, 200))}`);
      retrievalFallback = true;
      try {
        chunks = await matchChunks({
          ...baseParams,
          p_domain: null,
          p_min_exp: null,
          p_salary_max: null,
          p_location: null,
          p_fts_terms: null,
        });
      } catch (e2) {
        const msg2 = e2 instanceof Error ? e2.message : String(e2);
        console.error(`[search] retrieval fallback failed detail=${redactPii(msg2.slice(0, 200))}`);
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
      const cands = await db
        .select({
          id: schema.candidates.id,
          full_name: schema.candidates.full_name,
          headline: schema.candidates.headline,
          domain: schema.candidates.domain,
          total_experience_years: schema.candidates.total_experience_years,
          min_salary: schema.candidates.min_salary,
          salary_frequency: schema.candidates.salary_frequency,
          linkedin_url: schema.candidates.linkedin_url,
          github_url: schema.candidates.github_url,
          portfolio_url: schema.candidates.portfolio_url,
          resume_url: schema.candidates.resume_url,
          photo_url: schema.candidates.photo_url,
          profile_strength: schema.candidates.profile_strength,
          remote_preference: schema.candidates.remote_preference,
          location_city: schema.candidates.location_city,
          availability_status: schema.candidates.availability_status,
          show_email: schema.candidates.show_email,
          show_phone: schema.candidates.show_phone,
          show_linkedin: schema.candidates.show_linkedin,
          show_github: schema.candidates.show_github,
          show_portfolio: schema.candidates.show_portfolio,
          show_resume: schema.candidates.show_resume,
          show_photo: schema.candidates.show_photo,
        })
        .from(schema.candidates)
        .where(
          and(
            inArray(schema.candidates.id, ids),
            eq(schema.candidates.visibility_status, "visible"),
          ),
        );
      const byId = new Map(cands.map((c) => [c.id, c]));
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
      const [skillDocs, projDocs, ossDocs] = await Promise.all([
        db
          .select({
            candidate_id: schema.candidateSkills.candidate_id,
            skill_id: schema.candidateSkills.skill_id,
          })
          .from(schema.candidateSkills)
          .where(inArray(schema.candidateSkills.candidate_id, scoreIds)),
        db
          .select({
            id: schema.projects.id,
            candidate_id: schema.projects.candidate_id,
            tech_stack: schema.projects.tech_stack,
          })
          .from(schema.projects)
          .where(inArray(schema.projects.candidate_id, scoreIds)),
        db
          .select({
            candidate_id: schema.openSourceContributions.candidate_id,
          })
          .from(schema.openSourceContributions)
          .where(inArray(schema.openSourceContributions.candidate_id, scoreIds)),
      ]);
      const ossByCand = new Map<string, number>();
      for (const o of ossDocs) {
        ossByCand.set(o.candidate_id, (ossByCand.get(o.candidate_id) ?? 0) + 1);
      }
      const skillIds = [...new Set(skillDocs.map((s) => s.skill_id).filter(Boolean))];
      const skillNameById = new Map<string, string>();
      if (skillIds.length) {
        const skillRows = await db
          .select({ id: schema.skills.id, name: schema.skills.name })
          .from(schema.skills)
          .where(inArray(schema.skills.id, skillIds));
        for (const s of skillRows) {
          if (typeof s.name === "string" && s.name) skillNameById.set(s.id, s.name);
        }
      }
      const skillsByCand = new Map<string, string[]>();
      for (const s of skillDocs) {
        const name = skillNameById.get(s.skill_id);
        if (!name) continue;
        const arr = skillsByCand.get(s.candidate_id) ?? [];
        arr.push(name);
        skillsByCand.set(s.candidate_id, arr);
      }
      const projsByCand = new Map<string, { id: string; tech: string[] }[]>();
      for (const p of projDocs) {
        const arr = projsByCand.get(p.candidate_id) ?? [];
        arr.push({ id: p.id, tech: p.tech_stack ?? [] });
        projsByCand.set(p.candidate_id, arr);
      }
      const allProjIds = [...projsByCand.values()].flat().map((p) => p.id);
      const depthByProj = new Map<string, { complexity: number; evidence: string }>();
      if (allProjIds.length) {
        const depthRows = await db
          .select({
            project_id: schema.projectDepthAnalysis.project_id,
            complexity_score: schema.projectDepthAnalysis.complexity_score,
            evidence_quality: schema.projectDepthAnalysis.evidence_quality,
          })
          .from(schema.projectDepthAnalysis)
          .where(inArray(schema.projectDepthAnalysis.project_id, allProjIds));
        for (const d of depthRows) {
          if (!d.project_id) continue;
          depthByProj.set(d.project_id, {
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
            ossContributions: ossByCand.get(cid) ?? 0,
            lastUpdatedIso:
              typeof r.updated_at === "string"
                ? r.updated_at
                : typeof r.freshness_updated_at === "string"
                  ? r.freshness_updated_at
                  : null,
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
    const docs = await db
      .select({
        id: schema.candidates.id,
        full_name: schema.candidates.full_name,
        headline: schema.candidates.headline,
        domain: schema.candidates.domain,
        total_experience_years: schema.candidates.total_experience_years,
        min_salary: schema.candidates.min_salary,
        salary_frequency: schema.candidates.salary_frequency,
        linkedin_url: schema.candidates.linkedin_url,
        github_url: schema.candidates.github_url,
        portfolio_url: schema.candidates.portfolio_url,
        resume_url: schema.candidates.resume_url,
        photo_url: schema.candidates.photo_url,
        profile_strength: schema.candidates.profile_strength,
        remote_preference: schema.candidates.remote_preference,
        location_city: schema.candidates.location_city,
        availability_status: schema.candidates.availability_status,
        show_email: schema.candidates.show_email,
        show_phone: schema.candidates.show_phone,
        show_linkedin: schema.candidates.show_linkedin,
        show_github: schema.candidates.show_github,
        show_portfolio: schema.candidates.show_portfolio,
        show_resume: schema.candidates.show_resume,
        show_photo: schema.candidates.show_photo,
      })
      .from(schema.candidates)
      .where(eq(schema.candidates.visibility_status, "visible"))
      .orderBy(desc(schema.candidates.created_at))
      .limit(limit);
    rows = docs.map((c) => ({ ...c }));
    unrankedFallback = rows.length > 0;
  }
  wev.add({ result_count: rows.length, chunk_hits: chunks.length, unranked_fallback: unrankedFallback });

  let searchId: string | null = null;
  try {
    searchId = randomUUID();
    await db.insert(schema.searches).values({
      id: searchId,
      employer_id: hr.employerId,
      query_text: queryText,
      query_hash: qhash,
      filters_json: canonicalFilters(jobReq),
      result_count: rows.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[search] search insert failed detail=${redactPii(msg.slice(0, 200))}`);
    searchId = null;
  }

  const saveMatches = async (entries: { candidate_id: string; score: number | null; reasons: Record<string, unknown> }[]): Promise<void> => {
    if (!searchId || !entries.length) return;
    const payload = entries
      .filter((m) => m.candidate_id)
      .map((m) => ({
        id: randomUUID(),
        search_id: searchId as string,
        candidate_id: m.candidate_id,
        score: m.score,
        match_reasons_json: m.reasons,
        status: "shown",
      }));
    if (!payload.length) return;
    try {
      await db
        .insert(schema.candidateMatches)
        .values(payload)
        .onConflictDoNothing({
          target: [schema.candidateMatches.search_id, schema.candidateMatches.candidate_id],
        });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[search] matches insert failed detail=${redactPii(msg.slice(0, 200))}`);
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
    const degradedOut = embedFailed || retrievalFallback || unrankedFallback;
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
    const [judgeCands, judgeProjs, judgeExps, judgeDepths] = await Promise.all([
      topIds.length
        ? db
            .select({
              id: schema.candidates.id,
              full_name: schema.candidates.full_name,
              headline: schema.candidates.headline,
              domain: schema.candidates.domain,
              total_experience_years: schema.candidates.total_experience_years,
              min_salary: schema.candidates.min_salary,
              location_city: schema.candidates.location_city,
              remote_preference: schema.candidates.remote_preference,
              availability_status: schema.candidates.availability_status,
            })
            .from(schema.candidates)
            .where(
              and(
                inArray(schema.candidates.id, topIds),
                eq(schema.candidates.visibility_status, "visible"),
              ),
            )
        : Promise.resolve([] as Record<string, unknown>[]),
      topIds.length
        ? db
            .select({
              id: schema.projects.id,
              candidate_id: schema.projects.candidate_id,
              title: schema.projects.title,
              description: schema.projects.description,
              tech_stack: schema.projects.tech_stack,
              impact_summary: schema.projects.impact_summary,
            })
            .from(schema.projects)
            .where(inArray(schema.projects.candidate_id, topIds))
        : Promise.resolve([] as Record<string, unknown>[]),
      topIds.length
        ? db
            .select({
              candidate_id: schema.workExperiences.candidate_id,
              company_name: schema.workExperiences.company_name,
              job_title: schema.workExperiences.job_title,
              achievements: schema.workExperiences.achievements,
              tech_stack: schema.workExperiences.tech_stack,
            })
            .from(schema.workExperiences)
            .where(inArray(schema.workExperiences.candidate_id, topIds))
            .limit(topIds.length * MAX_EXP_ATTACH)
        : Promise.resolve([] as Record<string, unknown>[]),
      topIds.length
        ? db
            .select({
              project_id: schema.projectDepthAnalysis.project_id,
              complexity_score: schema.projectDepthAnalysis.complexity_score,
              technical_complexity: schema.projectDepthAnalysis.technical_complexity,
              evidence_quality: schema.projectDepthAnalysis.evidence_quality,
              autonomy_level: schema.projectDepthAnalysis.autonomy_level,
            })
            .from(schema.projectDepthAnalysis)
        : Promise.resolve([] as Record<string, unknown>[]),
    ]);
    const candById = new Map(
      (judgeCands as unknown as Record<string, unknown>[]).map((c) => [String(c.id), c]),
    );
    const expsById = new Map<string, Record<string, unknown>[]>();
    for (const e of (judgeExps as unknown as Record<string, unknown>[]) ?? []) {
      const cid = String(e.candidate_id ?? "");
      if (!cid) continue;
      const bucket = expsById.get(cid) ?? [];
      if (bucket.length < MAX_EXP_ATTACH) {
        const rest = { ...e };
        delete rest.candidate_id;
        bucket.push(rest);
      }
      expsById.set(cid, bucket);
    }
    const depthByProjJudge = new Map<string, Record<string, unknown>>();
    for (const d of (judgeDepths as unknown as Record<string, unknown>[]) ?? []) {
      const pid = String(d.project_id ?? "");
      if (pid) depthByProjJudge.set(pid, d);
    }
    const projsById = new Map<string, Record<string, unknown>[]>();
    for (const p of judgeProjs as unknown as Record<string, unknown>[]) {
      const cid = String(p.candidate_id ?? "");
      if (!cid) continue;
      const bucket = projsById.get(cid) ?? [];
      if (bucket.length < MAX_PROJECTS_DEEP) {
        const rest = { ...p };
        delete rest.candidate_id;
        const depth = depthByProjJudge.get(String(p.id ?? ""));
        if (depth) {
          const d = { ...depth };
          delete d.project_id;
          rest.depth_analysis = d;
        }
        bucket.push(rest);
      }
      projsById.set(cid, bucket);
    }
    const inputs: JudgeInput[] = top.map((r) => {
      const cid = String(r.id ?? "");
      return {
        candidate_id: cid,
        job: jobReq,
        candidateJson: {
          candidate: candById.get(cid) ?? r,
          work_experiences: expsById.get(cid) ?? [],
          projects: projsById.get(cid) ?? [],
        },
      };
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
    wev.add({ judged: merged.length, deep: true, degraded: embedFailed || retrievalFallback || judgeNulls === merged.length });
    await attachProfileRows(merged);
    await attachContacts(merged);
    const results = finalize(merged);
    return Response.json({ results, queryText, searchId, deep: true, degraded: (embedFailed || retrievalFallback || (merged.length > 0 && judgeNulls === merged.length)) || undefined });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[search] deep judge failed detail=${redactPii(msg.slice(0, 200))}`);
    await attachProfileRows(rows);
    await attachContacts(rows);
    const results = finalize(rows);
    return Response.json({ results, queryText, searchId, deepError: "Deep read unavailable. Showing rule-ranked results.", degraded: true });
  }
});
