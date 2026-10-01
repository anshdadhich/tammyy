import { randomUUID } from "crypto";
import { z } from "zod";
import { inngest } from "@/lib/inngest";
import { AppDoc, col, Collections } from "@/lib/mongo";
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

function isMissingColumnErr(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { message?: string; code?: unknown };
  if (e.code === "PGRST204") return true;
  return /could not find the|column .* does not exist/i.test(e.message ?? "");
}

function isDuplicateKey(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === 11000;
}

function stripShowFlags(obj: Record<string, unknown>): Record<string, unknown> {
  const out = { ...obj };
  for (const f of SHOW_FLAGS) delete out[f];
  return out;
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

function verifyCaptchaHook(raw: unknown): boolean {
  if (process.env.CAPTCHA_REQUIRED === "1" || process.env.TURNSTILE_REQUIRED === "1") {
    const r = (raw ?? {}) as Record<string, unknown>;
    const token = r.captchaToken ?? r.turnstileToken ?? r["cf-turnstile-response"];
    if (typeof token !== "string" || token.trim().length < 8) return false;
  }
  return true;
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
 * Mongo throws where Supabase returned `{ error }`. The old GET ignored
 * child-read errors (`data` came back null → empty lists), so keep that
 * contract: log, fall back, never fail the response.
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
 * Postgres ON DELETE CASCADE for candidates(id) — Mongo needs it manual.
 * Children first so a failed cascade leaves the candidate row in place
 * (retryable), then the candidate itself.
 */
async function cascadeDeleteCandidate(candidateId: string): Promise<void> {
  const [
    candidates,
    profiles,
    workExperiences,
    projects,
    education,
    candidateSkills,
    profileChunks,
    oss,
    depths,
    matches,
    shortlists,
    contactLog,
  ] = await Promise.all([
    col<AppDoc>(Collections.candidates),
    col<AppDoc>(Collections.candidateProfiles),
    col<AppDoc>(Collections.workExperiences),
    col<AppDoc>(Collections.projects),
    col<AppDoc>(Collections.education),
    col<AppDoc>(Collections.candidateSkills),
    col<AppDoc>(Collections.profileChunks),
    col<AppDoc>(Collections.openSourceContributions),
    col<AppDoc>(Collections.projectDepthAnalysis),
    col<AppDoc>(Collections.candidateMatches),
    col<AppDoc>(Collections.shortlists),
    col<AppDoc>(Collections.contactLog),
  ]);
  const projIds = (
    await projects.find({ candidate_id: candidateId }, { projection: { _id: 1 } }).toArray()
  ).map((p) => p._id);

  await Promise.all([
    profiles.deleteMany({ candidate_id: candidateId }),
    workExperiences.deleteMany({ candidate_id: candidateId }),
    projects.deleteMany({ candidate_id: candidateId }),
    education.deleteMany({ candidate_id: candidateId }),
    candidateSkills.deleteMany({ candidate_id: candidateId }),
    profileChunks.deleteMany({ candidate_id: candidateId }),
    oss.deleteMany({ candidate_id: candidateId }),
    matches.deleteMany({ candidate_id: candidateId }),
    shortlists.deleteMany({ candidate_id: candidateId }),
    contactLog.deleteMany({ candidate_id: candidateId }),
    ...(projIds.length ? [depths.deleteMany({ project_id: { $in: projIds } })] : []),
  ]);
  await candidates.deleteOne({ _id: candidateId });
}

export async function GET(request: Request) {
  const rl = rateLimit(request, { key: "candidates-get", limit: 120, windowMs: 60_000 });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs);
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? undefined;
  if (!id) {
    return Response.json({ error: "provide ?id=<candidate uuid>" }, { status: 400 });
  }
  const session = await getSessionUser();
  const viewer = session?.viewer ?? { kind: "anon" };
  if (!uuid.safeParse(id).success) {
    return Response.json({ error: "id must be a valid UUID" }, { status: 400 });
  }

  const raw = await safeRead(
    async () => (await col<AppDoc>(Collections.candidates)).findOne({ _id: id }),
    null,
  );
  if (!raw) return Response.json({ error: "candidate not found" }, { status: 404 });
  const { _id, ...candidateRest } = raw;
  const candidate: Record<string, unknown> = { ...candidateRest, id: _id };
  const cid = _id;

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
          await (
            await col<AppDoc>(Collections.searches)
          ).find({ employer_id: hrEmployerId }, { projection: { _id: 1 } })
            .limit(2000)
            .toArray()
        ),
      [],
    );
    ownSearchIds = ownSearches.map((s) => s._id);
  }

  const contactLogQuery = async (): Promise<Record<string, unknown>[]> => {
    const filter: Record<string, unknown> = { candidate_id: cid };
    if (!isOwnerVerified && hrEmployerId) filter.employer_id = hrEmployerId;
    const rows = await (
      await col<AppDoc>(Collections.contactLog)
    )
      .find(filter, {
        projection: { channel: 1, message: 1, job_id: 1, employer_id: 1, created_at: 1 },
      })
      .sort({ created_at: -1 })
      .limit(50)
      .toArray();
    return rows.map((r) => ({
      id: r._id,
      channel: r.channel ?? null,
      message: r.message ?? null,
      job_id: r.job_id ?? null,
      employer_id: r.employer_id ?? null,
      created_at: r.created_at ?? null,
    }));
  };
  const matchesQuery = async (): Promise<Record<string, unknown>[]> => {
    const filter: Record<string, unknown> = { candidate_id: cid };
    if (!isOwnerVerified && ownSearchIds) {
      filter.search_id = {
        $in: ownSearchIds.length
          ? ownSearchIds
          : ["00000000-0000-0000-0000-000000000000"],
      };
    }
    const rows = await (
      await col<AppDoc>(Collections.candidateMatches)
    )
      .find(filter, { projection: { search_id: 1, job_id: 1, score: 1, status: 1, created_at: 1 } })
      .sort({ created_at: -1 })
      .limit(50)
      .toArray();
    return rows.map((r) => ({
      id: r._id,
      search_id: r.search_id ?? null,
      job_id: r.job_id ?? null,
      score: r.score ?? null,
      status: r.status ?? null,
      created_at: r.created_at ?? null,
    }));
  };
  const shortlistsQuery = async (): Promise<Record<string, unknown>[]> => {
    const filter: Record<string, unknown> = { candidate_id: cid };
    if (!isOwnerVerified && hrEmployerId) filter.employer_id = hrEmployerId;
    const rows = await (
      await col<AppDoc>(Collections.shortlists)
    )
      .find(filter, { projection: { job_id: 1, status: 1, notes: 1, created_at: 1 } })
      .sort({ created_at: -1 })
      .limit(50)
      .toArray();
    return rows.map((r) => ({
      id: r._id,
      job_id: r.job_id ?? null,
      status: r.status ?? null,
      notes: r.notes ?? null,
      created_at: r.created_at ?? null,
    }));
  };

  const profileP = safeRead<Record<string, unknown> | null>(async () => {
    const r = await (
      await col<AppDoc>(Collections.candidateProfiles)
    ).findOne(
      { candidate_id: cid },
      { projection: { summary_markdown: 1, summary_json: 1, updated_at: 1, _id: 0 } },
    );
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
    const rows = await (
      await col<AppDoc>(Collections.projects)
    )
      .find(
        { candidate_id: cid },
        {
          projection: {
            title: 1,
            description: 1,
            problem_statement: 1,
            tech_stack: 1,
            role_in_project: 1,
            project_link: 1,
            repo_link: 1,
            deployment_link: 1,
            impact_summary: 1,
            project_type: 1,
          },
        },
      )
      .toArray();
    return rows.map((r) => ({
      id: r._id,
      title: r.title ?? null,
      description: r.description ?? null,
      problem_statement: r.problem_statement ?? null,
      tech_stack: r.tech_stack ?? [],
      role_in_project: r.role_in_project ?? null,
      project_link: r.project_link ?? null,
      repo_link: r.repo_link ?? null,
      deployment_link: r.deployment_link ?? null,
      impact_summary: r.impact_summary ?? null,
      project_type: r.project_type ?? null,
    }));
  }, []);
  const experiencesP = safeRead<Record<string, unknown>[]>(async () => {
    const rows = await (
      await col<AppDoc>(Collections.workExperiences)
    )
      .find(
        { candidate_id: cid },
        {
          projection: {
            company_name: 1,
            job_title: 1,
            start_date: 1,
            end_date: 1,
            is_current: 1,
            description: 1,
            achievements: 1,
            tech_stack: 1,
            _id: 0,
          },
        },
      )
      .toArray();
    return rows.map((r) => ({
      company_name: r.company_name ?? null,
      job_title: r.job_title ?? null,
      start_date: r.start_date ?? null,
      end_date: r.end_date ?? null,
      is_current: r.is_current ?? false,
      description: r.description ?? null,
      achievements: r.achievements ?? null,
      tech_stack: r.tech_stack ?? [],
    }));
  }, []);
  const educationP = safeRead<Record<string, unknown>[]>(async () => {
    const rows = await (
      await col<AppDoc>(Collections.education)
    )
      .find(
        { candidate_id: cid },
        {
          projection: {
            institution: 1,
            degree: 1,
            field_of_study: 1,
            start_year: 1,
            end_year: 1,
            achievements: 1,
            _id: 0,
          },
        },
      )
      .toArray();
    return rows.map((r) => ({
      institution: r.institution ?? null,
      degree: r.degree ?? null,
      field_of_study: r.field_of_study ?? null,
      start_year: r.start_year ?? null,
      end_year: r.end_year ?? null,
      achievements: r.achievements ?? null,
    }));
  }, []);
  const skillRowsP = safeRead<Record<string, unknown>[]>(async () => {
    const linkRows = await (
      await col<AppDoc>(Collections.candidateSkills)
    )
      .find(
        { candidate_id: cid },
        {
          projection: {
            skill_id: 1,
            experience_years: 1,
            proficiency_level: 1,
            source: 1,
            _id: 0,
          },
        },
      )
      .toArray();
    const skillIds = [
      ...new Set(linkRows.map((r) => String(r.skill_id ?? "")).filter(Boolean)),
    ];
    const skillDocs = skillIds.length
      ? await (
          await col<AppDoc>(Collections.skills)
        )
          .find({ _id: { $in: skillIds } }, { projection: { name: 1 } })
          .toArray()
      : [];
    const nameById = new Map(skillDocs.map((s) => [s._id, String(s.name ?? "")]));
    return linkRows.map((r) => ({
      experience_years: r.experience_years ?? null,
      proficiency_level: r.proficiency_level ?? null,
      source: r.source ?? null,
      skills: { name: nameById.get(String(r.skill_id)) ?? null },
    }));
  }, []);
  const ossP = safeRead<Record<string, unknown>[]>(async () => {
    const rows = await (
      await col<AppDoc>(Collections.openSourceContributions)
    )
      .find(
        { candidate_id: cid },
        {
          projection: {
            repo_name: 1,
            repo_url: 1,
            description: 1,
            pr_links: 1,
            tech_stack: 1,
            role: 1,
          },
        },
      )
      .toArray();
    return rows.map((r) => ({
      id: r._id,
      repo_name: r.repo_name ?? null,
      repo_url: r.repo_url ?? null,
      description: r.description ?? null,
      pr_links: r.pr_links ?? [],
      tech_stack: r.tech_stack ?? [],
      role: r.role ?? null,
    }));
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
          await col<AppDoc>(Collections.projectDepthAnalysis)
        )
          .find(
            { project_id: { $in: projIds } },
            {
              projection: {
                project_id: 1,
                complexity_score: 1,
                technical_complexity: 1,
                architectural_concepts: 1,
                autonomy_level: 1,
                evidence_quality: 1,
                estimated_seniority_signal: 1,
                business_impact: 1,
                project_maturity: 1,
                _id: 0,
              },
            },
          )
          .toArray(),
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

async function restoreRows(
  table: string,
  candidateId: string,
  prev: unknown[],
  label: string,
): Promise<void> {
  try {
    const rows = (prev as Record<string, unknown>[]).map((r) => ({
      _id: randomUUID(),
      candidate_id: candidateId,
      ...r,
    }));
    if (!rows.length) return;
    const c = await col<AppDoc>(table);
    await c.insertMany(rows);
  } catch (e) {
    console.error(`[candidates] ${label} restore failed`, redactPii((e as Error)?.message ?? String(e)).slice(0, 200));
  }
}

async function skillIdMap(
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
  const skills = await col<AppDoc>(Collections.skills);
  try {
    // onConflict "name" + ignoreDuplicates → insert-if-absent per name.
    await skills.bulkWrite(
      canon.map((name) => ({
        updateOne: {
          filter: { name },
          update: {
            $setOnInsert: {
              _id: randomUUID(),
              name,
              aliases: [],
              created_at: new Date(),
            },
          },
          upsert: true,
        },
      })),
    );
  } catch {
  }
  try {
    const data = await skills
      .find({ name: { $in: canon } }, { projection: { _id: 1, name: 1 } })
      .toArray();
    for (const s of data) {
      byName.set(String(s.name).toLowerCase(), s._id);
    }
  } catch {
    return { canon, byName, ok: false };
  }
  return { canon, byName, ok: true };
}

export async function POST(request: Request) {
  const rl = rateLimit(request, { key: "candidates-post", limit: 10, windowMs: 10 * 60_000 });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs);
  const read = await readJsonBody(request, JSON_LIMITS["candidates-post"]);
  if (!read.ok) return read.response;
  const rawBody = read.body;
  if (honeypotTripped(rawBody)) {
    return Response.json({ error: "submission rejected" }, { status: 400 });
  }
  if (!verifyCaptchaHook(rawBody)) {
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
  const candidates = await col<AppDoc>(Collections.candidates);

  try {
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await candidates
      .find({ contact_email: email, created_at: { $gt: windowStart } }, { projection: { _id: 1, created_at: 1 } })
      .sort({ created_at: -1 })
      .limit(5)
      .toArray();
    const rows = recent.map((r) => ({ id: r._id, created_at: r.created_at }));
    if (rows.length >= 3) {
      return Response.json({ error: "Too many submissions for this email. Try again later." }, { status: 429 });
    }
    const newest = rows[0];
    if (newest && Date.now() - new Date(newest.created_at as string | Date).getTime() < 10 * 60 * 1000) {
      return Response.json(
        { error: "A submission for this email is already pending.", candidateId: newest.id },
        { status: 429 },
      );
    }
  } catch {
  }

  let dupe: { _id: string } | null = null;
  try {
    dupe = await candidates.findOne({ contact_email: email }, { projection: { _id: 1 } });
  } catch {
    dupe = null;
  }
  if (dupe?._id) {
    return Response.json(
      { error: "A profile already exists for this email.", candidateId: dupe._id },
      { status: 409 },
    );
  }

  let userId: string | null = null;
  let createdUser = false;
  const users = await col<AppDoc>(Collections.users);
  try {
    const existing = await users.findOne({ email }, { projection: { _id: 1 } });
    if (existing) {
      userId = existing._id;
    } else {
      const res = await users.insertOne({
        _id: randomUUID(),
        email,
        role: "candidate",
        status: "active",
        email_verified: false,
        created_at: new Date(),
      });
      userId = res.insertedId;
      createdUser = true;
    }
  } catch (e) {
    console.error("[candidates] user create failed", redactPii((e as Error)?.message ?? String(e)).slice(0, 200));
    return Response.json({ error: "user create failed" }, { status: 500 });
  }

  const remoteMap: Record<string, string> = { remote: "remote_only", hybrid: "hybrid", onsite: "onsite" };
  const avail = /immedi/i.test(c.availability ?? "") ? "immediate" : /inactive/i.test(c.availability ?? "") ? "inactive" : "notice";
  const row: Record<string, unknown> = {
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
    visibility_status: "hidden",
    consent_status: "pending",
    ...(c.show_email !== undefined ? { show_email: c.show_email } : {}),
    ...(c.show_phone !== undefined ? { show_phone: c.show_phone } : {}),
    ...(c.show_linkedin !== undefined ? { show_linkedin: c.show_linkedin } : {}),
    ...(c.show_github !== undefined ? { show_github: c.show_github } : {}),
    ...(c.show_resume !== undefined ? { show_resume: c.show_resume } : {}),
    ...(c.show_portfolio !== undefined ? { show_portfolio: c.show_portfolio } : {}),
    ...(c.show_photo !== undefined ? { show_photo: c.show_photo } : {}),
    contact_email: email,
    contact_phone: c.phone || null,
    github_url: c.links?.github || null,
    linkedin_url: c.links?.linkedin || null,
    portfolio_url: c.links?.portfolio || null,
    resume_url: c.links?.resume_url || null,
    photo_url: c.photo_url || null,
    profile_strength: null,
    freshness_updated_at: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
  };
  const candidateId = randomUUID();
  try {
    await candidates.insertOne({ _id: candidateId, ...row });
  } catch (e) {
    if (isMissingColumnErr(e)) {
      // Parity with the old schema-drift fallback (Mongo stores any field).
      try {
        await candidates.insertOne({ _id: candidateId, ...stripShowFlags(row) });
      } catch {
        console.error("[candidates] create failed");
        return Response.json({ error: "candidate create failed" }, { status: 500 });
      }
    } else {
      console.error("[candidates] create failed");
      return Response.json({ error: "candidate create failed" }, { status: 500 });
    }
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
      const workExperiences = await col<AppDoc>(Collections.workExperiences);
      await workExperiences.insertMany(
        c.experiences.map((x) => ({
          _id: randomUUID(),
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
          created_at: new Date(),
        })),
      );
    }
  } catch (e) {
    console.error("[candidates] experience insert threw", redactPii((e as Error).message));
    warnings.push("experience: could not save (code EXP_SAVE)");
  }
  try {
    if (c.projects?.length) {
      const projectsCol = await col<AppDoc>(Collections.projects);
      await projectsCol.insertMany(
        c.projects.map((p) => ({
          _id: randomUUID(),
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
          start_date: null,
          end_date: null,
          created_at: new Date(),
        })),
      );
    }
  } catch (e) {
    console.error("[candidates] projects insert threw", redactPii((e as Error).message));
    warnings.push("projects: could not save (code PRJ_SAVE)");
  }
  try {
    if (c.oss?.length) {
      const ossCol = await col<AppDoc>(Collections.openSourceContributions);
      const ossRows = c.oss
        .filter((o) => o.repo_name?.trim())
        .map((o) => ({
          _id: randomUUID(),
          candidate_id: candidateId,
          repo_name: o.repo_name.trim(),
          repo_url: o.repo_url || null,
          description: o.description || null,
          pr_links: (o.pr_links ?? []).filter((u) => u && u.trim()),
          tech_stack: cleanTech(o.tech),
          role: o.role || "Contributor",
          created_at: new Date(),
        }));
      if (ossRows.length) await ossCol.insertMany(ossRows);
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
          _id: randomUUID(),
          candidate_id: candidateId,
          institution: e.institution,
          degree: e.degree || null,
          field_of_study: e.field || null,
          start_year: yrs[0] ? Number(yrs[0]) : null,
          end_year: yrs[1] ? Number(yrs[1]) : null,
          achievements: e.achievements || null,
        };
      });
      if (rows.length) {
        const educationCol = await col<AppDoc>(Collections.education);
        await educationCol.insertMany(rows);
      }
    }
  } catch (e) {
    console.error("[candidates] education insert threw", redactPii((e as Error).message));
    warnings.push("education: could not save (code EDU_SAVE)");
  }
  try {
    if (c.skills?.length) {
      const { canon, byName } = await skillIdMap(c.skills);
      const links = canon.flatMap((name) => {
        const id = byName.get(name.toLowerCase());
        return id ? [{ candidate_id: candidateId, skill_id: id, source: "self_reported" }] : [];
      });
      if (links.length) {
        const candidateSkills = await col<AppDoc>(Collections.candidateSkills);
        await candidateSkills.bulkWrite(
          links.map((l) => ({
            updateOne: {
              filter: { candidate_id: l.candidate_id, skill_id: l.skill_id },
              update: { $set: { candidate_id: l.candidate_id, skill_id: l.skill_id, source: l.source } },
              upsert: true,
            },
          })),
        );
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
        await cascadeDeleteCandidate(candidateId);
      }
      if (createdUser && userId) {
        await users.deleteOne({ _id: userId });
      }
    } catch {
      console.error("[candidates] rollback failed — manual cleanup needed", redactPii(candidateId ?? ""));
      return Response.json({ error: "Could not save the profile and rollback failed. Contact support." }, { status: 500 });
    }
    return Response.json({ error: "Could not save the profile. Fix the highlighted fields and retry." }, { status: 500 });
  }

  try {
    await inngest.send({ name: "candidate.profile.submitted", data: { candidateId } });
  } catch (e) {
    console.error("[candidates] pipeline enqueue failed", redactPii((e as Error)?.message ?? String(e)).slice(0, 200));
  }

  return Response.json({ candidateId, status: "processing", warnings }, { status: 202 });
}

