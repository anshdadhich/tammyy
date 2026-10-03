import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const isoNow = () => new Date().toISOString();

const createdAt = () => text("created_at").notNull().$defaultFn(isoNow);
const updatedAt = () =>
  text("updated_at")
    .notNull()
    .$defaultFn(isoNow)
    .$onUpdateFn(isoNow);

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    password_hash: text("password_hash"),
    role: text("role").notNull(),
    status: text("status").notNull().default("active"),
    email_verified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
    created_at: createdAt(),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    token_hash: text("token_hash").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    created_at: createdAt(),
    expires_at: text("expires_at").notNull(),
    user_agent: text("user_agent"),
    ip: text("ip"),
  },
  (t) => [index("sessions_expires_at_idx").on(t.expires_at)],
);

export const candidates = sqliteTable(
  "candidates",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id").references(() => users.id, { onDelete: "set null" }),
    full_name: text("full_name").notNull(),
    headline: text("headline"),
    domain: text("domain").notNull(),
    current_position: text("current_position"),
    total_experience_years: real("total_experience_years"),
    education_level: text("education_level"),
    location_city: text("location_city"),
    location_country: text("location_country"),
    remote_preference: text("remote_preference"),
    open_to_relocation: integer("open_to_relocation", { mode: "boolean" }).notNull().default(false),
    min_salary: real("min_salary"),
    salary_currency: text("salary_currency"),
    salary_frequency: text("salary_frequency"),
    salary_negotiable: integer("salary_negotiable", { mode: "boolean" }).notNull().default(true),
    availability_status: text("availability_status"),
    notice_period: text("notice_period"),
    visibility_status: text("visibility_status").notNull().default("hidden"),
    consent_status: text("consent_status"),
    show_email: integer("show_email", { mode: "boolean" }).notNull().default(false),
    show_phone: integer("show_phone", { mode: "boolean" }).notNull().default(false),
    show_linkedin: integer("show_linkedin", { mode: "boolean" }).notNull().default(false),
    show_github: integer("show_github", { mode: "boolean" }).notNull().default(false),
    show_resume: integer("show_resume", { mode: "boolean" }).notNull().default(false),
    show_portfolio: integer("show_portfolio", { mode: "boolean" }).notNull().default(false),
    show_photo: integer("show_photo", { mode: "boolean" }).notNull().default(false),
    contact_email: text("contact_email"),
    contact_phone: text("contact_phone"),
    github_url: text("github_url"),
    linkedin_url: text("linkedin_url"),
    portfolio_url: text("portfolio_url"),
    resume_url: text("resume_url"),
    photo_url: text("photo_url"),
    profile_strength: real("profile_strength"),
    freshness_updated_at: text("freshness_updated_at"),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (t) => [
    index("candidates_user_id_idx").on(t.user_id),
    index("candidates_contact_email_idx").on(t.contact_email, t.created_at),
    index("candidates_visibility_idx").on(t.visibility_status, t.created_at),
  ],
);

export const candidateProfiles = sqliteTable("candidate_profiles", {
  candidate_id: text("candidate_id")
    .primaryKey()
    .references(() => candidates.id, { onDelete: "cascade" }),
  summary_markdown: text("summary_markdown"),
  summary_json: text("summary_json", { mode: "json" }).$type<Record<string, unknown> | null>(),
  created_at: createdAt(),
  updated_at: updatedAt(),
});

export const workExperiences = sqliteTable(
  "work_experiences",
  {
    id: text("id").primaryKey(),
    candidate_id: text("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    company_name: text("company_name").notNull(),
    job_title: text("job_title").notNull(),
    employment_type: text("employment_type"),
    start_date: text("start_date"),
    end_date: text("end_date"),
    is_current: integer("is_current", { mode: "boolean" }).notNull().default(false),
    description: text("description"),
    achievements: text("achievements"),
    tech_stack: text("tech_stack", { mode: "json" }).$type<string[]>().$defaultFn(() => []),
    evidence_links: text("evidence_links", { mode: "json" }).$type<string[]>().$defaultFn(() => []),
    created_at: createdAt(),
  },
  (t) => [index("work_experiences_candidate_idx").on(t.candidate_id)],
);

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    candidate_id: text("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    problem_statement: text("problem_statement"),
    tech_stack: text("tech_stack", { mode: "json" }).$type<string[]>().$defaultFn(() => []),
    role_in_project: text("role_in_project"),
    project_link: text("project_link"),
    repo_link: text("repo_link"),
    deployment_link: text("deployment_link"),
    impact_summary: text("impact_summary"),
    project_type: text("project_type"),
    start_date: text("start_date"),
    end_date: text("end_date"),
    created_at: createdAt(),
  },
  (t) => [index("projects_candidate_idx").on(t.candidate_id)],
);

