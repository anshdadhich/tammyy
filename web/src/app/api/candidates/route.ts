import { randomUUID } from "crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type Db } from "@/db/client";
import { cfEnv } from "@/lib/cf";
import { enqueueProfilePipeline } from "@/lib/pipeline";
import { candidateSchema, normalizeEmail } from "@/lib/validators";
import { revealedCandidateIds, lockContacts } from "@/lib/contact-prefs";
import { normalizeSkills } from "@/lib/skills";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { redactPii } from "@/lib/redact";
import { readJsonBody } from "@/lib/http";
import {
  bundleForViewer,
  guardOwnerAuth,
  verifyEmailChangeToken,
} from "@/lib/api-auth";
import { deleteObject } from "@/lib/storage";
import { deleteChunksForCandidate } from "@/lib/matching/retrieval";
import {
  requireHrDb,
  requireOwnerDb,
  userDb,
  getSessionUser,
} from "@/lib/auth-user";

const uuid = z.string().uuid("Must be a valid UUID");

const SHOW_FLAGS = [
  "show_email",
  "show_phone",
  "show_linkedin",
  "show_github",
  "show_resume",
  "show_portfolio",
  "show_photo",
] as const;

const CONTACT_COLS = [
  "contact_email",
  "contact_phone",
  "linkedin_url",
  "github_url",
  "portfolio_url",
  "resume_url",
  "photo_url",
] as const;

const JSON_LIMITS: Record<string, number> = {
  "candidates-post": 1024 * 1024,
  "candidates-put": 1024 * 1024,
  "candidates-patch": 256 * 1024,
  "candidates-delete": 256 * 1024,
};

function isUniqueViolation(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  return /UNIQUE constraint failed/i.test(String((e as { message?: string }).message ?? ""));
}

function nullPublicContact(c: Record<string, unknown>): Record<string, unknown> {
  const out = { ...c };
  for (const col of CONTACT_COLS) out[col] = null;
  out.min_salary = null;
  out.salary_currency = null;
  out.salary_frequency = null;
  out.salary_negotiable = null;
  return out;
}

function prefsDegraded(c: Record<string, unknown>): boolean {
  return SHOW_FLAGS.some((f) => !(f in c));
}

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

async function verifyCaptchaHook(raw: unknown, request: Request): Promise<boolean> {
  if (process.env.CAPTCHA_REQUIRED !== "1" && process.env.TURNSTILE_REQUIRED !== "1") {
    return true;
  }
  const r = (raw ?? {}) as Record<string, unknown>;
  const token = r.captchaToken ?? r.turnstileToken ?? r["cf-turnstile-response"];
  if (typeof token !== "string" || token.trim().length < 8) return false;
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return false;
  try {
    const body = new FormData();
    body.set("secret", secret);
    body.set("response", token);
    body.set("remoteip", request.headers.get("cf-connecting-ip") ?? "");
    const res = await fetch(TURNSTILE_VERIFY_URL, { method: "POST", body });
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    return false;
  }
}

function honeypotTripped(raw: unknown): boolean {
  const r = (raw ?? {}) as Record<string, unknown>;
  for (const k of ["website", "company_website", "url_website", "honeypot", "_hp"]) {
    const v = r[k];
    if (typeof v === "string" && v.trim() !== "") return true;
  }
  return false;
}

/**
 * Child reads must never fail the response (empty lists on error), matching
 * the long-standing contract of this endpoint.
 */
async function safeRead<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.error(
      "[candidates] read failed",
      redactPii((e as Error)?.message ?? String(e)).slice(0, 200),
    );
    return fallback;
  }
}

/**
 * Children first so a failed cascade leaves the candidate row in place
 * (retryable), then the candidate itself. SQLite cascades cover most of
 * this, but the explicit order keeps behavior independent of PRAGMA state.
 */
async function cascadeDeleteCandidate(db: Db, candidateId: string): Promise<void> {
  const projIds = (
    await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(eq(schema.projects.candidate_id, candidateId))
  ).map((p) => p.id);

  await db.delete(schema.candidateProfiles).where(eq(schema.candidateProfiles.candidate_id, candidateId));
  await db.delete(schema.workExperiences).where(eq(schema.workExperiences.candidate_id, candidateId));
  await db.delete(schema.projects).where(eq(schema.projects.candidate_id, candidateId));
  await db.delete(schema.education).where(eq(schema.education.candidate_id, candidateId));
  await db.delete(schema.candidateSkills).where(eq(schema.candidateSkills.candidate_id, candidateId));
  await db.delete(schema.profileChunks).where(eq(schema.profileChunks.candidate_id, candidateId));
  await db.delete(schema.openSourceContributions).where(eq(schema.openSourceContributions.candidate_id, candidateId));
  await db.delete(schema.candidateMatches).where(eq(schema.candidateMatches.candidate_id, candidateId));
  await db.delete(schema.shortlists).where(eq(schema.shortlists.candidate_id, candidateId));
  await db.delete(schema.contactLog).where(eq(schema.contactLog.candidate_id, candidateId));
  if (projIds.length) {
    await db
      .delete(schema.projectDepthAnalysis)
      .where(inArray(schema.projectDepthAnalysis.project_id, projIds));
  }
  await db.delete(schema.candidates).where(eq(schema.candidates.id, candidateId));
}

