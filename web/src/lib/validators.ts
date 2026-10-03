import { z } from "zod";
import { normalizeSkills } from "./skills";

const optionalUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => v === "" || /^https?:\/\/.+\..+/.test(v), {
    message: "Must be a valid http(s) URL or empty",
  })
  .optional()
  .default("");

const emptyToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

export const remotePrefSchema = z.enum(["onsite", "hybrid", "remote"]);
export const salaryFrequencySchema = z.enum(["hourly", "weekly", "monthly", "yearly"]);
export const senioritySchema = z.enum([
  "intern",
  "junior",
  "mid",
  "senior",
  "lead",
  "staff",
]);
export const employmentTypeSchema = z.enum([
  "full-time",
  "part-time",
  "contract",
  "internship",
  "freelance",
]);
export const visibilitySchema = z
  .enum(["visible", "hidden", "inactive"])
  .default("visible");

export const experienceSchema = z.object({
  company: z.string().trim().min(1, "Company required").max(200),
  title: z.string().trim().min(1, "Title required").max(200),
  start_date: z.string().trim().max(50).default(""),
  end_date: z.string().trim().max(50).default(""),
  current: z.boolean().default(false),
  description: z.string().trim().max(4000).default(""),
  achievements: z.string().trim().max(4000).default(""),
  tech: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
});

export const projectLinksSchema = z.object({
  live: optionalUrl,
  repo: optionalUrl,
  demo: optionalUrl,
});

export const projectSchema = z.object({
  title: z.string().trim().min(1, "Project title required").max(200),
  description: z.string().trim().min(1, "Description required").max(4000),
  problem: z.string().trim().max(2000).default(""),
  tech: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  role: z.string().trim().max(200).default(""),
  links: projectLinksSchema.default({ live: "", repo: "", demo: "" }),
  impact: z.string().trim().max(2000).default(""),
  users_scale: z.string().trim().max(200).default(""),
  hardest_challenge: z.string().trim().max(2000).default(""),
  personal_contribution: z.string().trim().max(2000).default(""),
  project_type: z.string().trim().max(100).default(""),
});

export const educationSchema = z.object({
  institution: z.string().trim().min(1, "Institution required").max(200),
  degree: z.string().trim().max(200).default(""),
  field: z.string().trim().max(200).default(""),
  years: z.string().trim().max(50).default(""),
  achievements: z.string().trim().max(2000).default(""),
});

const httpOrEmpty = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => v === "" || /^https?:\/\/.+\..+/.test(v), {
    message: "Must be a valid http(s) URL or empty",
  })
  .default("");

export const ossSchema = z.object({
  repo_name: z.string().trim().min(1, "Repo name required").max(200),
  repo_url: httpOrEmpty,
  description: z.string().trim().max(4000).default(""),
  pr_links: z.array(httpOrEmpty).max(20).default([]),
  tech: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  role: z.string().trim().max(200).default("Contributor"),
});

export const candidateLinksSchema = z.object({
  github: optionalUrl,
  linkedin: optionalUrl,
  portfolio: optionalUrl,
  resume_url: optionalUrl,
});

