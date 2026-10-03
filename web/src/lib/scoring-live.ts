import type { JobReq } from "@/lib/matching/types";

export interface SubScores {
  semantic: number;
  skill: number;
  depth: number;
  constraints: number;
  seniority: number;
  freshness: number;
}

export interface ScoreContext {
  skills: string[];
  skillProjects: Map<string, number>;
  depths: { complexity: number; evidence: string }[];
  minSalary: number | null;
  salaryFreq: string | null;
  totalExp: number | null;
  remotePref: string | null;
  locationCity: string | null;
  availability: string | null;
  profileStrength: number | null;
  ossContributions?: number;
  lastUpdatedIso?: string | null;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function annualize(amount: number, freq: string | null | undefined): number {
  const f = (freq ?? "").toLowerCase();
  if (f === "monthly") return amount * 12;
  if (f === "weekly") return amount * 52;
  if (f === "hourly") return amount * 2080;
  return amount;
}

export function semanticFromDistance(distance: number | null | undefined): number {
  if (distance == null || !isFinite(distance)) return 0.5;
  return clamp01(1 - distance / 1.2);
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

export function skillScore(job: JobReq, ctx: ScoreContext): number {
  const must = job.must_have_skills ?? [];
  const nice = job.nice_to_have_skills ?? [];
  if (!must.length && !nice.length) return 0.5;
  const have = new Set(ctx.skills.map(norm));
  const evidence = (s: string): number => {
    const n = ctx.skillProjects.get(norm(s)) ?? 0;
    if (n >= 2) return 1;
    if (n === 1) return 0.7;
    return have.has(norm(s)) ? 0.4 : 0;
  };
  const mustHit = must.length
    ? must.reduce((a, s) => a + evidence(s), 0) / must.length
    : 1;
  const niceHit = nice.length
    ? nice.reduce((a, s) => a + evidence(s), 0) / nice.length
    : 1;
  return clamp01(mustHit * 0.75 + niceHit * 0.25);
}

const EVIDENCE_MAP: Record<string, number> = { weak: 0.3, moderate: 0.65, strong: 1 };

export function depthScore(ctx: ScoreContext): number {
  const oss = ossScore(ctx);
  if (!ctx.depths.length) {
    // No analyzed projects — OSS evidence alone can still carry depth.
    return oss > 0 ? clamp01(0.3 * 0.6 + oss * 0.4) : 0.3;
  }
  const avg = ctx.depths.reduce((a, d) => a + clamp01(d.complexity / 10), 0) / ctx.depths.length;
  const ev = ctx.depths.reduce((a, d) => a + (EVIDENCE_MAP[d.evidence] ?? 0.5), 0) / ctx.depths.length;
  const quality = clamp01((ctx.profileStrength ?? 50) / 100);
  return clamp01(avg * 0.42 + ev * 0.3 + quality * 0.13 + oss * 0.15);
}

export function constraintsScore(job: JobReq, ctx: ScoreContext): number {
  let salary = 0.5;
  const want = ctx.minSalary != null ? annualize(ctx.minSalary, ctx.salaryFreq) : null;
  const cap = job.salary_max != null ? annualize(job.salary_max, job.salary_frequency) : null;
  if (cap != null && want != null) {
    salary = want <= cap ? 1 : want <= cap * 1.2 ? 0.4 : 0;
  } else if (want != null) salary = 0.7;
  let location = 0.5;
  const remoteOk = job.remote_allowed || ctx.remotePref === "remote_only" || ctx.remotePref === "flexible";
  if (job.remote_allowed && (ctx.remotePref === "remote_only" || ctx.remotePref === "flexible")) location = 1;
  else if (!job.location) location = 0.8;
  else if (remoteOk) location = 0.8;
  else {
    // Job is on-site and the candidate needs to be there too — score the
    // actual city match instead of a blanket pass.
    const want = (job.location ?? "").trim().toLowerCase();
    const have = (ctx.locationCity ?? "").trim().toLowerCase();
    location = want && have && have.includes(want) ? 1 : 0.2;
  }
  const avail = /inactive/i.test(ctx.availability ?? "") ? 0.15 : !ctx.availability || /immedi/i.test(ctx.availability) ? 1 : /notice/i.test(ctx.availability) ? 0.6 : 0.4;
  return clamp01(salary * 0.4 + location * 0.35 + avail * 0.25);
}

export function seniorityScore(job: JobReq, ctx: ScoreContext): number {
  if (ctx.totalExp == null) return 0.5;
  const { experience_min: lo, experience_max: hi } = job;
  if (lo == null && hi == null) return 0.7;
  if (lo != null && ctx.totalExp < lo) return clamp01(0.5 - (lo - ctx.totalExp) * 0.2);
  if (hi != null && ctx.totalExp > hi) return clamp01(0.7 - (ctx.totalExp - hi) * 0.1);
  return 1;
}

/**
 * Recency of the candidate's last profile update. Fresh profiles get a mild
 * boost; untouched ones decay slowly, so staleness can't pin the top forever.
 * 1 = updated within ~2 weeks, 0.35 floor after ~9 months.
 */
export function freshnessScore(ctx: ScoreContext): number {
  if (!ctx.lastUpdatedIso) return 0.6;
  const t = Date.parse(ctx.lastUpdatedIso);
  if (!Number.isFinite(t)) return 0.6;
  const ageDays = (Date.now() - t) / 86_400_000;
  if (ageDays <= 14) return 1;
  if (ageDays <= 120) return clamp01(1 - ((ageDays - 14) / 106) * 0.35);
  return clamp01(0.65 - ((ageDays - 120) / 150) * 0.3);
}

/**
 * Open-source contribution signal: public reviewable work is among the
 * strongest quality evidence for engineering candidates, so it feeds the
 * depth subscore alongside project complexity.
 */
export function ossScore(ctx: ScoreContext): number {
  const n = ctx.ossContributions ?? 0;
  if (n <= 0) return 0;
  return clamp01(0.25 + Math.min(n, 4) * 0.15);
}

export const WEIGHTS = { semantic: 0.25, skill: 0.25, depth: 0.2, constraints: 0.15, seniority: 0.1, freshness: 0.05 };

export function finalScore(sub: SubScores): number {
  return Math.round(
    (sub.semantic * WEIGHTS.semantic +
      sub.skill * WEIGHTS.skill +
      sub.depth * WEIGHTS.depth +
      sub.constraints * WEIGHTS.constraints +
      sub.seniority * WEIGHTS.seniority +
      sub.freshness * WEIGHTS.freshness) *
      100,
  );
}

export function matchLevel(total: number): "strong" | "partial" | "weak" {
  if (total >= 75) return "strong";
  if (total >= 50) return "partial";
  return "weak";
}

export function scoreCandidate(job: JobReq, distance: number | null, ctx: ScoreContext): { sub: SubScores; total: number; level: "strong" | "partial" | "weak" } {
  const sub: SubScores = {
    semantic: semanticFromDistance(distance),
    skill: skillScore(job, ctx),
    depth: depthScore(ctx),
    constraints: constraintsScore(job, ctx),
    seniority: seniorityScore(job, ctx),
    freshness: freshnessScore(ctx),
  };
  const total = finalScore(sub);
  return { sub, total, level: matchLevel(total) };
}

export function blendWithJudge(rules0to100: number, judge0to100: number | null): number {
  if (judge0to100 == null) return rules0to100;
  return Math.round(rules0to100 * 0.7 + judge0to100 * 0.3);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

export function metadataStringArray(meta: unknown, key: string): string[] {
  const rec = asRecord(meta);
  if (!rec) return [];
  const nested = asRecord(rec.metadata_json) ?? asRecord(rec.metadata);
  const direct = rec[key];
  const fromNested = nested?.[key];
  const val = direct ?? fromNested;
  const arr = Array.isArray(val) ? val : typeof val === "string" ? [val] : [];
  const out: string[] = [];
  for (const t of arr) {
    if (typeof t === "string") {
      const s = t.trim();
      if (s) out.push(s);
    }
  }
  return out;
}

export function metadataTechnologies(meta: unknown): string[] {
  return metadataStringArray(meta, "technologies");
}