export async function GET(request: Request) {
  const rl = await rateLimit(request, { key: "candidates-get", limit: 120, windowMs: 60_000 });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs);
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? undefined;
  if (!id) {
    return Response.json({ error: "provide ?id=<candidate uuid>" }, { status: 400 });
  }
  const session = await getSessionUser();
  const viewer = session?.viewer ?? { kind: "anon" as const };
  if (!uuid.safeParse(id).success) {
    return Response.json({ error: "id must be a valid UUID" }, { status: 400 });
  }

  const db = await getDb();
  const raw = await safeRead(async () => {
    const rows = await db
      .select()
      .from(schema.candidates)
      .where(eq(schema.candidates.id, id))
      .limit(1);
    return rows[0] ?? null;
  }, null);
  if (!raw) return Response.json({ error: "candidate not found" }, { status: 404 });
  const candidate: Record<string, unknown> = { ...raw, id: raw.id };
  const cid = raw.id;

  let isOwnerVerified = false;
  if (viewer.kind === "owner" && viewer.id === cid) {
    const gate = await requireOwnerDb(cid, session);
    isOwnerVerified = !(gate instanceof Response);
  }
  let isHrVerified = false;
  let hrEmployerId: string | null = null;
  if (viewer.kind === "hr") {
    const hr = await requireHrDb(session);
    if (!(hr instanceof Response)) {
      isHrVerified = true;
      hrEmployerId = hr.employerId;
    }
  }

  if (String(candidate.visibility_status ?? "visible") !== "visible" && !isOwnerVerified) {
    return Response.json({ error: "candidate not found" }, { status: 404 });
  }

  const privilegedLogs = isOwnerVerified || isHrVerified;

  let effective: Record<string, unknown>;
  if (isOwnerVerified) {
    effective = { ...candidate };
  } else if (isHrVerified) {
    effective = { ...candidate, user_id: null, consent_status: null };
  } else {
    effective = nullPublicContact({ ...candidate, user_id: null, consent_status: null });
  }
  if (isHrVerified && !isOwnerVerified && hrEmployerId) {
    const revealed = await revealedCandidateIds(hrEmployerId);
    if (!revealed.has(cid)) {
      effective = lockContacts(effective);
    }
  }
  const degraded = prefsDegraded(candidate);

  let ownSearchIds: string[] | null = null;
  if (privilegedLogs && !isOwnerVerified && hrEmployerId) {
    const ownSearches = await safeRead(
      async () =>
        (
          await db
            .select({ id: schema.searches.id })
            .from(schema.searches)
            .where(eq(schema.searches.employer_id, hrEmployerId as string))
            .limit(2000)
        ).map((s) => s.id),
      [] as string[],
    );
    ownSearchIds = ownSearches;
  }

  const contactLogQuery = async (): Promise<Record<string, unknown>[]> => {
    const conds = [eq(schema.contactLog.candidate_id, cid)];
    if (!isOwnerVerified && hrEmployerId) conds.push(eq(schema.contactLog.employer_id, hrEmployerId));
    const rows = await db
      .select({
        id: schema.contactLog.id,
        channel: schema.contactLog.channel,
        message: schema.contactLog.message,
        job_id: schema.contactLog.job_id,
        employer_id: schema.contactLog.employer_id,
        created_at: schema.contactLog.created_at,
      })
      .from(schema.contactLog)
      .where(and(...conds))
      .orderBy(desc(schema.contactLog.created_at))
      .limit(50);
    return rows.map((r) => ({ ...r }));
  };
  const matchesQuery = async (): Promise<Record<string, unknown>[]> => {
    const conds = [eq(schema.candidateMatches.candidate_id, cid)];
    if (!isOwnerVerified && ownSearchIds) {
      conds.push(
        inArray(
          schema.candidateMatches.search_id,
          ownSearchIds.length ? ownSearchIds : ["00000000-0000-0000-0000-000000000000"],
        ),
      );
    }
    const rows = await db
      .select({
        id: schema.candidateMatches.id,
        search_id: schema.candidateMatches.search_id,
        job_id: schema.candidateMatches.job_id,
        score: schema.candidateMatches.score,
        status: schema.candidateMatches.status,
        created_at: schema.candidateMatches.created_at,
      })
      .from(schema.candidateMatches)
      .where(and(...conds))
      .orderBy(desc(schema.candidateMatches.created_at))
      .limit(50);
    return rows.map((r) => ({ ...r }));
  };
  const shortlistsQuery = async (): Promise<Record<string, unknown>[]> => {
    const conds = [eq(schema.shortlists.candidate_id, cid)];
    if (!isOwnerVerified && hrEmployerId) conds.push(eq(schema.shortlists.employer_id, hrEmployerId));
    const rows = await db
      .select({
        id: schema.shortlists.id,
        job_id: schema.shortlists.job_id,
        status: schema.shortlists.status,
        notes: schema.shortlists.notes,
        created_at: schema.shortlists.created_at,
      })
      .from(schema.shortlists)
      .where(and(...conds))
      .orderBy(desc(schema.shortlists.created_at))
      .limit(50);
    return rows.map((r) => ({ ...r }));
  };

  const profileP = safeRead<Record<string, unknown> | null>(async () => {
    const rows = await db
      .select({
        summary_markdown: schema.candidateProfiles.summary_markdown,
        summary_json: schema.candidateProfiles.summary_json,
        updated_at: schema.candidateProfiles.updated_at,
      })
      .from(schema.candidateProfiles)
      .where(eq(schema.candidateProfiles.candidate_id, cid))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      summary_markdown: r.summary_markdown ?? null,
      summary_json: r.summary_json ?? {},
      updated_at: r.updated_at ?? null,
    };
  }, null);
  const viewsP = privilegedLogs
    ? safeRead(contactLogQuery, [] as Record<string, unknown>[])
    : Promise.resolve([] as Record<string, unknown>[]);
  const matchesP = privilegedLogs
    ? safeRead(matchesQuery, [] as Record<string, unknown>[])
    : Promise.resolve([] as Record<string, unknown>[]);
  const shortlistedP = privilegedLogs
    ? safeRead(shortlistsQuery, [] as Record<string, unknown>[])
    : Promise.resolve([] as Record<string, unknown>[]);

  const projectsP = safeRead<Record<string, unknown>[]>(async () => {
    const rows = await db
      .select({
        id: schema.projects.id,
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
      .where(eq(schema.projects.candidate_id, cid));
    return rows.map((r) => ({ ...r, tech_stack: r.tech_stack ?? [] }));
  }, []);
  const experiencesP = safeRead<Record<string, unknown>[]>(async () => {
    const rows = await db
      .select({
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
      .where(eq(schema.workExperiences.candidate_id, cid));
    return rows.map((r) => ({ ...r, is_current: r.is_current ?? false, tech_stack: r.tech_stack ?? [] }));
  }, []);
  const educationP = safeRead<Record<string, unknown>[]>(async () => {
    const rows = await db
      .select({
        institution: schema.education.institution,
        degree: schema.education.degree,
        field_of_study: schema.education.field_of_study,
        start_year: schema.education.start_year,
        end_year: schema.education.end_year,
        achievements: schema.education.achievements,
      })
      .from(schema.education)
      .where(eq(schema.education.candidate_id, cid));
    return rows.map((r) => ({ ...r }));
  }, []);
  const skillRowsP = safeRead<Record<string, unknown>[]>(async () => {
    const linkRows = await db
      .select({
        skill_id: schema.candidateSkills.skill_id,
        experience_years: schema.candidateSkills.experience_years,
        proficiency_level: schema.candidateSkills.proficiency_level,
        source: schema.candidateSkills.source,
      })
      .from(schema.candidateSkills)
      .where(eq(schema.candidateSkills.candidate_id, cid));
    const skillIds = [...new Set(linkRows.map((r) => r.skill_id).filter(Boolean))];
    const skillDocs = skillIds.length
      ? await db
          .select({ id: schema.skills.id, name: schema.skills.name })
          .from(schema.skills)
          .where(inArray(schema.skills.id, skillIds))
      : [];
    const nameById = new Map(skillDocs.map((s) => [s.id, s.name]));
    return linkRows.map((r) => ({
      experience_years: r.experience_years ?? null,
      proficiency_level: r.proficiency_level ?? null,
      source: r.source ?? null,
      skills: { name: nameById.get(r.skill_id) ?? null },
    }));
  }, []);
  const ossP = safeRead<Record<string, unknown>[]>(async () => {
    const rows = await db
      .select({
        id: schema.openSourceContributions.id,
        repo_name: schema.openSourceContributions.repo_name,
        repo_url: schema.openSourceContributions.repo_url,
        description: schema.openSourceContributions.description,
        pr_links: schema.openSourceContributions.pr_links,
        tech_stack: schema.openSourceContributions.tech_stack,
        role: schema.openSourceContributions.role,
      })
      .from(schema.openSourceContributions)
      .where(eq(schema.openSourceContributions.candidate_id, cid));
    return rows.map((r) => ({ ...r, pr_links: r.pr_links ?? [], tech_stack: r.tech_stack ?? [] }));
  }, []);

  const [profile, views, matches, shortlisted, projects, experiences, education, skillRows, oss] =
    await Promise.all([
      profileP,
      viewsP,
      matchesP,
      shortlistedP,
      projectsP,
      experiencesP,
      educationP,
      skillRowsP,
      ossP,
    ]);

  const depths: Record<string, Record<string, unknown>> = {};
  const projIds = projects.map((p) => String(p.id ?? "")).filter(Boolean);
  if (projIds.length) {
    const depthRows = await safeRead(
      async () =>
        (
          await db
            .select({
              project_id: schema.projectDepthAnalysis.project_id,
              complexity_score: schema.projectDepthAnalysis.complexity_score,
              technical_complexity: schema.projectDepthAnalysis.technical_complexity,
              architectural_concepts: schema.projectDepthAnalysis.architectural_concepts,
              autonomy_level: schema.projectDepthAnalysis.autonomy_level,
              evidence_quality: schema.projectDepthAnalysis.evidence_quality,
            })
            .from(schema.projectDepthAnalysis)
            .where(inArray(schema.projectDepthAnalysis.project_id, projIds))
        ).map((d) => ({ ...d, architectural_concepts: d.architectural_concepts ?? [] })),
      [] as Record<string, unknown>[],
    );
    for (const d of depthRows) {
      depths[String(d.project_id)] = d;
    }
  }

  const bundled = bundleForViewer(privilegedLogs ? viewer : { kind: "anon" }, effective, {
    profile: profile ?? null,
    contact_log: views,
    matches,
    shortlists: shortlisted,
    projects,
    oss,
    experiences,
    education,
    skills: skillRows,
    depths,
  });
  if (isOwnerVerified) {
    (bundled as Record<string, unknown>).candidate = { ...candidate };
  }
  if (degraded) {
    return Response.json({ ...bundled, contactPrefsDegraded: true });
  }
  return Response.json(bundled);
}

const MONTHS: Record<string, string> = {
  jan: "01", january: "01",
  feb: "02", february: "02",
  mar: "03", march: "03",
  apr: "04", april: "04",
  may: "05",
  jun: "06", june: "06",
  jul: "07", july: "07",
  aug: "08", august: "08",
  sep: "09", sept: "09", september: "09",
  oct: "10", october: "10",
  nov: "11", november: "11",
  dec: "12", december: "12",
};

function toDateInput(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  if (/^\d{4}$/.test(s)) return `${s}-01-01`;
  const m = s.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (m) {
    const mm = MONTHS[m[1].toLowerCase()];
    if (mm) return `${m[2]}-${mm}-01`;
  }
  return null;
}

function normJson(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normJson);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      o[k] = normJson((v as Record<string, unknown>)[k]);
    }
    return o;
  }
  return v ?? null;
}

