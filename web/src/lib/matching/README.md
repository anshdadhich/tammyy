# matching/ - live retrieval and scoring

Flow: `job -> embed -> matchChunks() (hybrid: Vectorize semantic + D1 lexical,
fused with RRF) -> group per candidate -> rules score (+evidence/gaps) ->
optional judge top-N -> blend`

| File | Covers |
|---|---|
| `types.ts` | `CandidateChunk`, `ChunkMetadata`, `JobReq`, `MatchLevel` |
| `retrieval.ts` | `matchChunks()` — hybrid retrieval: Vectorize semantic arm + D1 lexical term-frequency arm, Reciprocal Rank Fusion, candidate-side filters (visibility, salary annualized by frequency, experience, location), per-candidate cap. Also `upsertChunkVector` / `deleteChunksForCandidate`. |
| `hybrid.ts` | `buildFtsQueryText` / `buildFtsTerms` (per-term keyword list feeding the lexical arm). |
| `judge.ts` | `JudgeProvider`, `defaultOpenAIProvider`, `judgeCandidate`, `judgeTop` (parallel, timeouts, null-tolerant), `parseJudgeOutput` (parses fit fields from the model's JSON). |
| `../scoring-live.ts` | Live rules scoring (semantic, skill, depth + OSS, constraints, seniority, freshness) + `blendWithJudge` (0.7 rules + 0.3 judge, advisory). Called by `/api/search`. |
| `../embeddings.ts` | `embedTexts` / `embedQuery` — Workers AI `@cf/qwen/qwen3-embedding-0.6b`, MRL-truncated 1024 -> 512, timeout-enforced. |

## Env

- `OPENROUTER_API_KEY` (or `LLM_API_KEY`) + optional `JUDGE_MODEL` / `CHEAP_MODEL`, `OPENROUTER_BASE_URL` - judge

## Notes

- Vectors live in the Vectorize index `tammy-profile-chunks-512` (512 dims, cosine). Chunk text is mirrored in each vector's metadata so the retrieval path has content without a D1 join.
- Ranking is RRF-fused (score = sum of 1/(60 + rank) over the semantic and lexical arms) — higher fused score = better match.
- Embeddings run in the profile pipeline Workflow; re-runs are idempotent (deterministic chunk ids from content hash) and stale vectors are deleted.