export const projectDepthAnalysis = sqliteTable("project_depth_analysis", {
  project_id: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  complexity_score: integer("complexity_score").notNull().default(5),
  technical_complexity: text("technical_complexity").notNull().default("medium"),
  architectural_concepts: text("architectural_concepts", { mode: "json" })
    .$type<string[]>()
    .$defaultFn(() => []),
  evidence_quality: text("evidence_quality").notNull().default("moderate"),
  autonomy_level: text("autonomy_level").notNull().default("unknown"),
  relevance_tags: text("relevance_tags", { mode: "json" }).$type<string[]>().$defaultFn(() => []),
  raw_ai_analysis: text("raw_ai_analysis", { mode: "json" }).$type<Record<string, unknown> | null>(),
  created_at: createdAt(),
});

export const education = sqliteTable(
  "education",
  {
    id: text("id").primaryKey(),
    candidate_id: text("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    institution: text("institution").notNull(),
    degree: text("degree"),
    field_of_study: text("field_of_study"),
    start_year: integer("start_year"),
    end_year: integer("end_year"),
    achievements: text("achievements"),
  },
  (t) => [index("education_candidate_idx").on(t.candidate_id)],
);

export const skills = sqliteTable(
  "skills",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    aliases: text("aliases", { mode: "json" }).$type<string[]>().$defaultFn(() => []),
    category: text("category"),
    created_at: createdAt(),
  },
  (t) => [uniqueIndex("skills_name_unique").on(t.name)],
);