function sameRows(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  const sa = a.map((r) => JSON.stringify(normJson(r))).sort();
  const sb = b.map((r) => JSON.stringify(normJson(r))).sort();
  return sa.every((s, i) => s === sb[i]);
}

async function skillIdMap(
  db: Db,
  names: unknown,
): Promise<{ canon: string[]; byName: Map<string, string>; ok: boolean }> {
  const raw = Array.isArray(names) ? names : [];
  const canon = normalizeSkills(
    raw
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.trim())
      .filter((s) => s.length >= 2 && s.length <= 60 && /^[A-Za-z0-9][A-Za-z0-9 +#./&\-]{1,59}$/.test(s)),
  );
  const byName = new Map<string, string>();
  if (!canon.length) return { canon, byName, ok: true };
  try {
    for (const name of canon) {
      await db
        .insert(schema.skills)
        .values({ id: randomUUID(), name, aliases: [] })
        .onConflictDoNothing();
    }
  } catch {
  }
  try {
    const data = await db
      .select({ id: schema.skills.id, name: schema.skills.name })
      .from(schema.skills)
      .where(inArray(schema.skills.name, canon));
    for (const s of data) {
      byName.set(s.name.toLowerCase(), s.id);
    }
  } catch {
    return { canon, byName, ok: false };
  }
  return { canon, byName, ok: true };
}

async function enqueuePipeline(candidateId: string): Promise<void> {
  try {
    const env = await cfEnv();
    await enqueueProfilePipeline(env, candidateId);
  } catch (e) {
    console.error("[candidates] pipeline enqueue failed", redactPii((e as Error)?.message ?? String(e)).slice(0, 200));
  }
}

export async function POST(request: Request) {
  const rl = await rateLimit(request, { key: "candidates-post", limit: 10, windowMs: 10 * 60_000 });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs);
  const read = await readJsonBody(request, JSON_LIMITS["candidates-post"]);
  if (!read.ok) return read.response;
  const rawBody = read.body;
  if (honeypotTripped(rawBody)) {
    return Response.json({ error: "submission rejected" }, { status: 400 });
  }
  if (!(await verifyCaptchaHook(rawBody, request))) {
    return Response.json({ error: "verification required" }, { status: 403 });
  }
  const session = await getSessionUser();
  if (session?.userRow && session.userRow.role === "employer") {
    return Response.json({ error: "Employer accounts cannot create candidate profiles." }, { status: 403 });
  }
  const parsed = candidateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }
  const c = parsed.data;
  const email = normalizeEmail(c.email);
  const db = await getDb();

  try {
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recent = await db
      .select({ id: schema.candidates.id, created_at: schema.candidates.created_at })
      .from(schema.candidates)
      .where(
        and(
          eq(schema.candidates.contact_email, email),
          sql`${schema.candidates.created_at} > ${windowStart}`,
        ),
      )
      .orderBy(desc(schema.candidates.created_at))
      .limit(5);
    if (recent.length >= 3) {
      return Response.json({ error: "Too many submissions for this email. Try again later." }, { status: 429 });
    }
    const newest = recent[0];
    if (newest && Date.now() - Date.parse(newest.created_at) < 10 * 60 * 1000) {
      return Response.json(
        { error: "A submission for this email is already pending.", candidateId: newest.id },
        { status: 429 },
      );
    }
  } catch {
  }

  let dupe: { id: string } | undefined;
  try {
    const rows = await db
      .select({ id: schema.candidates.id })
      .from(schema.candidates)
      .where(eq(schema.candidates.contact_email, email))
      .limit(1);
    dupe = rows[0];
  } catch {
    dupe = undefined;
  }
  if (dupe?.id) {
    return Response.json(
      { error: "A profile already exists for this email.", candidateId: dupe.id },
      { status: 409 },
    );
  }

  let userId: string | null = null;
  let createdUser = false;
  try {
    const existing = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);
    if (existing[0]) {
      userId = existing[0].id;
    } else {
      userId = randomUUID();
      await db.insert(schema.users).values({
        id: userId,
        email,
        role: "candidate",
        status: "active",
        email_verified: false,
      });
      createdUser = true;
    }
  } catch (e) {
    console.error("[candidates] user create failed", redactPii((e as Error)?.message ?? String(e)).slice(0, 200));
    return Response.json({ error: "user create failed" }, { status: 500 });
  }

  const remoteMap: Record<string, string> = { remote: "remote_only", hybrid: "hybrid", onsite: "onsite" };
  const avail = /immedi/i.test(c.availability ?? "") ? "immediate" : /inactive/i.test(c.availability ?? "") ? "inactive" : "notice";
  const candidateId = randomUUID();
  const row = {
    id: candidateId,
    user_id: userId,
    full_name: c.name,
    headline: c.headline || `${c.role} - ${c.domain}`,
    domain: c.domain,
    current_position: c.current_role || c.role,
    total_experience_years: c.exp ?? 0,
    education_level: null,
    location_city: c.location_pref || c.location,
    location_country: "India",
    remote_preference: remoteMap[c.remote_pref] ?? "flexible",
    open_to_relocation: c.relocation ?? false,
    min_salary: c.min_salary ?? 0,
    salary_currency: (c.currency ?? "INR").toUpperCase(),
    salary_frequency: c.frequency ?? "monthly",
    salary_negotiable: c.negotiable ?? true,
    availability_status: avail,
    notice_period: (c.notice_period ?? "").trim().slice(0, 200) || null,
    // Honor the wizard's chosen visibility; hidden profiles are not
    // embedded until shown (PATCH re-enqueues the pipeline).
    visibility_status: c.visibility === "visible" ? "visible" : "hidden",
    consent_status: "pending",
    show_email: c.show_email === true,
    show_phone: c.show_phone === true,
    show_linkedin: c.show_linkedin === true,
    show_github: c.show_github === true,
    show_resume: c.show_resume === true,
    show_portfolio: c.show_portfolio === true,
    show_photo: c.show_photo === true,
    contact_email: email,
    contact_phone: c.phone || null,
    github_url: c.links?.github || null,
    linkedin_url: c.links?.linkedin || null,
    portfolio_url: c.links?.portfolio || null,
    resume_url: c.links?.resume_url || null,
    photo_url: c.photo_url || null,
    profile_strength: null,
  };
  try {
    await db.insert(schema.candidates).values(row);
  } catch (e) {
    console.error("[candidates] create failed", redactPii((e as Error)?.message ?? String(e)).slice(0, 200));
    if (createdUser && userId) {
      try {
        await db.delete(schema.users).where(eq(schema.users.id, userId));
      } catch {
      }
    }
    return Response.json({ error: "candidate create failed" }, { status: 500 });
  }

  const warnings: string[] = [];
  const cleanTech = (t: unknown): string[] =>
    Array.isArray(t) ? t.filter((x): x is string => typeof x === "string") : [];
  const cleanProjType = (t: unknown): string | null =>
    typeof t === "string" &&
    ["personal", "academic", "freelance", "production", "open_source", "prototype"].includes(t)
      ? t
      : null;

  try {
    if (c.experiences?.length) {
      await db.insert(schema.workExperiences).values(
        c.experiences.map((x) => ({
          id: randomUUID(),
          candidate_id: candidateId,
          company_name: x.company,
          job_title: x.title,
          employment_type: null,
          start_date: toDateInput(x.start_date),
          end_date: toDateInput(x.end_date),
          is_current: x.current ?? false,
          description: x.description || null,
          achievements: x.achievements || null,
          tech_stack: cleanTech(x.tech),
          evidence_links: [],
        })),
      );
    }
  } catch (e) {
    console.error("[candidates] experience insert threw", redactPii((e as Error).message));
    warnings.push("experience: could not save (code EXP_SAVE)");
  }
  try {
    if (c.projects?.length) {
      await db.insert(schema.projects).values(
        c.projects.map((p) => ({
          id: randomUUID(),
          candidate_id: candidateId,
          title: p.title,
          description: p.description,
          problem_statement: p.problem || null,
          tech_stack: cleanTech(p.tech),
          role_in_project: p.role || null,
          project_link: p.links?.live || null,
          repo_link: p.links?.repo || null,
          deployment_link: p.links?.demo || p.links?.live || null,
          impact_summary: [p.impact, p.users_scale, p.hardest_challenge, p.personal_contribution].filter(Boolean).join("\n\n") || null,
          project_type: cleanProjType(p.project_type),
        })),
      );
    }
  } catch (e) {
    console.error("[candidates] projects insert threw", redactPii((e as Error).message));
    warnings.push("projects: could not save (code PRJ_SAVE)");
  }
  try {
    if (c.oss?.length) {
      const ossRows = c.oss
        .filter((o) => o.repo_name?.trim())
        .map((o) => ({
          id: randomUUID(),
          candidate_id: candidateId,
          repo_name: o.repo_name.trim(),
          repo_url: o.repo_url || null,
          description: o.description || null,
          pr_links: (o.pr_links ?? []).filter((u) => u && u.trim()),
          tech_stack: cleanTech(o.tech),
          role: o.role || "Contributor",
        }));
      if (ossRows.length) await db.insert(schema.openSourceContributions).values(ossRows);
    }
  } catch (e) {
    console.error("[candidates] oss insert threw", redactPii((e as Error).message));
    warnings.push("open source: could not save (code OSS_SAVE)");
  }
  try {
    if (c.education?.length) {
      const rows = c.education.filter((e) => e.institution).map((e) => {
        const yrs = (e.years || "").match(/\d{4}/g) ?? [];
        return {
          id: randomUUID(),
          candidate_id: candidateId,
          institution: e.institution,
          degree: e.degree || null,
          field_of_study: e.field || null,
          start_year: yrs[0] ? Number(yrs[0]) : null,
          end_year: yrs[1] ? Number(yrs[1]) : null,
          achievements: e.achievements || null,
        };
      });
      if (rows.length) await db.insert(schema.education).values(rows);
    }
  } catch (e) {
    console.error("[candidates] education insert threw", redactPii((e as Error).message));
    warnings.push("education: could not save (code EDU_SAVE)");
  }
  try {
    if (c.skills?.length) {
      const { canon, byName } = await skillIdMap(db, c.skills);
      const links = canon.flatMap((name) => {
        const id = byName.get(name.toLowerCase());
        return id ? [{ candidate_id: candidateId, skill_id: id, source: "self_reported" }] : [];
      });
      if (links.length) {
        await db
          .insert(schema.candidateSkills)
          .values(links)
          .onConflictDoNothing();
      } else if (c.skills?.length) {
        warnings.push("skills: some skill names were skipped");
      }
    }
  } catch (e) {
    console.error("[candidates] skills upsert threw", redactPii((e as Error).message));
    warnings.push("skills: could not save (code SKL_SAVE)");
  }

  if (warnings.some((w) => /\(code [A-Z_]+\)/.test(w))) {
    try {
      if (candidateId) {
        await cascadeDeleteCandidate(db, candidateId);
      }
      if (createdUser && userId) {
        await db.delete(schema.users).where(eq(schema.users.id, userId));
      }
    } catch {
      console.error("[candidates] rollback failed — manual cleanup needed", redactPii(candidateId ?? ""));
      return Response.json({ error: "Could not save the profile and rollback failed. Contact support." }, { status: 500 });
    }
    return Response.json({ error: "Could not save the profile. Fix the highlighted fields and retry." }, { status: 500 });
  }

  await enqueuePipeline(candidateId);

  return Response.json({ candidateId, status: "processing", warnings }, { status: 202 });
}

