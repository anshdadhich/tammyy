export type ChunkType =
  | "summary"
  | "experience"
  | "project"
  | "education"
  | "skills";

export type Complexity = "low" | "medium" | "high" | "very_high";
export type EvidenceQuality = "weak" | "moderate" | "strong";
export type Seniority = "intern" | "junior" | "mid" | "senior" | "lead" | "unknown";

export interface ChunkMetadata {
  chunk_type: ChunkType;
  project_title?: string;
  technologies?: string[];
  domain_tags?: string[];
  complexity?: Complexity | string;
  evidence_quality?: EvidenceQuality | string;
  candidate_id: string;
  role_title?: string;
  seniority_signal?: Seniority | string;
  updated_at?: string;
}

export interface CandidateChunk {
  id: string;
  candidate_id: string;
  chunk_type: ChunkType;
  text: string;
  metadata: ChunkMetadata;
  embedding?: number[];
  distance?: number;
  rank?: number;
}

export interface JobReq {
  job_title: string;
  domain?: string;
  seniority?: Seniority | string;
  must_have_skills: string[];
  nice_to_have_skills: string[];
  experience_min?: number | null;
  experience_max?: number | null;
  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string | null;
  salary_frequency?: string | null;
  location?: string | null;
  remote_allowed?: boolean;
  core_responsibilities?: string[];
  implied_technical_needs?: string[];
  red_flags_or_constraints?: string[];
  raw_description: string;
}

export type MatchLevel = "strong" | "partial" | "weak";