export const candidateSchema = z.object({
  name: z.string().trim().min(1, "Name required").max(100),
  email: z.string().trim().min(1, "Email required").email("Invalid email"),
  phone: z
    .string()
    .trim()
    .max(20, "Phone too long")
    .refine((v) => v === "" || /^[+\d][\d\s\-()]{6,19}$/.test(v), {
      message: "Invalid phone",
    })
    .default(""),
  location: z.string().trim().min(1, "Location required").max(200),
  photo_url: optionalUrl,

  role: z.string().trim().min(1, "Desired role required").max(200),
  current_role: z.string().trim().max(200).default(""),
  headline: z.string().trim().max(220).default(""),
  domain: z.string().trim().min(1, "Domain required").max(100),
  exp: z.coerce.number().min(0).max(50).default(0),

  skills: z
    .array(z.string().trim().min(1).max(100))
    .min(1, "Add at least one skill")
    .max(50)
    .transform((arr) => normalizeSkills(arr)),

  experiences: z.array(experienceSchema).max(20).default([]),
  projects: z.array(projectSchema).max(20).default([]),
  oss: z.array(ossSchema).max(20).default([]),
  education: z.array(educationSchema).max(10).default([]),
  links: candidateLinksSchema.default({
    github: "",
    linkedin: "",
    portfolio: "",
    resume_url: "",
  }),

  min_salary: z.coerce.number().min(0).default(0),
  currency: z
    .string()
    .trim()
    .length(3, "Currency must be a 3-letter code")
    .default("INR"),
  frequency: salaryFrequencySchema.default("monthly"),
  negotiable: z.boolean().default(true),
  location_pref: z.string().trim().max(200).default(""),
  remote_pref: remotePrefSchema.default("remote"),
  relocation: z.boolean().default(false),
  availability: z.string().trim().max(200).default("Immediate"),
  notice_period: z.preprocess(
    emptyToUndefined,
    z.string().trim().max(200).optional()
  ),

  visibility: visibilitySchema,
  show_email: z.boolean().default(false),
  show_phone: z.boolean().default(false),
  show_linkedin: z.boolean().default(false),
  show_github: z.boolean().default(false),
  show_resume: z.boolean().default(false),
  show_portfolio: z.boolean().default(false),
  show_photo: z.boolean().default(false),
  consent: z.literal(true, {
    message: "You must consent to processing to join",
  }),
});

export type CandidateInput = z.infer<typeof candidateSchema>;
export type ExperienceInput = z.infer<typeof experienceSchema>;
export type ProjectInput = z.infer<typeof projectSchema>;
export type OssInput = z.infer<typeof ossSchema>;
export type EducationInput = z.infer<typeof educationSchema>;

export const jobSchema = z
  .object({
    title: z.string().trim().min(1, "Job title required").max(200),
    domain: z.string().trim().min(1, "Domain required").max(100),
    seniority: senioritySchema,
    must_have: z
      .array(z.string().trim().min(1).max(100))
      .min(1, "Add at least one must-have skill")
      .max(30)
      .transform((arr) => normalizeSkills(arr)),
    nice_to_have: z
      .array(z.string().trim().min(1).max(100))
      .max(30)
      .default([])
      .transform((arr) => normalizeSkills(arr)),
    min_exp: z.coerce.number().min(0).max(50).default(0),
    max_exp: z.coerce.number().min(0).max(50).default(50),
    salary_min: z.coerce.number().min(0).optional().default(0),
    salary_max: z.coerce.number().min(0).optional(),
    salary_frequency: salaryFrequencySchema.default("yearly"),
    currency: z
      .string()
      .trim()
      .length(3, "Currency must be a 3-letter code")
      .default("INR"),
    location: z.string().trim().max(200).default(""),
    remote_policy: remotePrefSchema.default("remote"),
    relocation_allowed: z.boolean().default(false),
    employment_type: employmentTypeSchema.default("full-time"),
    description: z
      .string()
      .trim()
      .min(20, "Description needs at least 20 characters")
      .max(10000),
    responsibilities: z.string().trim().max(5000).default(""),
    screening_requirements: z.string().trim().max(5000).default(""),
    start_date: z.preprocess(
      emptyToUndefined,
      z.string().trim().max(50).optional()
    ),
  })
  .refine((j) => j.salary_max === undefined || j.salary_max >= j.salary_min, {
    message: "salary_max must be >= salary_min",
    path: ["salary_max"],
  })
  .refine((j) => j.max_exp >= j.min_exp, {
    message: "max_exp must be >= min_exp",
    path: ["max_exp"],
  });

export type JobInput = z.infer<typeof jobSchema>;

export function toFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

export function normalizeEmail(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}