export async function PATCH(request: Request) {
  const rl = await rateLimit(request, { key: "candidates-patch", limit: 30, windowMs: 60_000 });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs);
  const read = await readJsonBody(request, JSON_LIMITS["candidates-patch"]);
  if (!read.ok) return read.response;
  const body = read.body;
  const parsed = z
    .object({ id: uuid, visibility_status: z.enum(["visible", "hidden", "inactive"]) })
    .safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }
  const denied = await guardOwnerAuth(request, parsed.data.id);
  if (denied) return denied;
  let db;
  try {
    db = await userDb();
  } catch {
    return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
  try {
    const updated = await db
      .update(schema.candidates)
      .set({
        visibility_status: parsed.data.visibility_status,
        updated_at: new Date().toISOString(),
      })
      .where(eq(schema.candidates.id, parsed.data.id))
      .returning({ id: schema.candidates.id, visibility_status: schema.candidates.visibility_status });
    const row = updated[0];
    if (!row) return Response.json({ error: "candidate not found" }, { status: 404 });
    if (parsed.data.visibility_status === "visible") {
      // First time shown (or re-shown): run the pipeline so the profile is
      // embedded and searchable. Hidden profiles are skipped by the workflow.
      await enqueuePipeline(parsed.data.id);
    }
    return Response.json({ candidate: { id: row.id, visibility_status: row.visibility_status } });
  } catch {
    return Response.json({ error: "candidate not found" }, { status: 404 });
  }
}

