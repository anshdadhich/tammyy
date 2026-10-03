import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { setRuntimeEnv, cfEnv } from "@/lib/cf";
import { generateCandidateSummary, analyzeProjectDepth } from "@/lib/ai";
import { embedTexts } from "@/lib/embeddings";
import { upsertChunkVector } from "@/lib/matching/retrieval";
import { profileReadyEmail, sendEmail } from "@/lib/email";

/**
 * Candidate profile processing: normalize → summary → project depth →
 * chunks → embed → notify. Each stage is its own Workflow step, so a crash
 * mid-pipeline resumes at the failed step instead of redoing the LLM work.
 *
 * Vector state stays out of D1 on purpose: embeddings live in Vectorize and
 * are re-derived from chunk text, which is the durable record.
 */

type Env = CloudflareEnv;
type Params = { candidateId: string };
type CandidateRow = typeof schema.candidates.$inferSelect;
type ProjectRow = typeof schema.projects.$inferSelect;
type ExperienceRow = typeof schema.workExperiences.$inferSelect;

const EMAIL_TIMEOUT_MS = 10_000;

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildChunks(input: {
  headline: string;
  domain: string;
  total_experience_years: number | null;
  skills: string[];
  experiences: { company_name: string; job_title: string; description: string | null }[];
  projects: { id: string; title: string; description: string; tech_stack: string[]; impact_summary: string | null }[];
  oss?: { repo_name: string; description: string | null; tech_stack: string[] }[];
}): Array<{ id: string; chunk_type: string; content_text: string; metadata_json: Record<string, unknown> }> {
  const expText = input.experiences
    .slice(0, 5)
    .map((e) => `${e.job_title} at ${e.company_name}${e.description ? `: ${e.description.slice(0, 300)}` : ""}`)
    .join(". ")
    .slice(0, 800);

  const summaryText = `${input.headline ?? ""} ${input.domain ?? ""} ${input.total_experience_years ?? ""}y Skills: ${input.skills
    .slice(0, 20)
    .join(", ")}${expText ? ` Experience: ${expText}` : ""}`
    .trim()
    .slice(0, 2000);

  const ossText = (input.oss ?? [])
    .slice(0, 5)
    .map((o) => `${o.repo_name}: ${o.description ?? ""} Tech: ${(o.tech_stack ?? []).join(", ")}`)
    .join(". ")
    .slice(0, 1500);

  const base = [
    {
      id: "summary",
      chunk_type: "summary",
      content_text: summaryText,
      metadata_json: {
        chunk_type: "summary",
        domain_tags: [input.domain].filter(Boolean),
        technologies: input.skills.slice(0, 20),
      },
    },
    ...(expText
      ? [{
          id: "experience",
          chunk_type: "experience",
          content_text: `Experience: ${expText}`.slice(0, 2000),
          metadata_json: {
            chunk_type: "experience",
            domain_tags: [input.domain].filter(Boolean),
            technologies: input.skills.slice(0, 20),
          },
        }]
      : []),
    ...(ossText
      ? [{
          id: "open-source",
          chunk_type: "skills",
          content_text: `Open source: ${ossText}`.slice(0, 2000),
          metadata_json: {
            chunk_type: "skills",
            domain_tags: [input.domain].filter(Boolean),
          },
        }]
      : []),
    ...input.projects.slice(0, 5).map((p) => ({
      id: p.id,
      chunk_type: "project",
      content_text: `Project: ${p.title}. ${p.description ?? ""} Tech: ${(p.tech_stack ?? []).join(", ")}. Impact: ${p.impact_summary ?? ""}`
        .trim()
        .slice(0, 2000),
      metadata_json: {
        chunk_type: "project",
        project_title: p.title,
        technologies: (p.tech_stack ?? []).slice(0, 20),
        domain_tags: [input.domain].filter(Boolean),
      },
    })),
  ];
  return base.filter((c) => c.content_text.replace(/\W+/g, "").length > 10);
}

const SECRET_KEYS = [
  "RESEND_API_KEY",
  "RESEND_FROM",
  "OPENROUTER_API_KEY",
  "OPENROUTER_BASE_URL",
  "JUDGE_MODEL",
  "CHEAP_MODEL",
  "SESSION_SECRET",
  "BOOTSTRAP_SECRET",
  "NEXT_PUBLIC_SITE_URL",
] as const;

function populateSecrets(env: Record<string, string | undefined>): void {
  for (const k of SECRET_KEYS) {
    const v = env[k];
    if (typeof v === "string" && v.length > 0 && !process.env[k]) {
      process.env[k] = v;
    }
  }
}

