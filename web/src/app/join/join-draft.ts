import type { ZodError } from "zod";
import {
  candidateLinksSchema,
  candidateSchema,
  educationSchema,
  experienceSchema,
  ossSchema,
  projectSchema,
} from "@/lib/validators";

export const STEPS = [
  "Basics",
  "Profile",
  "Experience",
  "Projects",
  "Background",
  "Private",
  "Review",
] as const;

export type ExperienceDraft = {
  company: string;
  title: string;
  start_date: string;
  end_date: string;
  current: boolean;
  description: string;
  achievements: string;
  tech: string[];
};

export type ProjectDraft = {
  title: string;
  description: string;
  problem: string;
  tech: string[];
  role: string;
  live: string;
  repo: string;
  demo: string;
  impact: string;
  users_scale: string;
  hardest_challenge: string;
  personal_contribution: string;
  project_type: string;
};

export type EducationDraft = {
  institution: string;
  degree: string;
  field: string;
  years: string;
  achievements: string;
};

export type OssDraft = {
  repo_name: string;
  repo_url: string;
  description: string;
  pr_links: string;
  tech: string[];
  role: string;
};

export type Draft = {
  step: number;
  name: string;
  email: string;
  phone: string;
  location: string;
  photo_url: string;
  role: string;
  current_role: string;
  headline: string;
  domain: string;
  exp: string;
  skills: string[];
  experiences: ExperienceDraft[];
  projects: ProjectDraft[];
  education: EducationDraft[];
  oss: OssDraft[];
  github: string;
  linkedin: string;
  portfolio: string;
  resume_url: string;
  min_salary: string;
  currency: string;
  frequency: string;
  negotiable: boolean;
  location_pref: string;
  remote_pref: string;
  relocation: boolean;
  availability: string;
  notice_period: string;
  visibility: string;
  show_email: boolean;
  show_phone: boolean;
  show_linkedin: boolean;
  show_github: boolean;
  show_resume: boolean;
  show_portfolio: boolean;
  show_photo: boolean;
  consent: boolean;
};

export const INITIAL_DRAFT: Draft = {
  step: 1,
  name: "",
  email: "",
  phone: "",
  location: "",
  photo_url: "",
  role: "",
  current_role: "",
  headline: "",
  domain: "",
  exp: "",
  skills: [],
  experiences: [],
  projects: [],
  education: [],
  oss: [],
  github: "",
  linkedin: "",
  portfolio: "",
  resume_url: "",
  min_salary: "",
  currency: "INR",
  frequency: "monthly",
  negotiable: true,
  location_pref: "",
  remote_pref: "remote",
  relocation: false,
  availability: "Immediate",
  notice_period: "",
  visibility: "visible",
  show_email: false,
  show_phone: false,
  show_linkedin: false,
  show_github: false,
  show_resume: false,
  show_portfolio: false,
  show_photo: false,
  consent: false,
};

export function emptyExperience(): ExperienceDraft {
  return {
    company: "",
    title: "",
    start_date: "",
    end_date: "",
    current: false,
    description: "",
    achievements: "",
    tech: [],
  };
}

export function emptyProject(): ProjectDraft {
  return {
    title: "",
    description: "",
    problem: "",
    tech: [],
    role: "",
    live: "",
    repo: "",
    demo: "",
    impact: "",
    users_scale: "",
    hardest_challenge: "",
    personal_contribution: "",
    project_type: "",
  };
}

export function emptyEducation(): EducationDraft {
  return { institution: "", degree: "", field: "", years: "", achievements: "" };
}

export function emptyOss(): OssDraft {
  return { repo_name: "", repo_url: "", description: "", pr_links: "", tech: [], role: "" };
}