type ChildTable = "work_experiences" | "projects" | "open_source_contributions" | "education";

async function replaceChildren(
  db: Db,
  table: ChildTable,
  candidateId: string,
  next: Record<string, unknown>[],
  prev: Record<string, unknown>[],
  label: string,
  warnings: string[],
): Promise<boolean> {
  if (sameRows(next, prev)) return false;
  try {
    switch (table) {
      case "work_experiences":
        await db.delete(schema.workExperiences).where(eq(schema.workExperiences.candidate_id, candidateId));
        if (next.length) {
          await db.insert(schema.workExperiences).values(
            next.map((r) => ({
              id: randomUUID(),
              candidate_id: candidateId,
              company_name: String(r.company_name ?? ""),
              job_title: String(r.job_title ?? ""),
              employment_type: (r.employment_type as string | null) ?? null,
              start_date: (r.start_date as string | null) ?? null,
              end_date: (r.end_date as string | null) ?? null,
              is_current: r.is_current === true,
              description: (r.description as string | null) ?? null,
              achievements: (r.achievements as string | null) ?? null,
              tech_stack: (r.tech_stack as string[]) ?? [],
              evidence_links: [],
            })),
          );
        }
        break;
      case "projects":
        await db.delete(schema.projects).where(eq(schema.projects.candidate_id, candidateId));
        if (next.length) {
          await db.insert(schema.projects).values(
            next.map((r) => ({
              id: randomUUID(),
              candidate_id: candidateId,
              title: String(r.title ?? ""),
              description: String(r.description ?? ""),
              problem_statement: (r.problem_statement as string | null) ?? null,
              tech_stack: (r.tech_stack as string[]) ?? [],
              role_in_project: (r.role_in_project as string | null) ?? null,
              project_link: (r.project_link as string | null) ?? null,
              repo_link: (r.repo_link as string | null) ?? null,
              deployment_link: (r.deployment_link as string | null) ?? null,
              impact_summary: (r.impact_summary as string | null) ?? null,
              project_type: (r.project_type as string | null) ?? null,
            })),
          );
        }
        break;
      case "open_source_contributions":
        await db
          .delete(schema.openSourceContributions)
          .where(eq(schema.openSourceContributions.candidate_id, candidateId));
        if (next.length) {
          await db.insert(schema.openSourceContributions).values(
            next.map((r) => ({
              id: randomUUID(),
              candidate_id: candidateId,
              repo_name: String(r.repo_name ?? ""),
              repo_url: (r.repo_url as string | null) ?? null,
              description: (r.description as string | null) ?? null,
              pr_links: (r.pr_links as string[]) ?? [],
              tech_stack: (r.tech_stack as string[]) ?? [],
              role: (r.role as string | null) ?? null,
            })),
          );
        }
        break;
      case "education":
        await db.delete(schema.education).where(eq(schema.education.candidate_id, candidateId));
        if (next.length) {
          await db.insert(schema.education).values(
            next.map((r) => ({
              id: randomUUID(),
              candidate_id: candidateId,
              institution: String(r.institution ?? ""),
              degree: (r.degree as string | null) ?? null,
              field_of_study: (r.field_of_study as string | null) ?? null,
              start_year: (r.start_year as number | null) ?? null,
              end_year: (r.end_year as number | null) ?? null,
              achievements: (r.achievements as string | null) ?? null,
            })),
          );
        }
        break;
    }
    return true;
  } catch (e) {
    console.error(`[candidates] ${label} replace failed`, redactPii((e as Error).message));
    warnings.push(`${label}: could not save`);
    // Best-effort restore of the previous rows.
    try {
      await replaceChildrenRestore(db, table, candidateId, prev);
    } catch (e2) {
      console.error(`[candidates] ${label} restore failed`, redactPii((e2 as Error).message));
    }
    return true;
  }
}

