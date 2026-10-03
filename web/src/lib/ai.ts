import { cheapModel, defaultOpenAIProvider } from "@/lib/matching/judge";
import { redactPii } from "@/lib/redact";

export const SUMMARY_MAX_TOKENS = 1200;
export const SUMMARY_TIMEOUT_MS = 25000;

async function chat(system: string, user: string, opts: { maxTokens?: number; timeoutMs?: number } = {}): Promise<string | null> {
  const maxTokens = opts.maxTokens ?? SUMMARY_MAX_TOKENS;
  const timeoutMs = opts.timeoutMs ?? SUMMARY_TIMEOUT_MS;
  try {
    const provider = defaultOpenAIProvider(cheapModel(), { maxTokens, timeoutMs });
    return await provider.complete({ system, user });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ai] chat failed detail=${redactPii(msg.slice(0, 200))}`);
    return null;
  }
}

export async function generateCandidateSummary(input: {
  role: string; exp: string; domain: string; skills: string[];
  headline: string; projects: { title: string; description: string; tech: string; impact: string }[];
}): Promise<{ markdown: string; json: Record<string, unknown> } | null> {
  const system = `You are a factual talent analyst writing for recruiters who scan profiles in under a minute. Use ONLY the provided data — never invent facts.

Write 4-6 short paragraphs (prose, not bullet fragments): identity and current focus; core skills with a concrete artifact behind each notable claim (a project, a number, a role line); strongest evidence of depth (the one project worth reading first, and why); outcomes and impact; constraints (availability, location, salary); and gaps where the data is genuinely silent.

Rules:
- Every strength or impact claim cites something from the data — "shipped X" is weak, "shipped X (200 paying users, per project impact)" is a claim with evidence.
- Omit sections the data cannot support. Never write "Not specified." or pad with filler.
- Plain, direct sentences. No buzzwords, no restating the job.

Then add one line: "Weakest evidence:" and name the single thinnest area, so reviewers know where to probe.`;
  const user = JSON.stringify(input).slice(0, 8000);
  const draft = await chat(system, user, { maxTokens: 1500 });
  if (!draft) return null;
  const critiqued = await chat(
    `You are a strict reviewer of hiring-profile summaries. Given a draft summary and the source data, list every claim that is vague, uncited, or padded — and rewrite the summary fixing exactly those, in the same format. If the draft is already evidence-backed throughout, return it unchanged.`,
    `SOURCE DATA:
${user}

DRAFT:
${draft}`,
    { maxTokens: 1500 },
  );
  const markdown = (critiqued ?? draft).slice(0, 8000);
  return { markdown, json: { generated: true, critiqued: !!critiqued, at: new Date().toISOString() } };
}

export async function analyzeProjectDepth(p: {
  title: string; description: string; tech: string; role: string; impact: string;
}): Promise<Record<string, unknown> | null> {
  const system = `You are a senior technical evaluator. Return STRICT JSON only: {"technical_complexity":"low|medium|high|very_high","complexity_score":1-10,"architectural_concepts":[],"evidence_quality":"weak|moderate|strong","autonomy_level":"solo|contributed|led|unknown","relevance_tags":[],"strengths":[],"limitations":[]}. Use only provided info.`;
  const text = await chat(system, JSON.stringify(p).slice(0, 4000), { maxTokens: 1000 });
  if (!text) return null;
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const complexity = Math.min(10, Math.max(1, Math.round(Number(parsed.complexity_score) || 5)));
    const tech = ["low", "medium", "high", "very_high"].includes(String(parsed.technical_complexity))
      ? String(parsed.technical_complexity) : "medium";
    const evidence = ["weak", "moderate", "strong"].includes(String(parsed.evidence_quality))
      ? String(parsed.evidence_quality) : "moderate";
    const autonomy = ["solo", "contributed", "led", "unknown"].includes(String(parsed.autonomy_level))
      ? String(parsed.autonomy_level) : "unknown";
    return { ...parsed, complexity_score: complexity, technical_complexity: tech, evidence_quality: evidence, autonomy_level: autonomy };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ai] depth parse failed detail=${redactPii(msg.slice(0, 200))}`);
  }
  return null;
}