export const AUTOFILL_DRAFT: Draft = {
  ...INITIAL_DRAFT,
  name: "Aarav Sharma",
  email: "aarav.sharma@example.com",
  phone: "+91 98765 43210",
  location: "Bengaluru",
  role: "Backend Developer",
  current_role: "SDE-1 @ Acme",
  headline: "Backend dev, Node + Mongo, 2y",
  domain: "Software Development",
  exp: "2",
  skills: ["Node.js", "PostgreSQL", "Redis", "Docker"],
  experiences: [
    {
      company: "Acme",
      title: "SDE-1",
      start_date: "2023-01",
      end_date: "",
      current: true,
      description: "Built delivery APIs for the warehouse-to-doorstep flow.",
      achievements: "Cut p95 latency from 800ms to 250ms with Redis caching.",
      tech: ["Node.js"],
    },
  ],
  projects: [
    {
      title: "Tracker",
      description: "Realtime delivery tracker for 500 concurrent drivers.",
      problem: "Orders went missing between the warehouse and the doorstep.",
      tech: ["Node.js"],
      role: "Sole backend",
      live: "",
      repo: "https://github.com/aarav/tracker",
      demo: "",
      impact: "Cut delivery support tickets by 40%.",
      users_scale: "500 concurrent connections",
      hardest_challenge: "Idempotent event ingestion under retry storms.",
      personal_contribution: "Designed the schema and the WebSocket layer.",
      project_type: "production",
    },
  ],
  education: [
    {
      institution: "Mumbai Univ",
      degree: "B.Tech",
      field: "Computer Science",
      years: "2019 - 2023",
      achievements: "",
    },
  ],
  oss: [
    {
      repo_name: "prisma-migrate",
      repo_url: "https://github.com/prisma/prisma-migrate",
      description: "Fixed a race in migration locking.",
      pr_links: "https://github.com/prisma/prisma/pull/1",
      tech: ["Prisma"],
      role: "Contributor",
    },
  ],
  github: "https://github.com/aarav",
  linkedin: "https://www.linkedin.com/in/aarav",
  min_salary: "50000",
  availability: "Immediate",
  visibility: "visible",
  show_email: true,
  show_linkedin: true,
  show_github: true,
  consent: true,
};

const DRAFT_KEY = "tammy_join_draft_v1";

function clampStep(value: unknown): number {
  const step = Math.round(Number(value));
  if (!Number.isFinite(step)) return 1;
  return Math.min(STEPS.length, Math.max(1, step));
}

export function loadDraft(): Draft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const draft = { ...INITIAL_DRAFT, ...(parsed as Partial<Draft>) };
    draft.step = clampStep(draft.step);
    if (!Array.isArray(draft.skills)) draft.skills = [];
    if (!Array.isArray(draft.experiences)) draft.experiences = [];
    if (!Array.isArray(draft.projects)) draft.projects = [];
    if (!Array.isArray(draft.education)) draft.education = [];
    if (!Array.isArray(draft.oss)) draft.oss = [];
    return draft;
  } catch {
    return null;
  }
}

export function saveDraft(draft: Draft): void {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    return;
  }
}

export function clearDraft(): void {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    return;
  }
}

type Validator = {
  safeParse(
    data: unknown,
  ):
    | { success: true; data: unknown }
    | { success: false; error: ZodError };
};

const basicsSchema = candidateSchema.pick({
  name: true,
  email: true,
  phone: true,
  location: true,
  photo_url: true,
});

const profileSchema = candidateSchema.pick({
  role: true,
  current_role: true,
  headline: true,
  domain: true,
  exp: true,
  skills: true,
});

const privateSchema = candidateSchema.pick({
  min_salary: true,
  currency: true,
  frequency: true,
  negotiable: true,
  location_pref: true,
  remote_pref: true,
  relocation: true,
  availability: true,
  notice_period: true,
  visibility: true,
  show_email: true,
  show_phone: true,
  show_linkedin: true,
  show_github: true,
  show_resume: true,
  show_portfolio: true,
  show_photo: true,
  consent: true,
});

const accountSchema = candidateSchema.pick({ email: true });

export function payloadErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const parts = issue.path.filter((seg) => typeof seg === "string");
    const key = parts.join(".") || "_form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

function parseErrors(schema: Validator, data: unknown): Record<string, string> {
  const parsed = schema.safeParse(data);
  return parsed.success ? {} : payloadErrors(parsed.error);
}

function entryErrors(
  schema: Validator,
  entries: unknown[],
  base: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  entries.forEach((entry, index) => {
    const parsed = schema.safeParse(entry);
    if (!parsed.success) {
      for (const [key, message] of Object.entries(payloadErrors(parsed.error))) {
        out[`${base}.${index}.${key}`] = message;
      }
    }
  });
  return out;
}

function basicsOf(d: Draft) {
  return { name: d.name, email: d.email, phone: d.phone, location: d.location, photo_url: d.photo_url };
}

function profileOf(d: Draft) {
  return {
    role: d.role,
    current_role: d.current_role,
    headline: d.headline,
    domain: d.domain,
    exp: d.exp,
    skills: d.skills,
  };
}

function linksOf(d: Draft) {
  return { github: d.github, linkedin: d.linkedin, portfolio: d.portfolio, resume_url: d.resume_url };
}

