import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { cfEnv } from "@/lib/cf";

/**
 * Semantic retrieval for candidate matching.
 *
 * Vectors live in a Vectorize index (similarity computed by Cloudflare, not
 * in Worker CPU), chunk text and metadata ride along in each vector's
 * metadata, and candidate-side filters run as one D1 query over the returned
 * ids. The shape and ranking semantics of the old `match_chunks` RPC are
 * preserved: cosine distance ASC, at most `p_per_candidate` chunks per
 * candidate, `match_count` candidates in the result.
 */

export type MatchChunksParams = {
  query_embedding: number[];
  match_count?: number | null;
  p_domain?: string | null;
  p_min_exp?: number | null;
  p_salary_max?: number | null;
  p_location?: string | null;
  p_candidate_ids?: string[] | null;
  p_availability?: string | null;
  p_chunk_types?: string[] | null;
  p_fts_terms?: string[] | null;
  p_per_candidate?: number | null;
};

export type MatchChunksRow = {
  chunk_id: string;
  candidate_id: string;
  chunk_type: string;
  content_text: string;
  metadata_json: unknown;
  distance: number;
};

const VECTORIZE_FETCH_MULTIPLIER = 4;
const VECTORIZE_MAX_FETCH = 300;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compileFtsMatchers(terms: string[]): Array<RegExp | null> {
  return terms.map((term) => {
    const words = term.split(/\s+/).filter(Boolean);
    if (!words.length) return null;
    return new RegExp(`\\b${words.map(escapeRegExp).join("\\s+")}\\b`, "i");
  });
}

function domainPasses(meta: unknown, domain: string | null): boolean {
  if (domain === null) return true;
  if (meta === null || meta === undefined) return true;
  if (typeof meta !== "object" || Array.isArray(meta)) return false;
  const m = meta as Record<string, unknown>;
  if (Object.keys(m).length === 0) return true;
  const tags = m.domain_tags;
  if (Array.isArray(tags) && tags.includes(domain)) return true;
  const techs = m.technologies;
  if (Array.isArray(techs) && techs.includes(domain)) return true;
  return m.domain === domain;
}