async function replaceChildrenRestore(
  db: Db,
  table: ChildTable,
  candidateId: string,
  prev: Record<string, unknown>[],
): Promise<void> {
  if (!prev.length) return;
  const withIds = prev.map((r) => ({ ...r, id: randomUUID(), candidate_id: candidateId })) as (Record<string, unknown> & { id: string; candidate_id: string })[];
  switch (table) {
    case "work_experiences":
      await db.insert(schema.workExperiences).values(
        withIds.map((r) => ({
          id: r.id,
          candidate_id: candidateId,
          company_name: String(r.company_name ?? ""),
          job_title: String(r.job_title ?? ""),
          employment_type: (r.employment_type as string | null) ?? null,
          start_date: (r.start_date as string | null) ?? null,
          end_date: (r.end_date as string | null) ?? null,
          is_current: r.is_current === true,
          description: (r.description as string | null) ?? null,
          achievements: (r.achievements as string | null) ?? null,
          tech_stack: (r.tech_stack as string[]) ?? [],
          evidence_links: [],
        })),
      );
      break;
    case "projects":
      await db.insert(schema.projects).values(
        withIds.map((r) => ({
          id: r.id,
          candidate_id: candidateId,
          title: String(r.title ?? ""),
          description: String(r.description ?? ""),
          problem_statement: (r.problem_statement as string | null) ?? null,
          tech_stack: (r.tech_stack as string[]) ?? [],
          role_in_project: (r.role_in_project as string | null) ?? null,
          project_link: (r.project_link as string | null) ?? null,
          repo_link: (r.repo_link as string | null) ?? null,
          deployment_link: (r.deployment_link as string | null) ?? null,
          impact_summary: (r.impact_summary as string | null) ?? null,
          project_type: (r.project_type as string | null) ?? null,
        })),
      );
      break;
    case "open_source_contributions":
      await db.insert(schema.openSourceContributions).values(
        withIds.map((r) => ({
          id: r.id,
          candidate_id: candidateId,
          repo_name: String(r.repo_name ?? ""),
          repo_url: (r.repo_url as string | null) ?? null,
          description: (r.description as string | null) ?? null,
          pr_links: (r.pr_links as string[]) ?? [],
          tech_stack: (r.tech_stack as string[]) ?? [],
          role: (r.role as string | null) ?? null,
        })),
      );
      break;
    case "education":
      await db.insert(schema.education).values(
        withIds.map((r) => ({
          id: r.id,
          candidate_id: candidateId,
          institution: String(r.institution ?? ""),
          degree: (r.degree as string | null) ?? null,
          field_of_study: (r.field_of_study as string | null) ?? null,
          start_year: (r.start_year as number | null) ?? null,
          end_year: (r.end_year as number | null) ?? null,
          achievements: (r.achievements as string | null) ?? null,
        })),
      );
      break;
  }
}

