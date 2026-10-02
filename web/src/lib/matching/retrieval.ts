import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { cfEnv } from "@/lib/cf";

/**
 * Hybrid retrieval for candidate matching: two arms fused with Reciprocal
 * Rank Fusion (RRF).
 *
 * - Semantic arm: Vectorize cosine similarity (computed by Cloudflare, not
 *   in Worker CPU).
 * - Lexical arm: D1 term-frequency ranking over chunk text, so exact skill
 *   terms are a ranking signal rather than a mere pass/fail filter.
 * - Fusion: score = sum over arms of 1/(RRF_K + rank). RRF needs no score
 *   normalization and runs in a few lines of JS over two short lists.
 *
 * Candidate-side filters run as one D1 query over the fused candidate ids.
 * At most `p_per_candidate` chunks per candidate and `match_count`
 * candidates in the result, ordered by fused score DESC.
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
  fused_score: number;
};

const VECTORIZE_FETCH_MULTIPLIER = 4;
const VECTORIZE_MAX_FETCH = 600;
const RRF_K = 60;
const LEXICAL_LIMIT = 200;

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

/**
 * Lexical arm: rank chunks by how strongly the query terms appear in the
 * text. Exact-match counting is our BM25-lite — cheap enough to run inside
 * the 10ms CPU budget over a few hundred rows.
 */
function lexicalScore(text: string, terms: string[]): number {
  const t = text.toLowerCase();
  let score = 0;
  for (const term of terms) {
    const w = term.trim().toLowerCase();
    if (w.length < 2) continue;
    let hits = 0;
    let idx = 0;
    while ((idx = t.indexOf(w, idx)) !== -1) {
      hits += 1;
      idx += w.length;
    }
    if (hits > 0) score += 1 + Math.min(hits - 1, 3) * 0.25;
  }
  return score;
}

async function lexicalArm(
  terms: string[],
  chunkTypes: Set<string> | null,
): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  if (!terms.length) return scores;
  const db = await getDb();
  const rows = await db
    .select({
      id: schema.profileChunks.id,
      content_text: schema.profileChunks.content_text,
    })
    .from(schema.profileChunks)
    .limit(LEXICAL_LIMIT * 3);
  for (const r of rows) {
    if (chunkTypes && !chunkTypes.has(String((r as unknown as { chunk_type?: string }).chunk_type ?? ""))) continue;
    const s = lexicalScore(r.content_text, terms);
    if (s > 0) scores.set(r.id, s);
    if (scores.size >= LEXICAL_LIMIT * 2) break;
  }
  return scores;
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

  // Vectorize caps topK at 50 when returning metadata and has no pagination,
  // so the query is bounded to one page. Widening recall beyond 50 chunks is
  // tracked in TODO.md (join chunk text from D1 instead of vector metadata).
  const matches = await (async () => {
    try {
      const res = await env.VECTORS.query(q, {
        topK: Math.min(fetchCount, 50),
        returnMetadata: "all",
      });
      return res.matches as unknown as { id: string; metadata?: Record<string, unknown>; score?: number }[];
    } catch (e) {
      console.error("[retrieval] vector query failed", e instanceof Error ? e.message : e);
      throw e;
    }
  })();
  if (!matches.length) return [];

  type Chunk = { id: string; candidate_id: string; chunk_type: string; content_text: string; metadata_json: unknown; distance: number };
  const chunks: Chunk[] = [];
  for (const m of matches) {
    const meta = (m.metadata ?? {}) as Record<string, unknown>;
    const candidateId = typeof meta.candidate_id === "string" ? meta.candidate_id : "";
    if (!candidateId) continue;
    // Vectorize cosine indexes return similarity `score`; ranking and the
    // scoring pipeline want cosine distance = 1 - score.
    const score = typeof m.score === "number" ? m.score : 0;
    chunks.push({
      id: m.id,
      candidate_id: candidateId,
      chunk_type: typeof meta.chunk_type === "string" ? meta.chunk_type : "",
      content_text: typeof meta.content_text === "string" ? meta.content_text : "",
      metadata_json: meta,
      distance: 1 - score,
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
    // D1 LIKE patterns are capped at 50 bytes; keep the filter pattern short.
    // Prefix match on the city tokens ("San" matches "San Jose", never "San Diego"
    // mid-word false positives beyond the first token boundary).
    const pattern = location.slice(0, 32).replace(/[%_]/g, "");
    conds.push(
      or(
        inArray(schema.candidates.remote_preference, ["remote_only", "flexible"]),
        sql`LOWER(${schema.candidates.location_city}) LIKE ${`${pattern.toLowerCase()}%`}`,
      )!,
    );
  }

  const visibleIds = new Set<string>();
  for (let i = 0; i < ids.length; i += 90) {
    const batch = ids.slice(i, i + 90);
    const rows = await db
      .select({ id: schema.candidates.id })
      .from(schema.candidates)
      .where(and(inArray(schema.candidates.id, batch), ...conds.slice(1)));
    for (const r of rows) visibleIds.add(r.id);
  }
  if (!visibleIds.size) return [];

  const allowedTypes = params.p_chunk_types?.length ? new Set(params.p_chunk_types) : null;

  const filtered = chunks.filter((row) => {
    if (!visibleIds.has(row.candidate_id)) return false;
    if (allowedTypes && !allowedTypes.has(row.chunk_type)) return false;
    if (!domainPasses(row.metadata_json, domain)) return false;
    return true;
  });
  if (!filtered.length) return [];

  // Two-arm fusion: semantic (cosine distance) + lexical (term frequency).
  // Each arm ranks independently; RRF score = Σ 1/(K + rank) over arms, so
  // a chunk strong in either arm rises and neither score scale dominates.
  const terms = params.p_fts_terms?.filter((t) => t.trim().length >= 2) ?? [];
  const semanticRank = new Map<string, number>();
  [...filtered]
    .sort((a, b) => a.distance - b.distance)
    .forEach((row, i) => semanticRank.set(row.id, i + 1));

  const lexScores = terms.length ? await lexicalArm(terms, allowedTypes) : new Map<string, number>();
  const lexFiltered = [...lexScores.entries()]
    .filter(([id]) => filtered.some((r) => r.id === id))
    .sort((a, b) => b[1] - a[1]);
  const lexRank = new Map<string, number>();
  lexFiltered.forEach(([id], i) => lexRank.set(id, i + 1));

  const useArms = [semanticRank, lexRank].filter((a) => a.size > 0);
  const fused = new Map<string, number>();
  for (const row of filtered) {
    let s = 0;
    for (const arm of useArms) {
      const rank = arm.get(row.id);
      if (rank != null) s += 1 / (RRF_K + rank);
    }
    fused.set(row.id, s);
  }
  // A lexical term match is also a precision gate: when terms were given,
  // drop chunks the lexical arm ranked at all but keep semantic-only hits
  // only if nothing matched lexically (recall safety net).
  if (terms.length && lexRank.size > 0) {
    const keepIds = new Set(lexFiltered.map(([id]) => id));
    for (const row of filtered) {
      if (!keepIds.has(row.id)) fused.set(row.id, fused.get(row.id)! * 0.5);
    }
  }

  filtered.sort((a, b) => (fused.get(b.id) ?? 0) - (fused.get(a.id) ?? 0));

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
      fused_score: fused.get(row.id) ?? 0,
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
