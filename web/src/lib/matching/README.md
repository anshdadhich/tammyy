# matching/ - live retrieval and scoring

Flow: `job -> embed -> matchChunks() (filtered vector + FTS, app-side) -> group per candidate -> rules score (+evidence/gaps) -> optional judge top10 -> blend`

| File | Covers |
|---|---|
| `types.ts` | `CandidateChunk`, `ChunkMetadata`, `JobReq`, `SubScores`, `MatchLevel` |
| `voyage.ts` | `embedTexts`, `embedChunks`, `embedQuery`, `buildJobQueryText`, dim asserts. Needs `VOYAGE_API_KEY`. |
| `hybrid.ts` | `buildFtsQueryText` / `buildFtsTerms` (per-term keyword list feeding the FTS OR arm). |
| `mongo-retrieval.ts` | `matchChunks()` - app-side replacement for the old Postgres `match_chunks` RPC: clamps, candidate/chunk filters, cosine distance, per-candidate cap, FTS regex, top-N. |
| `judge.ts` | `JudgeProvider`, `defaultOpenAIProvider`, `judgeCandidate`, `judgeTop` (parallel, timeouts, null-tolerant), `parseJudgeOutput`. |
| `../scoring-live.ts` | Live rules scoring + `blendWithJudge` (0.7 rules + 0.3 judge, advisory). Called by `/api/search`. |

## Env

- `VOYAGE_API_KEY` - embeddings
- `OPENROUTER_API_KEY` (or `LLM_API_KEY`) + optional `JUDGE_MODEL`, `OPENROUTER_BASE_URL` - judge

## Notes

- Retrieval filters (domain, experience, salary, location, availability, chunk types, FTS) are applied inside `matchChunks()` (`mongo-retrieval.ts`) before ranking.
- `POST /api/search` caches by `query_hash` and reuses stored query embeddings; deep-judge payloads are reused from recent same-hash searches.
