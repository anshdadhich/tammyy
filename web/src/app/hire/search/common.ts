import { matchLevel, type SubScores } from "@/lib/scoring-live";

export type MatchLevelValue = "strong" | "partial" | "weak";

export type EvidencePoint = {
  claim?: string;
  evidence?: string;
  confidence?: "high" | "medium" | "low" | string;
};

export type InterviewQuestionInfo = {
  question?: string;
  why_ask?: string;
  follow_ups?: string[];
};

export type JudgeInfo = {
  overall_score?: number;
  match_level?: string;
  matched_requirements?: string[];
  missing_requirements?: string[];
  project_evidence?: string[];
  strengths?: (EvidencePoint | string)[];
  gaps?: (EvidencePoint | string)[];
  risk_factors?: (EvidencePoint | string)[];
  recommendation?: string;
  verdict?: string;
  interview_questions?: (InterviewQuestionInfo | string)[];
};

export type WorkExperienceRow = {
  company_name?: string;
  job_title?: string;
  start_date?: string;
  end_date?: string;
  is_current?: boolean;
  description?: string;
  achievements?: string;
  tech_stack?: string[];
};

export type ProjectRow = {
  title?: string;
  description?: string;
  problem_statement?: string;
  tech_stack?: string[];
  role_in_project?: string;
  project_link?: string;
  repo_link?: string;
  deployment_link?: string;
  impact_summary?: string;
  project_type?: string;
};

export type EducationRow = {
  institution?: string;
  degree?: string;
  field_of_study?: string;
  start_year?: number | string;
  end_year?: number | string;
  achievements?: string;
};

export type OpenSourceRow = {
  repo_name?: string;
  repo_url?: string;
  description?: string;
  pr_links?: string[];
  tech_stack?: string[];
  role?: string;
};

export type SearchRow = {
  id: string;
  full_name?: string | null;
  headline?: string | null;
  domain?: string | null;
  total_experience_years?: number | null;
  location_city?: string | null;
  remote_preference?: string | null;
  availability_status?: string | null;
  min_salary?: number | null;
  salary_frequency?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  linkedin_url?: string | null;
  github_url?: string | null;
  resume_url?: string | null;
  portfolio_url?: string | null;
  contact_locked?: boolean;
  overall_score?: number | null;
  match_level?: string | null;
  sub_scores?: Partial<SubScores> | null;
  judge?: JudgeInfo | null;
  top_skills?: string[] | null;
  work_experiences?: WorkExperienceRow[];
  projects?: ProjectRow[];
  education?: EducationRow[];
  open_source_contributions?: OpenSourceRow[];
};

export type SearchRun = {
  id: string;
  title: string;
  time: string;
  deep: boolean;
  note?: string;
  /** True when retrieval/embedding failed and results are a fallback set. */
  degraded?: boolean;
  results: SearchRow[];
};

export type SessionInfo = {
  email: string;
  name?: string;
  employerStatus?: "verified" | "pending" | "none";
};

export type View = "compose" | "searching" | "results" | "detail";

export function apiError(json: unknown): string {
  const j = json as {
    error?: unknown;
    errors?: { fieldErrors?: Record<string, unknown>; formErrors?: unknown };
  };
  if (typeof j.error === "string" && j.error) return j.error;
  const fieldErrors = j.errors?.fieldErrors;
  if (fieldErrors) {
    for (const value of Object.values(fieldErrors)) {
      if (Array.isArray(value) && typeof value[0] === "string") return value[0];
    }
  }
  const formErrors = j.errors?.formErrors;
  if (Array.isArray(formErrors) && typeof formErrors[0] === "string") return formErrors[0];
  return "Something went wrong";
}

export async function postJson(
  url: string,
  body: Record<string, unknown>,
  init?: { signal?: AbortSignal },
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: init?.signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new Error("Search timed out. Try again.");
    throw new Error("Network error");
  }
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(apiError(json));
  return json;
}

export function deriveTitle(query: string): string {
  const firstLine = query.trim().split(/\r?\n/)[0] ?? "";
  const title = (firstLine.split(" - ")[0] ?? "").split(".")[0]?.trim().slice(0, 200) ?? "";
  return title || "Role";
}

export function initials(name?: string | null): string {
  const parts = (name ?? "").trim().split(/[\s._-]+/).filter(Boolean);
  const out = parts.slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase();
  return out || "?";
}

export function levelLabel(level: MatchLevelValue): string {
  return level === "strong" ? "Strong match" : level === "partial" ? "Partial" : "Weak";
}

export function availabilityLabel(value?: string | null): string {
  if (!value) return "";
  const s = value.trim();
  if (!s) return "";
  if (/^immedi/i.test(s)) return "Available now";
  if (/notice/i.test(s)) return "On notice";
  return s;
}

export function scoreOf(row: SearchRow): number | null {
  return typeof row.overall_score === "number" ? Math.round(row.overall_score) : null;
}

export function levelOf(row: SearchRow): MatchLevelValue | null {
  if (row.match_level === "strong" || row.match_level === "partial" || row.match_level === "weak") {
    return row.match_level;
  }
  const score = scoreOf(row);
  return score != null ? matchLevel(score) : null;
}

export function subScores(row: SearchRow): Partial<Record<keyof SubScores, number>> {
  const out: Partial<Record<keyof SubScores, number>> = {};
  const source = row.sub_scores;
  if (!source) return out;
  for (const key of ["semantic", "skill", "depth", "constraints", "seniority"] as const) {
    const value = source[key];
    if (typeof value === "number") out[key] = value;
  }
  return out;
}

export function fmtMoney(value?: number | null): string {
  return typeof value === "number" ? value.toLocaleString("en-US") : "";
}

export function stackOf(row: SearchRow): string[] {
  if (!Array.isArray(row.top_skills)) return [];
  return row.top_skills.filter((s): s is string => typeof s === "string");
}