function privateOf(d: Draft) {
  return {
    min_salary: d.min_salary,
    currency: d.currency,
    frequency: d.frequency,
    negotiable: d.negotiable,
    location_pref: d.location_pref,
    remote_pref: d.remote_pref,
    relocation: d.relocation,
    availability: d.availability,
    notice_period: d.notice_period,
    visibility: d.visibility,
    show_email: d.show_email,
    show_phone: d.show_phone,
    show_linkedin: d.show_linkedin,
    show_github: d.show_github,
    show_resume: d.show_resume,
    show_portfolio: d.show_portfolio,
    show_photo: d.show_photo,
    consent: d.consent,
  };
}

function splitLinks(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function projectPayload(p: ProjectDraft) {
  return {
    title: p.title,
    description: p.description,
    problem: p.problem,
    tech: p.tech,
    role: p.role,
    links: { live: p.live, repo: p.repo, demo: p.demo },
    impact: p.impact,
    users_scale: p.users_scale,
    hardest_challenge: p.hardest_challenge,
    personal_contribution: p.personal_contribution,
    project_type: p.project_type,
  };
}

export function ossPayload(o: OssDraft) {
  return {
    repo_name: o.repo_name,
    repo_url: o.repo_url,
    description: o.description,
    pr_links: splitLinks(o.pr_links),
    tech: o.tech,
    role: o.role,
  };
}

export function validateStep(step: number, d: Draft): Record<string, string> {
  if (step === 1) return parseErrors(basicsSchema, basicsOf(d));
  if (step === 2) return parseErrors(profileSchema, profileOf(d));
  if (step === 3) return entryErrors(experienceSchema, d.experiences, "experiences");
  if (step === 4) return entryErrors(projectSchema, d.projects.map(projectPayload), "projects");
  if (step === 5) {
    return {
      ...entryErrors(educationSchema, d.education, "education"),
      ...entryErrors(ossSchema, d.oss.map(ossPayload), "oss"),
      ...parseErrors(candidateLinksSchema, linksOf(d)),
    };
  }
  if (step === 6) return parseErrors(privateSchema, privateOf(d));
  return {};
}

function passwordPolicyError(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password.length > 200) return "Password must be at most 200 characters.";
  return null;
}

export function validateAccount(
  d: Draft,
  password: string,
  confirm: string,
): Record<string, string> {
  const errs = parseErrors(accountSchema, { email: d.email });
  const policy = passwordPolicyError(password);
  if (policy) errs.password = policy;
  if (!confirm) errs.confirm = "Confirm your password.";
  else if (confirm !== password) errs.confirm = "Passwords do not match.";
  return errs;
}

export function buildPayload(d: Draft) {
  return {
    name: d.name,
    email: d.email,
    phone: d.phone,
    location: d.location,
    photo_url: d.photo_url,
    role: d.role,
    current_role: d.current_role,
    headline: d.headline,
    domain: d.domain,
    exp: d.exp,
    skills: d.skills,
    experiences: d.experiences,
    projects: d.projects.map(projectPayload),
    oss: d.oss.map(ossPayload),
    education: d.education,
    links: linksOf(d),
    min_salary: d.min_salary,
    currency: d.currency,
    frequency: d.frequency,
    negotiable: d.negotiable,
    location_pref: d.location_pref,
    remote_pref: d.remote_pref,
    relocation: d.relocation,
    availability: d.availability,
    notice_period: d.notice_period,
    visibility: d.visibility,
    show_email: d.show_email,
    show_phone: d.show_phone,
    show_linkedin: d.show_linkedin,
    show_github: d.show_github,
    show_resume: d.show_resume,
    show_portfolio: d.show_portfolio,
    show_photo: d.show_photo,
    consent: d.consent,
  };
}

export function parseCandidate(d: Draft) {
  return candidateSchema.safeParse(buildPayload(d));
}

export function stepForKey(key: string): number {
  const head = key.split(".")[0] ?? key;
  if (head === "experiences") return 3;
  if (head === "projects") return 4;
  if (head === "education" || head === "oss" || head === "links") return 5;
  if (head === "email" || head === "password" || head === "confirm") return 7;
  if (head === "name" || head === "phone" || head === "location" || head === "photo_url") return 1;
  if (
    head === "role" ||
    head === "current_role" ||
    head === "headline" ||
    head === "domain" ||
    head === "exp" ||
    head === "skills"
  ) {
    return 2;
  }
  return 6;
}