export async function PATCH(request: Request) {
  const rl = rateLimit(request, { key: "candidates-patch", limit: 30, windowMs: 60_000 });
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
    const candidates = db.collection<AppDoc>(Collections.candidates);
    const res = await candidates.updateOne(
      { _id: parsed.data.id },
      { $set: { visibility_status: parsed.data.visibility_status, updated_at: new Date() } },
    );
    if (!res.matchedCount) {
      return Response.json({ error: "candidate not found" }, { status: 404 });
    }
    const row = await candidates.findOne(
      { _id: parsed.data.id },
      { projection: { visibility_status: 1, _id: 1 } },
    );
    if (!row) return Response.json({ error: "candidate not found" }, { status: 404 });
    return Response.json({ candidate: { id: row._id, visibility_status: row.visibility_status } });
  } catch {
    // Old code surfaced update/read errors as a null maybeSingle → 404.
    return Response.json({ error: "candidate not found" }, { status: 404 });
  }
}

export async function PUT(request: Request) {
  const rl = rateLimit(request, { key: "candidates-put", limit: 20, windowMs: 60_000 });
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
  const candidates = await col<AppDoc>(Collections.candidates);
  let existing: { _id: string; user_id: string; contact_email: string } | null = null;
  try {
    existing = (await candidates.findOne(
      { _id: id },
      { projection: { user_id: 1, contact_email: 1 } },
    )) as { _id: string; user_id: string; contact_email: string } | null;
  } catch {
    existing = null;
  }
  if (!existing) return Response.json({ error: "candidate not found" }, { status: 404 });
  const prev = existing;
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
  for (const flag of [
    "show_email",
    "show_phone",
    "show_linkedin",
    "show_github",
    "show_resume",
    "show_portfolio",
    "show_photo",
  ] as const) {
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
      const users = await col<AppDoc>(Collections.users);
      let clash: { _id: string } | null = null;
      try {
        clash = await users.findOne({ email }, { projection: { _id: 1 } });
      } catch {
        clash = null;
      }
      if (clash?._id) {
        return Response.json(
          { error: "That email is already in use. Verify ownership first." },
          { status: 409 },
        );
      }
      // Mongo `users` is the single identity row (no separate auth store):
      // updating email here is the whole change — OTPs and logins read it.
      try {
        await users.updateOne({ _id: prev.user_id }, { $set: { email } });
      } catch (e) {
        const msg = (e as Error)?.message ?? "";
        if (isDuplicateKey(e) || /already|exists|taken|duplicate/i.test(msg)) {
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
      await candidates.updateOne({ _id: id }, { $set: { ...patch, updated_at: new Date() } });
    } catch (e) {
      if (isMissingColumnErr(e)) {
        // Parity with the old schema-drift fallback (Mongo stores any field).
        try {
          await candidates.updateOne({ _id: id }, { $set: { ...stripShowFlags(patch), updated_at: new Date() } });
        } catch {
          console.error("[candidates] update failed", redactPii(id));
          return Response.json({ error: "candidate update failed" }, { status: 500 });
        }
      } else {
        console.error("[candidates] update failed", redactPii(id));
        return Response.json({ error: "candidate update failed" }, { status: 500 });
      }
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
  if (present.has("experiences")) {
    try {
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
      const workExperiences = await col<AppDoc>(Collections.workExperiences);
      const expRows = await workExperiences
        .find(
          { candidate_id: id },
          {
            projection: {
              company_name: 1,
              job_title: 1,
              start_date: 1,
              end_date: 1,
              is_current: 1,
              description: 1,
              achievements: 1,
              tech_stack: 1,
              _id: 0,
            },
          },
        )
        .toArray();
      if (!sameRows(nextExp, expRows as unknown[])) {
        materialChanged = true;
        await workExperiences.deleteMany({ candidate_id: id });
        if (nextExp.length) {
          try {
            await workExperiences.insertMany(nextExp.map((r) => ({ _id: randomUUID(), candidate_id: id, ...r })));
          } catch (e) {
            console.error("[candidates] experience replace failed", redactPii((e as Error).message));
            putWarnings.push("experience: could not save (code EXP_SAVE)");
            await restoreRows(Collections.workExperiences, id, expRows as unknown[], "experience");
          }
        }
      }
    } catch (e) {
      console.error("[candidates] experience replace threw", redactPii((e as Error).message));
      putWarnings.push("experience: could not save (code EXP_SAVE)");
    }
  }
  if (present.has("projects")) {
    try {
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
      const projectsCol = await col<AppDoc>(Collections.projects);
      const projRows = await projectsCol
        .find(
          { candidate_id: id },
          {
            projection: {
              title: 1,
              description: 1,
              problem_statement: 1,
              tech_stack: 1,
              role_in_project: 1,
              project_link: 1,
              repo_link: 1,
              deployment_link: 1,
              impact_summary: 1,
              project_type: 1,
              _id: 0,
            },
          },
        )
        .toArray();
      if (!sameRows(nextProj, projRows as unknown[])) {
        materialChanged = true;
        await projectsCol.deleteMany({ candidate_id: id });
        if (nextProj.length) {
          try {
            await projectsCol.insertMany(nextProj.map((r) => ({ _id: randomUUID(), candidate_id: id, ...r })));
          } catch (e) {
            console.error("[candidates] projects replace failed", redactPii((e as Error).message));
            putWarnings.push("projects: could not save (code PRJ_SAVE)");
            await restoreRows(Collections.projects, id, projRows as unknown[], "projects");
          }
        }
      }
    } catch (e) {
      console.error("[candidates] projects replace threw", redactPii((e as Error).message));
      putWarnings.push("projects: could not save (code PRJ_SAVE)");
    }
  }
  if (present.has("oss")) {
    try {
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
      const ossCol = await col<AppDoc>(Collections.openSourceContributions);
      const ossRows = await ossCol
        .find(
          { candidate_id: id },
          {
            projection: {
              repo_name: 1,
              repo_url: 1,
              description: 1,
              pr_links: 1,
              tech_stack: 1,
              role: 1,
              _id: 0,
            },
          },
        )
        .toArray();
      if (!sameRows(nextOss, ossRows as unknown[])) {
        materialChanged = true;
        await ossCol.deleteMany({ candidate_id: id });
        if (nextOss.length) {
          try {
            await ossCol.insertMany(nextOss.map((r) => ({ _id: randomUUID(), candidate_id: id, ...r })));
          } catch (e) {
            console.error("[candidates] oss replace failed", redactPii((e as Error).message));
            putWarnings.push("open source: could not save (code OSS_SAVE)");
            await restoreRows(Collections.openSourceContributions, id, ossRows as unknown[], "oss");
          }
        }
      }
    } catch (e) {
      console.error("[candidates] oss replace threw", redactPii((e as Error).message));
      putWarnings.push("open source: could not save (code OSS_SAVE)");
    }
  }
  if (present.has("education")) {
    try {
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
      const educationCol = await col<AppDoc>(Collections.education);
      const eduRows = await educationCol
        .find(
          { candidate_id: id },
          {
            projection: {
              institution: 1,
              degree: 1,
              field_of_study: 1,
              start_year: 1,
              end_year: 1,
              achievements: 1,
              _id: 0,
            },
          },
        )
        .toArray();
      if (!sameRows(nextEdu, eduRows as unknown[])) {
        materialChanged = true;
        await educationCol.deleteMany({ candidate_id: id });
        if (nextEdu.length) {
          try {
            await educationCol.insertMany(nextEdu.map((r) => ({ _id: randomUUID(), candidate_id: id, ...r })));
          } catch (e) {
            console.error("[candidates] education replace failed", redactPii((e as Error).message));
            putWarnings.push("education: could not save (code EDU_SAVE)");
            await restoreRows(Collections.education, id, eduRows as unknown[], "education");
          }
        }
      }
    } catch (e) {
      console.error("[candidates] education replace threw", redactPii((e as Error).message));
      putWarnings.push("education: could not save (code EDU_SAVE)");
    }
  }
  if (present.has("skills")) {
    try {
      const { canon, byName, ok: skillsOk } = await skillIdMap(c.skills ?? []);
      const nextNames = [...canon.map((s) => s.toLowerCase())].sort();
      const candidateSkills = await col<AppDoc>(Collections.candidateSkills);
      const skillsCol = await col<AppDoc>(Collections.skills);
      let haveNames: string[] | null = null;
      try {
        const haveLinks = await candidateSkills
          .find({ candidate_id: id }, { projection: { skill_id: 1, _id: 0 } })
          .toArray();
        const skillIds = [...new Set(haveLinks.map((r) => String(r.skill_id ?? "")))].filter(Boolean);
        const skillDocs = skillIds.length
          ? await skillsCol.find({ _id: { $in: skillIds } }, { projection: { name: 1 } }).toArray()
          : [];
        haveNames = skillDocs
          .map((s) => String(s.name ?? "").toLowerCase())
          .filter(Boolean)
          .sort();
      } catch {
        haveNames = null;
      }
      if (!skillsOk || haveNames === null) {
        console.error("[candidates] skills read failed — skipping rewrite to protect existing links");
        putWarnings.push("skills: could not save (code SKL_SAVE)");
      } else {
        const links = canon.flatMap((name) => {
          const sid = byName.get(name.toLowerCase());
          return sid ? [{ candidate_id: id, skill_id: sid, source: "self_reported" }] : [];
        });
        if (!(links.length > 0 && JSON.stringify(nextNames) === JSON.stringify(haveNames))) {
          materialChanged = true;
          await candidateSkills.deleteMany({ candidate_id: id });
          if ((c.skills ?? []).length > 0) {
            if (links.length) {
              try {
                await candidateSkills.bulkWrite(
                  links.map((l) => ({
                    updateOne: {
                      filter: { candidate_id: l.candidate_id, skill_id: l.skill_id },
                      update: { $set: { candidate_id: l.candidate_id, skill_id: l.skill_id, source: l.source } },
                      upsert: true,
                    },
                  })),
                );
              } catch (e) {
                console.error("[candidates] skills replace failed", redactPii((e as Error).message));
                putWarnings.push("skills: could not save (code SKL_SAVE)");
                const prevLinks = haveNames.flatMap((name) => {
                  const sid = byName.get(name);
                  return sid ? [{ candidate_id: id, skill_id: sid, source: "self_reported" }] : [];
                });
                if (prevLinks.length) {
                  try {
                    await candidateSkills.bulkWrite(
                      prevLinks.map((l) => ({
                        updateOne: {
                          filter: { candidate_id: l.candidate_id, skill_id: l.skill_id },
                          update: { $set: { candidate_id: l.candidate_id, skill_id: l.skill_id, source: l.source } },
                          upsert: true,
                        },
                      })),
                    );
                  } catch {
                  }
                }
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
      await candidates.updateOne({ _id: id }, { $set: { updated_at: new Date() } });
    } catch {
    }
    try {
      await inngest.send({ name: "candidate.profile.submitted", data: { candidateId: id } });
    } catch (e) {
      console.error("[candidates] pipeline enqueue failed", redactPii((e as Error)?.message ?? String(e)).slice(0, 200));
    }
  }

  return Response.json({ candidateId: id, status: "processing", warnings: putWarnings });
}

export async function DELETE(request: Request) {
  const rl = rateLimit(request, { key: "candidates-delete", limit: 10, windowMs: 10 * 60_000 });
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

  let doomed: Record<string, unknown> | null = null;
  try {
    doomed = await (await col<AppDoc>(Collections.candidates)).findOne(
      { _id: id as string },
      { projection: { resume_url: 1, photo_url: 1, portfolio_url: 1, _id: 0 } },
    );
  } catch {
    doomed = null;
  }
  try {
    await cascadeDeleteCandidate(id as string);
  } catch {
    console.error("[candidates] delete failed");
    return Response.json({ error: "candidate delete failed" }, { status: 500 });
  }
  try {
    const paths = doomed as { resume_url?: string | null; photo_url?: string | null; portfolio_url?: string | null } | null;
    const jobs: Promise<void>[] = [];
    if (paths?.resume_url && !/^https?:\/\//i.test(paths.resume_url)) {
      jobs.push(deleteObject("resumes", paths.resume_url));
    }
    if (paths?.photo_url && !/^https?:\/\//i.test(paths.photo_url)) {
      jobs.push(deleteObject("photos", paths.photo_url));
    }
    if (paths?.portfolio_url && !/^https?:\/\//i.test(paths.portfolio_url)) {
      jobs.push(deleteObject("portfolios", paths.portfolio_url));
    }
    if (jobs.length) await Promise.all(jobs);
  } catch {
  }
  return Response.json({ ok: true });
}