export async function PUT(request: Request) {
  const rl = await rateLimit(request, { key: "candidates-put", limit: 20, windowMs: 60_000 });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs);
  const read = await readJsonBody(request, JSON_LIMITS["candidates-put"]);
  if (!read.ok) return read.response;
  const body = read.body;
  const idParsed = z.object({ id: uuid }).safeParse(body);
  if (!idParsed.success) {
    return Response.json({ errors: idParsed.error.flatten() }, { status: 400 });
  }
  const id = idParsed.data.id;
  const denied = await guardOwnerAuth(request, id);
  if (denied) return denied;
  const rest = { ...(body as Record<string, unknown>) };
  delete rest.id;
  if (Object.keys(rest).length === 0) {
    return Response.json({ error: "nothing to update" }, { status: 400 });
  }
  const parsed = candidateSchema.partial().safeParse(rest);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }
  const db = await getDb();
  let prev: { id: string; user_id: string | null; contact_email: string | null } | undefined;
  try {
    const rows = await db
      .select({
        id: schema.candidates.id,
        user_id: schema.candidates.user_id,
        contact_email: schema.candidates.contact_email,
      })
      .from(schema.candidates)
      .where(eq(schema.candidates.id, id))
      .limit(1);
    prev = rows[0];
  } catch {
    prev = undefined;
  }
  if (!prev) return Response.json({ error: "candidate not found" }, { status: 404 });
  const c = parsed.data;
  const present = new Set(Object.keys(rest));

  const patch: Record<string, unknown> = {};
  if (present.has("name")) patch.full_name = c.name;
  if (present.has("headline") || present.has("role") || present.has("domain")) {
    const head = (c.headline || "").trim();
    const role = (c.role || "").trim();
    const domain = (c.domain || "").trim();
    if (head) patch.headline = head;
    else if (role || domain) patch.headline = [role, domain].filter(Boolean).join(" - ");
  }
  if (present.has("domain")) patch.domain = c.domain;
  if (present.has("current_role") || present.has("role")) {
    const cur = (c.current_role || "").trim();
    patch.current_position = cur || (c.role || "").trim() || null;
  }
  if (present.has("exp")) patch.total_experience_years = c.exp ?? 0;
  if (present.has("location_pref") || present.has("location")) {
    const pref = (c.location_pref || "").trim();
    const loc = (c.location || "").trim();
    if (pref || loc) patch.location_city = pref || loc;
  }
  if (present.has("remote_pref")) {
    const remoteMap: Record<string, string> = { remote: "remote_only", hybrid: "hybrid", onsite: "onsite" };
    if (c.remote_pref) patch.remote_preference = remoteMap[c.remote_pref] ?? "flexible";
  }
  if (present.has("relocation")) patch.open_to_relocation = c.relocation ?? false;
  if (present.has("min_salary")) patch.min_salary = c.min_salary ?? 0;
  if (present.has("currency")) patch.salary_currency = ((c.currency ?? "INR") || "INR").toUpperCase();
  if (present.has("frequency")) patch.salary_frequency = c.frequency ?? "monthly";
  if (present.has("negotiable")) patch.salary_negotiable = c.negotiable ?? true;
  if (present.has("availability")) {
    const a = c.availability ?? "";
    patch.availability_status = /immedi/i.test(a) ? "immediate" : /inactive/i.test(a) ? "inactive" : "notice";
  }
  if (present.has("notice_period")) {
    patch.notice_period = (c.notice_period ?? "").trim().slice(0, 200) || null;
  }
  if (present.has("visibility")) patch.visibility_status = c.visibility ?? "visible";
  for (const flag of SHOW_FLAGS) {
    if (present.has(flag)) patch[flag] = c[flag] === true;
  }
  if (present.has("phone")) patch.contact_phone = c.phone || null;
  if (present.has("photo_url")) {
    const v = typeof c.photo_url === "string" ? c.photo_url.trim() : "";
    patch.photo_url = v ? v : null;
  }
  if (present.has("links")) {
    const li = (rest.links ?? {}) as Record<string, unknown>;
    const linkOrNull = (k: string): string | null => {
      const v = li[k];
      return typeof v === "string" && v.trim() ? v.trim() : null;
    };
    if ("github" in li) patch.github_url = linkOrNull("github");
    if ("linkedin" in li) patch.linkedin_url = linkOrNull("linkedin");
    if ("portfolio" in li) patch.portfolio_url = linkOrNull("portfolio");
    if ("resume_url" in li) patch.resume_url = linkOrNull("resume_url");
  }
  if (present.has("email") && c.email) {
    const email = normalizeEmail(c.email);
    if (email && email !== normalizeEmail(prev.contact_email)) {
      const rawToken = (body as Record<string, unknown>)?.email_change_token;
      const changeToken = typeof rawToken === "string" ? rawToken : "";
      if (!changeToken || !verifyEmailChangeToken(changeToken, id, email)) {
        return Response.json(
          { error: "Verify the new email address first, then retry the save." },
          { status: 403 },
        );
      }
      let clash: { id: string } | undefined;
      try {
        const rows = await db
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.email, email))
          .limit(1);
        clash = rows[0];
      } catch {
        clash = undefined;
      }
      if (clash?.id) {
        return Response.json(
          { error: "That email is already in use. Verify ownership first." },
          { status: 409 },
        );
      }
      // `users` is the single identity row: updating email here is the
      // whole change — OTPs and logins read it.
      if (!prev.user_id) {
        return Response.json({ error: "Could not change email. Try again." }, { status: 500 });
      }
      try {
        await db
          .update(schema.users)
          .set({ email })
          .where(eq(schema.users.id, prev.user_id));
      } catch (e) {
        const msg = (e as Error)?.message ?? "";
        if (isUniqueViolation(e) || /already|exists|taken|duplicate/i.test(msg)) {
          return Response.json(
            { error: "That email is already in use. Verify ownership first." },
            { status: 409 },
          );
        }
        console.error("[candidates] user email update failed", redactPii(msg));
        return Response.json({ error: "Could not change email. Try again." }, { status: 500 });
      }
      patch.contact_email = email;
    }
  }

  if (Object.keys(patch).length > 0) {
    try {
      await db
        .update(schema.candidates)
        .set({ ...(patch as Record<string, never>), updated_at: new Date().toISOString() })
        .where(eq(schema.candidates.id, id));
    } catch (e) {
      console.error("[candidates] update failed", redactPii(id), redactPii((e as Error).message));
      return Response.json({ error: "candidate update failed" }, { status: 500 });
    }
  }

  const putWarnings: string[] = [];
  let materialChanged = Object.keys(patch).length > 0;
  const cleanTech = (t: unknown): string[] =>
    Array.isArray(t) ? t.filter((x): x is string => typeof x === "string") : [];
  const cleanProjType = (t: unknown): string | null =>
    typeof t === "string" &&
    ["personal", "academic", "freelance", "production", "open_source", "prototype"].includes(t)
      ? t
      : null;

  const readPrev = async <T>(fn: () => Promise<T[]>, fallback: T[]): Promise<T[]> => {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  };

  if (present.has("experiences")) {
    const nextExp = (c.experiences ?? []).map((x) => ({
      company_name: x.company,
      job_title: x.title,
      start_date: toDateInput(x.start_date),
      end_date: toDateInput(x.end_date),
      is_current: x.current ?? false,
      description: x.description || null,
      achievements: x.achievements || null,
      tech_stack: cleanTech(x.tech),
    }));
    const expRows = await readPrev(async () => {
      const rows = await db
        .select({
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
        .where(eq(schema.workExperiences.candidate_id, id));
      return rows.map((r) => ({ ...r, is_current: r.is_current ?? false, tech_stack: r.tech_stack ?? [] }));
    }, []);
    const changed = await replaceChildren(
      db,
      "work_experiences",
      id,
      nextExp,
      expRows as Record<string, unknown>[],
      "experience",
      putWarnings,
    );
    if (changed && !sameRows(nextExp, expRows as unknown[])) materialChanged = true;
  }
  if (present.has("projects")) {
    const nextProj = (c.projects ?? []).map((p) => ({
      title: p.title,
      description: p.description,
      problem_statement: p.problem || null,
      tech_stack: cleanTech(p.tech),
      role_in_project: p.role || null,
      project_link: p.links?.live || null,
      repo_link: p.links?.repo || null,
      deployment_link: p.links?.demo || p.links?.live || null,
      impact_summary: [p.impact, p.users_scale, p.hardest_challenge, p.personal_contribution].filter(Boolean).join("\n\n") || null,
      project_type: cleanProjType(p.project_type),
    }));
    const projRows = await readPrev(async () => {
      const rows = await db
        .select({
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
        .where(eq(schema.projects.candidate_id, id));
      return rows.map((r) => ({ ...r, tech_stack: r.tech_stack ?? [] }));
    }, []);
    const changed = await replaceChildren(
      db,
      "projects",
      id,
      nextProj,
      projRows as Record<string, unknown>[],
      "projects",
      putWarnings,
    );
    if (changed && !sameRows(nextProj, projRows as unknown[])) materialChanged = true;
  }
  if (present.has("oss")) {
    const nextOss = (c.oss ?? [])
      .filter((o) => o.repo_name?.trim())
      .map((o) => ({
        repo_name: o.repo_name.trim(),
        repo_url: o.repo_url || null,
        description: o.description || null,
        pr_links: (o.pr_links ?? []).filter((u) => u && u.trim()),
        tech_stack: cleanTech(o.tech),
        role: o.role || "Contributor",
      }));
    const ossRows = await readPrev(async () => {
      const rows = await db
        .select({
          repo_name: schema.openSourceContributions.repo_name,
          repo_url: schema.openSourceContributions.repo_url,
          description: schema.openSourceContributions.description,
          pr_links: schema.openSourceContributions.pr_links,
          tech_stack: schema.openSourceContributions.tech_stack,
          role: schema.openSourceContributions.role,
        })
        .from(schema.openSourceContributions)
        .where(eq(schema.openSourceContributions.candidate_id, id));
      return rows.map((r) => ({ ...r, pr_links: r.pr_links ?? [], tech_stack: r.tech_stack ?? [] }));
    }, []);
    const changed = await replaceChildren(
      db,
      "open_source_contributions",
      id,
      nextOss,
      ossRows as Record<string, unknown>[],
      "open source",
      putWarnings,
    );
    if (changed && !sameRows(nextOss, ossRows as unknown[])) materialChanged = true;
  }
  if (present.has("education")) {
    const nextEdu = (c.education ?? []).filter((e) => e.institution).map((e) => {
      const yrs = (e.years || "").match(/\d{4}/g) ?? [];
      return {
        institution: e.institution,
        degree: e.degree || null,
        field_of_study: e.field || null,
        start_year: yrs[0] ? Number(yrs[0]) : null,
        end_year: yrs[1] ? Number(yrs[1]) : null,
        achievements: e.achievements || null,
      };
    });
    const eduRows = await readPrev(async () => {
      const rows = await db
        .select({
          institution: schema.education.institution,
          degree: schema.education.degree,
          field_of_study: schema.education.field_of_study,
          start_year: schema.education.start_year,
          end_year: schema.education.end_year,
          achievements: schema.education.achievements,
        })
        .from(schema.education)
        .where(eq(schema.education.candidate_id, id));
      return rows.map((r) => ({ ...r }));
    }, []);
    const changed = await replaceChildren(
      db,
      "education",
      id,
      nextEdu,
      eduRows as Record<string, unknown>[],
      "education",
      putWarnings,
    );
    if (changed && !sameRows(nextEdu, eduRows as unknown[])) materialChanged = true;
  }
  if (present.has("skills")) {
    try {
      const { canon, byName, ok: skillsOk } = await skillIdMap(db, c.skills ?? []);
      let haveSelf: string[] | null = null;
      try {
        // Only self-reported links are the owner's to replace; links the
        // pipeline derived (source != "self_reported") must survive a save.
        const haveLinks = await db
          .select({
            skill_id: schema.candidateSkills.skill_id,
            source: schema.candidateSkills.source,
          })
          .from(schema.candidateSkills)
          .where(eq(schema.candidateSkills.candidate_id, id));
        const selfIds = haveLinks
          .filter((l) => (l.source ?? "self_reported") === "self_reported")
          .map((l) => l.skill_id);
        const skillIds = [...new Set(selfIds)].filter(Boolean);
        const skillDocs = skillIds.length
          ? await db
              .select({ name: schema.skills.name })
              .from(schema.skills)
              .where(inArray(schema.skills.id, skillIds))
          : [];
        haveSelf = skillDocs.map((s) => s.name.toLowerCase()).filter(Boolean).sort();
      } catch {
        haveSelf = null;
      }
      if (!skillsOk || haveSelf === null) {
        console.error("[candidates] skills read failed — skipping rewrite to protect existing links");
        putWarnings.push("skills: could not save (code SKL_SAVE)");
      } else {
        const nextNames = [...canon.map((s) => s.toLowerCase())].sort();
        const links = canon.flatMap((name) => {
          const sid = byName.get(name.toLowerCase());
          return sid ? [{ candidate_id: id, skill_id: sid, source: "self_reported" }] : [];
        });
        if (JSON.stringify(nextNames) !== JSON.stringify(haveSelf)) {
          materialChanged = true;
          const selfRows = await db
            .select({ skill_id: schema.candidateSkills.skill_id, source: schema.candidateSkills.source })
            .from(schema.candidateSkills)
            .where(eq(schema.candidateSkills.candidate_id, id));
          const staleIds = selfRows
            .filter((r) => (r.source ?? "self_reported") === "self_reported")
            .map((r) => r.skill_id);
          if (staleIds.length) {
            await db
              .delete(schema.candidateSkills)
              .where(
                and(
                  eq(schema.candidateSkills.candidate_id, id),
                  inArray(schema.candidateSkills.skill_id, staleIds),
                ),
              );
          }
          if ((c.skills ?? []).length > 0) {
            if (links.length) {
              try {
                await db.insert(schema.candidateSkills).values(links).onConflictDoNothing();
              } catch (e) {
                console.error("[candidates] skills replace failed", redactPii((e as Error).message));
                putWarnings.push("skills: could not save (code SKL_SAVE)");
              }
            } else {
              putWarnings.push("skills: some skill names were skipped");
            }
          }
        }
      }
    } catch (e) {
      console.error("[candidates] skills replace threw", redactPii((e as Error).message));
      putWarnings.push("skills: could not save (code SKL_SAVE)");
    }
  }

  if (materialChanged) {
    try {
      await db
        .update(schema.candidates)
        .set({ updated_at: new Date().toISOString() })
        .where(eq(schema.candidates.id, id));
    } catch {
    }
    await enqueuePipeline(id);
  }

  return Response.json({ candidateId: id, status: "processing", warnings: putWarnings });
}

export async function DELETE(request: Request) {
  const rl = await rateLimit(request, { key: "candidates-delete", limit: 10, windowMs: 10 * 60_000 });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs);
  const url = new URL(request.url);
  let body: unknown = null;
  {
    const ct = request.headers.get("content-type") ?? "";
    if (ct.toLowerCase().includes("application/json")) {
      const read = await readJsonBody(request, JSON_LIMITS["candidates-delete"]);
      if (!read.ok) return read.response;
      body = read.body;
    }
  }
  const id = url.searchParams.get("id") ?? (body as { id?: unknown } | null)?.id ?? undefined;
  if (!uuid.safeParse(id).success) {
    return Response.json({ error: "provide ?id=<candidate uuid>" }, { status: 400 });
  }
  const denied = await guardOwnerAuth(request, id as string);
  if (denied) return denied;

  const db = await getDb();
  let doomed: {
    resume_url: string | null;
    photo_url: string | null;
    portfolio_url: string | null;
  } | null = null;
  try {
    const rows = await db
      .select({
        resume_url: schema.candidates.resume_url,
        photo_url: schema.candidates.photo_url,
        portfolio_url: schema.candidates.portfolio_url,
      })
      .from(schema.candidates)
      .where(eq(schema.candidates.id, id as string))
      .limit(1);
    doomed = rows[0] ?? null;
  } catch {
    doomed = null;
  }
  // Remove search-indexed vectors first: D1 rows cascade, Vectorize does not.
  try {
    await deleteChunksForCandidate(id as string);
  } catch (e) {
    console.error("[candidates] vector cleanup failed", redactPii((e as Error)?.message ?? String(e)));
  }
  let doomedUserId: string | null = null;
  try {
    const rows = await db
      .select({ user_id: schema.candidates.user_id })
      .from(schema.candidates)
      .where(eq(schema.candidates.id, id as string))
      .limit(1);
    doomedUserId = rows[0]?.user_id ?? null;
  } catch {
    doomedUserId = null;
  }
  try {
    await cascadeDeleteCandidate(db, id as string);
  } catch {
    console.error("[candidates] delete failed");
    return Response.json({ error: "candidate delete failed" }, { status: 500 });
  }
  // Revoke any live sessions for the deleted profile's account.
  if (doomedUserId) {
    try {
      await db.delete(schema.sessions).where(eq(schema.sessions.user_id, doomedUserId));
    } catch {
    }
  }
  try {
    const jobs: Promise<void>[] = [];
    if (doomed?.resume_url && !/^https?:\/\//i.test(doomed.resume_url)) {
      jobs.push(deleteObject("resumes", doomed.resume_url));
    }
    if (doomed?.photo_url && !/^https?:\/\//i.test(doomed.photo_url)) {
      jobs.push(deleteObject("photos", doomed.photo_url));
    }
    if (doomed?.portfolio_url && !/^https?:\/\//i.test(doomed.portfolio_url)) {
      jobs.push(deleteObject("portfolios", doomed.portfolio_url));
    }
    if (jobs.length) await Promise.all(jobs);
  } catch {
  }
  return Response.json({ ok: true });
}