export const candidateSkills = sqliteTable(
  "candidate_skills",
  {
    candidate_id: text("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    skill_id: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    experience_years: real("experience_years"),
    proficiency_level: text("proficiency_level"),
    source: text("source"),
  },
  (t) => [
    primaryKey({ columns: [t.candidate_id, t.skill_id] }),
    index("candidate_skills_skill_idx").on(t.skill_id),
  ],
);

export const profileChunks = sqliteTable(
  "profile_chunks",
  {
    id: text("id").primaryKey(),
    candidate_id: text("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    chunk_type: text("chunk_type").notNull(),
    content_text: text("content_text").notNull(),
    content_hash: text("content_hash").notNull(),
    metadata_json: text("metadata_json", { mode: "json" })
      .$type<Record<string, unknown>>()
      .$defaultFn(() => ({})),
    embedding_dim: integer("embedding_dim"),
    created_at: createdAt(),
  },
  (t) => [index("profile_chunks_candidate_idx").on(t.candidate_id)],
);

export const openSourceContributions = sqliteTable(
  "open_source_contributions",
  {
    id: text("id").primaryKey(),
    candidate_id: text("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    repo_name: text("repo_name").notNull(),
    repo_url: text("repo_url"),
    description: text("description"),
    pr_links: text("pr_links", { mode: "json" }).$type<string[]>().$defaultFn(() => []),
    tech_stack: text("tech_stack", { mode: "json" }).$type<string[]>().$defaultFn(() => []),
    role: text("role"),
    created_at: createdAt(),
  },
  (t) => [index("oss_candidate_idx").on(t.candidate_id)],
);

export const employers = sqliteTable(
  "employers",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id").references(() => users.id, { onDelete: "set null" }),
    company_name: text("company_name").notNull(),
    company_email: text("company_email"),
    website: text("website"),
    linkedin_url: text("linkedin_url"),
    company_size: text("company_size"),
    industry: text("industry"),
    verification_status: text("verification_status").notNull().default("pending"),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (t) => [index("employers_user_idx").on(t.user_id)],
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    employer_id: text("employer_id")
      .notNull()
      .references(() => employers.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    domain: text("domain"),
    seniority: text("seniority"),
    description: text("description"),
    responsibilities: text("responsibilities"),
    screening_requirements: text("screening_requirements"),
    must_have_skills: text("must_have_skills", { mode: "json" }).$type<string[]>().$defaultFn(() => []),
    nice_to_have_skills: text("nice_to_have_skills", { mode: "json" }).$type<string[]>().$defaultFn(() => []),
    min_experience: real("min_experience"),
    max_experience: real("max_experience"),
    salary_min: real("salary_min"),
    salary_max: real("salary_max"),
    salary_currency: text("salary_currency"),
    location: text("location"),
    remote_policy: text("remote_policy"),
    relocation_allowed: integer("relocation_allowed", { mode: "boolean" }).notNull().default(false),
    employment_type: text("employment_type"),
    status: text("status").notNull().default("active"),
    start_date: text("start_date"),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (t) => [index("jobs_employer_idx").on(t.employer_id)],
);

export const searches = sqliteTable(
  "searches",
  {
    id: text("id").primaryKey(),
    employer_id: text("employer_id").references(() => employers.id, { onDelete: "cascade" }),
    query_text: text("query_text").notNull(),
    query_hash: text("query_hash"),
    filters_json: text("filters_json"),
    result_count: integer("result_count").notNull().default(0),
    created_at: createdAt(),
  },
  (t) => [
    index("searches_employer_idx").on(t.employer_id, t.created_at),
    index("searches_query_hash_idx").on(t.query_hash),
    index("searches_created_idx").on(t.created_at),
  ],
);

export const candidateMatches = sqliteTable(
  "candidate_matches",
  {
    id: text("id").primaryKey(),
    search_id: text("search_id")
      .notNull()
      .references(() => searches.id, { onDelete: "cascade" }),
    candidate_id: text("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    job_id: text("job_id"),
    score: real("score"),
    match_reasons_json: text("match_reasons_json", { mode: "json" }).$type<Record<string, unknown> | null>(),
    status: text("status"),
    created_at: createdAt(),
  },
  (t) => [
    uniqueIndex("candidate_matches_search_candidate_unique").on(t.search_id, t.candidate_id),
    index("candidate_matches_candidate_idx").on(t.candidate_id),
    index("candidate_matches_created_idx").on(t.created_at),
  ],
);

export const shortlists = sqliteTable(
  "shortlists",
  {
    id: text("id").primaryKey(),
    employer_id: text("employer_id").references(() => employers.id, { onDelete: "cascade" }),
    candidate_id: text("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    // '' sentinel = "no job" so the unique index below treats it like any
    // other value (SQLite considers NULLs distinct in unique indexes).
    job_id: text("job_id").notNull().default(""),
    status: text("status"),
    notes: text("notes"),
    created_at: createdAt(),
  },
  (t) => [
    index("shortlists_candidate_idx").on(t.candidate_id),
    index("shortlists_employer_idx").on(t.employer_id, t.candidate_id),
    uniqueIndex("shortlists_unique").on(t.employer_id, t.candidate_id, t.job_id),
  ],
);

export const contactLog = sqliteTable(
  "contact_log",
  {
    id: text("id").primaryKey(),
    employer_id: text("employer_id").references(() => employers.id, { onDelete: "cascade" }),
    candidate_id: text("candidate_id").references(() => candidates.id, { onDelete: "cascade" }),
    job_id: text("job_id"),
    channel: text("channel").notNull(),
    message: text("message"),
    message_hash: text("message_hash"),
    created_at: createdAt(),
  },
  (t) => [
    index("contact_log_candidate_idx").on(t.candidate_id, t.created_at),
    index("contact_log_employer_idx").on(t.employer_id, t.candidate_id),
  ],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    action: text("action").notNull(),
    target_type: text("target_type").notNull(),
    target_id: text("target_id"),
    metadata_json: text("metadata_json", { mode: "json" })
      .$type<Record<string, unknown>>()
      .$defaultFn(() => ({})),
    created_at: createdAt(),
  },
  (t) => [index("audit_logs_created_idx").on(t.created_at)],
);

export const employerQuotas = sqliteTable("employer_quotas", {
  employer_id: text("employer_id")
    .primaryKey()
    .references(() => employers.id, { onDelete: "cascade" }),
  plan: text("plan").notNull().default("free"),
  search_limit: integer("search_limit").notNull(),
  cycle_started_at: text("cycle_started_at").notNull(),
});
