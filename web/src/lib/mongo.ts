import { MongoClient, Db, Collection, Document } from "mongodb";

/**
 * MongoDB connection (replaces Supabase/Postgres).
 *
 * - MONGODB_URI  (default mongodb://127.0.0.1:27017)
 * - MONGODB_DB   (default "tammy")
 *
 * The client is cached on globalThis so dev hot-reloads reuse one connection.
 * Server-only: throws if imported into a browser bundle.
 */

const DEFAULT_URI = "mongodb://127.0.0.1:27017";
const DEFAULT_DB = "tammy";

declare global {
  var __tammyMongoClient: Promise<MongoClient> | undefined;
}

export function mongoUri(): string {
  return process.env.MONGODB_URI || DEFAULT_URI;
}

export function mongoDbName(): string {
  return process.env.MONGODB_DB || DEFAULT_DB;
}

function connect(): Promise<MongoClient> {
  const client = new MongoClient(mongoUri(), {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 10,
  });
  return client.connect();
}

/** Server-only handle to the app database. */
export async function getDb(): Promise<Db> {
  if (typeof window !== "undefined") {
    throw new Error("getDb() must only run on the server");
  }
  if (!globalThis.__tammyMongoClient) {
    globalThis.__tammyMongoClient = connect().catch((err) => {
      // Allow a retry on the next request after a failed attempt.
      globalThis.__tammyMongoClient = undefined;
      throw err;
    });
  }
  const client = await globalThis.__tammyMongoClient;
  return client.db(mongoDbName());
}

/** Convenience accessor for a named collection. */
export async function col<T extends Document = Document>(
  name: string,
): Promise<Collection<T>> {
  const db = await getDb();
  return db.collection<T>(name);
}

/**
 * App document shape: rows are keyed by string UUIDs (never ObjectId),
 * so `_id` filters/inserts type-check against `string`.
 */
export type AppDoc = { _id: string } & Record<string, unknown>;

/**
 * Collection names. Mirrors the former SQL tables one-to-one so the data
 * model stays recognizable (users, candidates, employers, ...).
 */
export const Collections = {
  users: "users",
  sessions: "sessions",
  candidates: "candidates",
  candidateProfiles: "candidate_profiles",
  workExperiences: "work_experiences",
  projects: "projects",
  projectDepthAnalysis: "project_depth_analysis",
  education: "education",
  skills: "skills",
  candidateSkills: "candidate_skills",
  profileChunks: "profile_chunks",
  employers: "employers",
  jobs: "jobs",
  jobRequirements: "job_requirements",
  searches: "searches",
  candidateMatches: "candidate_matches",
  shortlists: "shortlists",
  contactLog: "contact_log",
  auditLogs: "audit_logs",
  openSourceContributions: "open_source_contributions",
  employerQuotas: "employer_quotas",
} as const;
