import type { Db } from "mongodb";
import { AppDoc, Collections } from "@/lib/mongo";

/**
 * App-side port of the Postgres `match_chunks` RPC (Supabase-era; the SQL
 * source was removed with the rest of `supabase/` — semantics preserved here).
 *
 * The SQL ran over `profile_chunks JOIN candidates` with pgvector cosine
 * distance (`<=>`), a ROW_NUMBER() per-candidate cap and a final LIMIT.
 * Here:
 *   1. candidate-side filters (visibility, id allow-list, experience,
 *      salary, location, availability) run as one Mongo query;
 *   2. chunk-side filters (embedding non-null, chunk_type allow-list,
 *      domain metadata, FTS terms) run in JS over the projected rows;
 *   3. ranking is cosine distance `1 - dot(q,c)/(|q||c|)` computed in JS
 *      (zero-norm or dim-mismatched vectors get dist 1);
 *   4. the SQL window semantics are preserved exactly: sort by dist ASC,
 *      keep the top `v_limit * v_per` rows, keep at most `v_per` per
 *      candidate, return the first `v_limit`.
 *
 * The returned rows match the RPC's RETURNS TABLE shape that the search
 * route destructures: `{chunk_id, candidate_id, chunk_type, content_text,
 * metadata_json, distance}`.
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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Approximates `to_tsvector('english', text) @@ plainto_tsquery('english', term)`
 * as a case-insensitive whole-word match; a multi-word term ANDs its words
 * (every word must match as a whole word). User input is regex-escaped.
 * A term with no words mirrors an empty tsquery (matches nothing) -> null.
 */
function compileFtsMatchers(terms: string[]): Array<RegExp | null> {
  return terms.map((term) => {
    const words = term.split(/\s+/).filter(Boolean);
    if (!words.length) return null;
    return new RegExp(`\\b${words.map(escapeRegExp).join("\\s+")}\\b`, "i");
  });
}

/**
 * SQL domain arm: NULL/absent metadata or `{}` passes; otherwise
 * `domain_tags` / `technologies` arrays contain p_domain, or `domain` equals it.
 */
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

/** pgvector `<=>` (cosine distance) with a safe zero-norm / bad-data guard. */
function cosineDistance(q: number[], embedding: unknown): number {
  if (!Array.isArray(embedding) || embedding.length !== q.length) return 1;
  let dot = 0;
  let nq = 0;
  let nc = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i];
    const b = embedding[i];
    if (typeof b !== "number" || !Number.isFinite(b)) return 1;
    dot += a * b;
    nq += a * a;
    nc += b * b;
  }
  if (nq <= 0 || nc <= 0) return 1;
  const dist = 1 - dot / (Math.sqrt(nq) * Math.sqrt(nc));
  return Number.isFinite(dist) ? dist : 1;
}

export async function matchChunks(
  db: Db,
  params: MatchChunksParams,
): Promise<MatchChunksRow[]> {
  const q = params.query_embedding;
  if (!Array.isArray(q) || !q.length) return [];

  // SQL: LEAST(GREATEST(COALESCE(match_count, 30), 1), 200) / same for p_per.
  const vLimit = Math.min(Math.max(params.match_count ?? 30, 1), 200);
  const vPer = Math.min(Math.max(params.p_per_candidate ?? 3, 1), 10);
  const domain = params.p_domain?.trim() ? params.p_domain.trim() : null;
  const location = params.p_location?.trim() ? params.p_location.trim() : null;

  // ---- candidate side: JOIN + visibility + filters on c.* ----
  const candFilter: Record<string, unknown> = { visibility_status: "visible" };
  if (params.p_candidate_ids) candFilter._id = { $in: params.p_candidate_ids };
  if (params.p_availability) candFilter.availability_status = params.p_availability;
  const and: Record<string, unknown>[] = [];
  if (params.p_min_exp != null) {
    and.push({
      $or: [
        { total_experience_years: null },
        { total_experience_years: { $gte: params.p_min_exp } },
      ],
    });
  }
  if (params.p_salary_max != null) {
    and.push({ $or: [{ min_salary: null }, { min_salary: { $lte: params.p_salary_max } }] });
  }
  if (location !== null) {
    and.push({
      $or: [
        { remote_preference: { $in: ["remote_only", "flexible"] } },
        { location_city: new RegExp(escapeRegExp(location), "i") },
      ],
    });
  }
  if (and.length) candFilter.$and = and;

  const candidates = await db
    .collection<AppDoc>(Collections.candidates)
    .find(candFilter, { projection: { _id: 1 } })
    .toArray();
  const candidateIds = candidates.map((c) => String(c._id));
  if (!candidateIds.length) return [];

  // ---- chunk side: embedding non-null + id/chunk_type allow-lists ----
  const chunkFilter: Record<string, unknown> = {
    embedding: { $ne: null },
    candidate_id: { $in: candidateIds },
  };
  if (params.p_chunk_types) chunkFilter.chunk_type = { $in: params.p_chunk_types };
  const chunks = await db
    .collection<AppDoc>(Collections.profileChunks)
    .find(chunkFilter, {
      projection: { candidate_id: 1, chunk_type: 1, content_text: 1, metadata_json: 1, embedding: 1 },
    })
    .toArray();

  // p_fts_terms: null -> no arm; [] or all-empty terms -> matches nothing
  // (mirrors `EXISTS (SELECT 1 FROM unnest(...))`).
  const matchers = params.p_fts_terms ? compileFtsMatchers(params.p_fts_terms) : null;

  const scored: MatchChunksRow[] = [];
  for (const row of chunks) {
    if (!domainPasses(row.metadata_json, domain)) continue;
    const text = typeof row.content_text === "string" ? row.content_text : "";
    if (matchers && !matchers.some((re) => re !== null && re.test(text))) continue;
    const candidateId = String(row.candidate_id ?? "");
    if (!candidateId) continue;
    scored.push({
      chunk_id: String(row._id),
      candidate_id: candidateId,
      chunk_type: typeof row.chunk_type === "string" ? row.chunk_type : "",
      content_text: text,
      metadata_json: row.metadata_json,
      distance: cosineDistance(q, row.embedding),
    });
  }

  // SQL: CTE ORDER BY dist LIMIT v_limit*v_per, then rn <= v_per, then LIMIT v_limit.
  scored.sort((a, b) => a.distance - b.distance);
  const window = scored.slice(0, vLimit * vPer);
  const seen = new Map<string, number>();
  const out: MatchChunksRow[] = [];
  for (const row of window) {
    const n = (seen.get(row.candidate_id) ?? 0) + 1;
    if (n > vPer) continue;
    seen.set(row.candidate_id, n);
    out.push(row);
    if (out.length >= vLimit) break;
  }
  return out;
}