export class ProfilePipelineWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep): Promise<void> {
    // Workflow steps run outside the request path: no OpenNext context, no
    // populated process.env. Publish this.env so the data layer, embeddings,
    // and secret reads resolve.
    setRuntimeEnv(this.env as unknown as CloudflareEnv);
    populateSecrets(this.env as unknown as Record<string, string | undefined>);
    const candidateId = event.payload.candidateId;

    const bundle: {
      candidate: CandidateRow;
      projects: ProjectRow[];
      experiences: ExperienceRow[];
      skills: string[];
      oss: { repo_name: string; description: string | null; tech_stack: string[] }[];
    } = await step.do("load-profile", async () => {
      const db = await getDb();
      const candRows = await db
        .select()
        .from(schema.candidates)
        .where(eq(schema.candidates.id, candidateId))
        .limit(1);
      const candidate = candRows[0];
      if (!candidate) throw new Error(`candidate ${candidateId} not found`);

      const projects = await db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.candidate_id, candidateId))
        .limit(20);
      const experiences = await db
        .select()
        .from(schema.workExperiences)
        .where(eq(schema.workExperiences.candidate_id, candidateId))
        .limit(10);
      const skillLinks = await db
        .select({ skill_id: schema.candidateSkills.skill_id })
        .from(schema.candidateSkills)
        .where(eq(schema.candidateSkills.candidate_id, candidateId))
        .limit(50);
      const skillIds = [...new Set(skillLinks.map((l) => l.skill_id))];
      const skillRows = skillIds.length
        ? await db
            .select({ name: schema.skills.name })
            .from(schema.skills)
            .where(inArray(schema.skills.id, skillIds))
        : [];
      const ossRows = await db
        .select({
          repo_name: schema.openSourceContributions.repo_name,
          description: schema.openSourceContributions.description,
          tech_stack: schema.openSourceContributions.tech_stack,
        })
        .from(schema.openSourceContributions)
        .where(eq(schema.openSourceContributions.candidate_id, candidateId))
        .limit(10);
      return {
        candidate,
        projects,
        experiences,
        skills: skillRows.map((s) => s.name).filter(Boolean),
        oss: ossRows.map((o) => ({
          repo_name: o.repo_name,
          description: o.description,
          tech_stack: o.tech_stack ?? [],
        })),
      };
    });

    const { candidate, projects, experiences, skills, oss } = bundle;

    if (candidate.visibility_status && candidate.visibility_status !== "visible") {
      return;
    }

    await step.do("generate-summary", async () => {
      const result = await generateCandidateSummary({
        role: candidate.current_position ?? "",
        exp: String(candidate.total_experience_years ?? ""),
        domain: candidate.domain ?? "",
        skills,
        headline: candidate.headline ?? "",
        projects: projects.map((p) => ({
          title: p.title,
          description: p.description ?? "",
          tech: (p.tech_stack ?? []).join(", "),
          impact: p.impact_summary ?? "",
        })),
      });
      if (!result) return { ok: false };
      const db = await getDb();
      await db
        .insert(schema.candidateProfiles)
        .values({
          candidate_id: candidateId,
          summary_markdown: result.markdown,
          summary_json: result.json,
        })
        .onConflictDoUpdate({
          target: schema.candidateProfiles.candidate_id,
          set: {
            summary_markdown: result.markdown,
            summary_json: result.json,
            updated_at: new Date().toISOString(),
          },
        });
      return { ok: true };
    });

    for (const p of projects) {
      await step.do(`project-depth-${p.id}`, async () => {
        const depth = await analyzeProjectDepth({
          title: p.title,
          description: p.description ?? "",
          tech: (p.tech_stack ?? []).join(", "),
          role: "",
          impact: p.impact_summary ?? "",
        });
        if (!depth) return { ok: false };
        const db = await getDb();
        await db
          .insert(schema.projectDepthAnalysis)
          .values({
            project_id: p.id,
            complexity_score: typeof depth.complexity_score === "number" ? depth.complexity_score : 5,
            technical_complexity: String(depth.technical_complexity ?? "medium"),
            architectural_concepts: (depth.architectural_concepts as string[]) ?? [],
            evidence_quality: String(depth.evidence_quality ?? "moderate"),
            autonomy_level: String(depth.autonomy_level ?? "unknown"),
            relevance_tags: (depth.relevance_tags as string[]) ?? [],
            raw_ai_analysis: depth,
          })
          .onConflictDoUpdate({
            target: schema.projectDepthAnalysis.project_id,
            set: {
              complexity_score: typeof depth.complexity_score === "number" ? depth.complexity_score : 5,
              technical_complexity: String(depth.technical_complexity ?? "medium"),
              architectural_concepts: (depth.architectural_concepts as string[]) ?? [],
              evidence_quality: String(depth.evidence_quality ?? "moderate"),
              autonomy_level: String(depth.autonomy_level ?? "unknown"),
              relevance_tags: (depth.relevance_tags as string[]) ?? [],
              raw_ai_analysis: depth,
            },
          });
        return { ok: true };
      });
    }

    await step.do("embed-chunks", async () => {
      const chunks = buildChunks({
        headline: candidate.headline ?? "",
        domain: candidate.domain ?? "",
        total_experience_years: candidate.total_experience_years,
        skills,
        experiences: experiences.map((e) => ({
          company_name: e.company_name,
          job_title: e.job_title,
          description: e.description,
        })),
        projects: projects.map((p) => ({
          id: p.id,
          title: p.title,
          description: p.description ?? "",
          tech_stack: p.tech_stack ?? [],
          impact_summary: p.impact_summary,
        })),
        oss: oss.map((o) => ({
          repo_name: o.repo_name,
          description: o.description,
          tech_stack: o.tech_stack ?? [],
        })),
      });
      if (!chunks.length) return { count: 0 };

      const vectors = await embedTexts(chunks.map((c) => c.content_text));
      const db = await getDb();

      const existing = await db
        .select({
          id: schema.profileChunks.id,
          content_hash: schema.profileChunks.content_hash,
          content_text: schema.profileChunks.content_text,
        })
        .from(schema.profileChunks)
        .where(eq(schema.profileChunks.candidate_id, candidateId));

      await db
        .delete(schema.profileChunks)
        .where(eq(schema.profileChunks.candidate_id, candidateId));

      const newIds = new Set<string>();
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        // Deterministic id + content hash: identical content re-embeds to the
        // same id, so re-runs are idempotent and stale vectors are detectable.
        const contentHash = await sha256Hex(`${candidateId}:${c.chunk_type}:${c.content_text}`);
        const id = `${c.chunk_type}-${contentHash.slice(0, 24)}`;
        newIds.add(id);
        await db
          .insert(schema.profileChunks)
          .values({
            id,
            candidate_id: candidateId,
            chunk_type: c.chunk_type,
            content_text: c.content_text,
            content_hash: contentHash,
            metadata_json: c.metadata_json,
            embedding_dim: vectors[i].length,
          })
          .onConflictDoUpdate({
            target: schema.profileChunks.id,
            set: {
              content_text: c.content_text,
              content_hash: contentHash,
              metadata_json: c.metadata_json,
              embedding_dim: vectors[i].length,
            },
          });
        await upsertChunkVector({
          id,
          candidate_id: candidateId,
          chunk_type: c.chunk_type,
          content_text: c.content_text,
          metadata_json: c.metadata_json,
          embedding: vectors[i],
        });
      }
      // Delete vectors whose chunks no longer exist (text changed or removed)
      // — they would otherwise keep serving stale content.
      const staleIds = existing.map((r) => r.id).filter((rid) => !newIds.has(rid));
      if (staleIds.length) {
        try {
          const env = await cfEnv();
          await env.VECTORS.deleteByIds(staleIds);
        } catch (e) {
          console.error("[pipeline] stale vector cleanup failed", e instanceof Error ? e.message : e);
        }
        await db.delete(schema.profileChunks).where(inArray(schema.profileChunks.id, staleIds));
      }
      // Bump the candidate row so search cache invalidation (corpusUnchanged
      // checks candidates.updated_at) sees pipeline enrichment, not just
      // owner edits.
      await db
        .update(schema.candidates)
        .set({ updated_at: new Date().toISOString() })
        .where(eq(schema.candidates.id, candidateId));
      return { count: chunks.length };
    });

    await step.do("notify", async () => {
      const db = await getDb();
      const rows = await db
        .select({
          full_name: schema.candidates.full_name,
          contact_email: schema.candidates.contact_email,
        })
        .from(schema.candidates)
        .where(eq(schema.candidates.id, candidateId))
        .limit(1);
      const contact = rows[0];
      if (!contact?.contact_email) return { notified: false };
      const tpl = profileReadyEmail(contact.full_name ?? "there");
      await Promise.race([
        sendEmail(contact.contact_email, tpl.subject, tpl.html),
        new Promise((r) => setTimeout(r, EMAIL_TIMEOUT_MS)),
      ]);
      return { notified: true };
    });
  }
}