export async function matchChunks(params: MatchChunksParams): Promise<MatchChunksRow[]> {
  const q = params.query_embedding;
  if (!Array.isArray(q) || !q.length) return [];

  const vLimit = Math.min(Math.max(params.match_count ?? 30, 1), 200);
  const vPer = Math.min(Math.max(params.p_per_candidate ?? 3, 1), 10);
  const domain = params.p_domain?.trim() ? params.p_domain.trim() : null;
  const location = params.p_location?.trim() ? params.p_location.trim() : null;

  const env = await cfEnv();
  const fetchCount = Math.min(vLimit * vPer * VECTORIZE_FETCH_MULTIPLIER, VECTORIZE_MAX_FETCH);

  let matches: { id: string; metadata?: Record<string, unknown>; distance?: number }[] = [];
  try {
    const res = await env.VECTORS.query(q, {
      topK: fetchCount,
      returnMetadata: "all",
    });
    matches = res.matches as unknown as { id: string; metadata?: Record<string, unknown>; distance?: number }[];
  } catch (e) {
    console.error("[retrieval] vector query failed", e instanceof Error ? e.message : e);
    return [];
  }
  if (!matches.length) return [];

  type Chunk = { id: string; candidate_id: string; chunk_type: string; content_text: string; metadata_json: unknown; distance: number };
  const chunks: Chunk[] = [];
  for (const m of matches) {
    const meta = (m.metadata ?? {}) as Record<string, unknown>;
    const candidateId = typeof meta.candidate_id === "string" ? meta.candidate_id : "";
    if (!candidateId) continue;
    chunks.push({
      id: m.id,
      candidate_id: candidateId,
      chunk_type: typeof meta.chunk_type === "string" ? meta.chunk_type : "",
      content_text: typeof meta.content_text === "string" ? meta.content_text : "",
      metadata_json: meta,
      distance: typeof m.distance === "number" ? m.distance : 1,
    });
  }
  if (!chunks.length) return [];

  const ids = [...new Set(chunks.map((c) => c.candidate_id))];

  const db = await getDb();
  const conds = [
    inArray(schema.candidates.id, ids),
    eq(schema.candidates.visibility_status, "visible"),
  ];
  if (params.p_candidate_ids?.length) {
    conds.push(inArray(schema.candidates.id, params.p_candidate_ids));
  }
  if (params.p_availability) {
    conds.push(eq(schema.candidates.availability_status, params.p_availability));
  }
  if (params.p_min_exp != null) {
    conds.push(
      or(
        sql`${schema.candidates.total_experience_years} IS NULL`,
        sql`${schema.candidates.total_experience_years} >= ${params.p_min_exp}`,
      )!,
    );
  }
  if (params.p_salary_max != null) {
    // Annualize before comparing — candidates store monthly/weekly/hourly
    // frequencies and job salary_max is annual (mirrors scoring's annualize()).
    conds.push(
      or(
        sql`${schema.candidates.min_salary} IS NULL`,
        sql`${schema.candidates.min_salary} * (CASE LOWER(${schema.candidates.salary_frequency})
             WHEN 'monthly' THEN 12
             WHEN 'weekly' THEN 52
             WHEN 'hourly' THEN 2080
             ELSE 1 END) <= ${params.p_salary_max}`,
      )!,
    );
  }
  if (location !== null) {
    // D1 LIKE patterns are capped at 50 bytes; keep the filter pattern short
    // and treat longer locations as a plain prefix match.
    const pattern = location.slice(0, 32).replace(/[%_]/g, "");
    conds.push(
      or(
        inArray(schema.candidates.remote_preference, ["remote_only", "flexible"]),
        sql`LOWER(${schema.candidates.location_city}) LIKE ${`%${pattern.toLowerCase()}%`}`,
      )!,
    );
  }

  const visible = await db
    .select({ id: schema.candidates.id })
    .from(schema.candidates)
    .where(and(...conds));
  const visibleIds = new Set(visible.map((r) => r.id));
  if (!visibleIds.size) return [];

  const matchers = params.p_fts_terms ? compileFtsMatchers(params.p_fts_terms) : null;
  const allowedTypes = params.p_chunk_types?.length ? new Set(params.p_chunk_types) : null;

  const filtered = chunks.filter((row) => {
    if (!visibleIds.has(row.candidate_id)) return false;
    if (allowedTypes && !allowedTypes.has(row.chunk_type)) return false;
    if (!domainPasses(row.metadata_json, domain)) return false;
    if (matchers) {
      const text = row.content_text;
      if (!matchers.some((re) => re !== null && re.test(text))) return false;
    }
    return true;
  });

  filtered.sort((a, b) => a.distance - b.distance);

  const perCandidate = new Map<string, number>();
  const out: MatchChunksRow[] = [];
  for (const row of filtered) {
    const taken = perCandidate.get(row.candidate_id) ?? 0;
    if (taken >= vPer) continue;
    perCandidate.set(row.candidate_id, taken + 1);
    out.push({
      chunk_id: row.id,
      candidate_id: row.candidate_id,
      chunk_type: row.chunk_type,
      content_text: row.content_text,
      metadata_json: row.metadata_json,
      distance: row.distance,
    });
    if (out.length >= vLimit * vPer) break;
  }
  return out;
}

export async function upsertChunkVector(chunk: {
  id: string;
  candidate_id: string;
  chunk_type: string;
  content_text: string;
  metadata_json: Record<string, unknown>;
  embedding: number[];
}): Promise<void> {
  const env = await cfEnv();
  await env.VECTORS.upsert([
    {
      id: chunk.id,
      values: chunk.embedding,
      metadata: {
        ...chunk.metadata_json,
        candidate_id: chunk.candidate_id,
        chunk_type: chunk.chunk_type,
        content_text: chunk.content_text.slice(0, 2000),
      },
    },
  ]);
}

export async function deleteChunksForCandidate(candidateId: string): Promise<void> {
  const db = await getDb();
  const rows = await db
    .select({ id: schema.profileChunks.id })
    .from(schema.profileChunks)
    .where(eq(schema.profileChunks.candidate_id, candidateId));
  if (!rows.length) return;
  const env = await cfEnv();
  await env.VECTORS.deleteByIds(rows.map((r) => r.id));
}

export async function recentChunkVectorIds(limit: number): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .select({ id: schema.profileChunks.id })
    .from(schema.profileChunks)
    .orderBy(desc(schema.profileChunks.created_at))
    .limit(limit);
  return rows.map((r) => r.id);
}
