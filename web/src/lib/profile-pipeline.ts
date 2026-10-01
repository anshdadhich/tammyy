import { createHash, randomUUID } from "node:crypto";
import { NonRetriableError } from "inngest";
import { inngest } from "@/lib/inngest";
import { AppDoc, Collections, getDb } from "@/lib/mongo";
import { embedChunks } from "@/lib/matching/voyage";
import { profileReadyEmail, sendEmail } from "@/lib/email";
import { analyzeProjectDepth, generateCandidateSummary } from "@/lib/ai";
import { startWideEvent } from "@/lib/observe";
import { withTimeout } from "@/lib/timeout";

interface ProfileSubmittedData {
  candidateId: string;
}

const EMBEDDING_MODEL = "voyage-4-lite";
const EXPECTED_EMBEDDING_DIM = 1024;
const MAX_PROJECTS = 8;
const EMAIL_TIMEOUT_MS = 15000;

function contentHash(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

export const processProfile = inngest.createFunction(
  {
    id: "process-profile",
    triggers: [{ event: "candidate.profile.submitted" }],
    concurrency: { limit: 1, key: "event.data.candidateId" },
    retries: 2,
  },
  async ({ event, step }: { event: { data: ProfileSubmittedData }; step: { run: <T>(name: string, fn: () => Promise<T>) => Promise<T> } }) => {
    const candidateId = event.data.candidateId;
    if (!candidateId || typeof candidateId !== "string") {
      throw new NonRetriableError("invalid candidateId");
    }
    const db = await getDb();

    const candidate = await step.run("fetch-candidate", async () => {
      // Same contract as the old `.single()` (error → null → non-retriable).
      try {
        const r = await db.collection<AppDoc>(Collections.candidates).findOne(
          { _id: candidateId },
          { projection: { headline: 1, domain: 1, total_experience_years: 1, visibility_status: 1, _id: 0 } },
        );
        if (!r) return null;
        return {
          headline: (r.headline as string | null) ?? null,
          domain: (r.domain as string | null) ?? null,
          total_experience_years: (r.total_experience_years as number | null) ?? null,
          visibility_status: (r.visibility_status as string | null) ?? null,
        };
      } catch {
        return null;
      }
    });
    if (!candidate) throw new NonRetriableError("candidate not found");
    if (candidate.visibility_status && candidate.visibility_status !== "visible") {
      return { ok: true, skipped: true as const, reason: "not visible" };
    }

    const bundle = await step.run("fetch-context", async () => {
      type ProjectRow = {
        id: string;
        title: string;
        description: string | null;
        tech_stack: string[] | null;
        impact_summary: string | null;
      };
      type ExpRow = {
        company_name: string | null;
        job_title: string | null;
        description: string | null;
      };

      const projectsPromise: Promise<ProjectRow[]> = db
        .collection<AppDoc>(Collections.projects)
        .find(
          { candidate_id: candidateId },
          { projection: { title: 1, description: 1, tech_stack: 1, impact_summary: 1 } },
        )
        .sort({ created_at: -1 })
        .limit(MAX_PROJECTS)
        .toArray()
        .then((rows) =>
          rows.map((r) => ({
            id: r._id,
            title: String(r.title ?? ""),
            description: (r.description as string | null) ?? null,
            tech_stack: (r.tech_stack as string[] | null) ?? null,
            impact_summary: (r.impact_summary as string | null) ?? null,
          })),
        );

      const experiencesPromise: Promise<ExpRow[]> = (async () => {
        try {
          const rows = await db
            .collection<AppDoc>(Collections.workExperiences)
            .find(
              { candidate_id: candidateId },
              { projection: { company_name: 1, job_title: 1, description: 1, _id: 0 } },
            )
            .limit(10)
            .toArray();
          return rows.map((r) => ({
            company_name: (r.company_name as string | null) ?? null,
            job_title: (r.job_title as string | null) ?? null,
            description: (r.description as string | null) ?? null,
          }));
        } catch {
          console.error(`[pipeline] experiences read failed for ${candidateId}`);
          return [] as ExpRow[];
        }
      })();

      const skillsPromise: Promise<string[]> = (async () => {
        try {
          const links = await db
            .collection<AppDoc>(Collections.candidateSkills)
            .find({ candidate_id: candidateId }, { projection: { skill_id: 1, _id: 0 } })
            .limit(50)
            .toArray();
          const skillIds = [...new Set(links.map((l) => String(l.skill_id ?? "")).filter(Boolean))];
          if (!skillIds.length) return [] as string[];
          const skillDocs = await db
            .collection<AppDoc>(Collections.skills)
            .find({ _id: { $in: skillIds } }, { projection: { name: 1 } })
            .toArray();
          return skillDocs.map((s) => String(s.name ?? "")).filter(Boolean);
        } catch {
          console.error(`[pipeline] skills read failed for ${candidateId}`);
          return [] as string[];
        }
      })();

      const [projects, experiences, skills] = await Promise.all([
        projectsPromise,
        experiencesPromise,
        skillsPromise,
      ]);
      return { projects, experiences, skills };
    });
    const { projects, experiences, skills } = bundle;

    const chunks = await step.run("build-chunks", async () => {
      const expText = experiences
        .slice(0, 5)
        .map((e) => `${e.job_title ?? ""} @ ${e.company_name ?? ""}`)
        .filter((s) => s.trim().length > 3)
        .join("; ");
      const base = [
        {
          candidate_id: candidateId,
          chunk_type: "summary",
          content_text: `${candidate.headline ?? ""} ${candidate.domain ?? ""} ${candidate.total_experience_years ?? ""}y Skills: ${skills.slice(0, 20).join(", ")}${expText ? ` Experience: ${expText}` : ""}`.trim().slice(0, 2000),
          metadata_json: {
            domain: candidate.domain ?? null,
            domain_tags: candidate.domain ? [candidate.domain] : [],
            technologies: skills.slice(0, 20),
          },
        },
        ...projects.map((p) => ({
          candidate_id: candidateId,
          chunk_type: "project",
          content_text: `Project: ${p.title}. ${p.description ?? ""} Tech: ${(p.tech_stack ?? []).join(", ")}. Impact: ${p.impact_summary ?? ""}`.trim().slice(0, 2000),
          metadata_json: { project_id: p.id, technologies: p.tech_stack ?? [] },
        })),
      ];
      return base.filter((c) => c.content_text.replace(/\W+/g, "").length > 10);
    });

    await step.run("summary", async () => {
      const summary = await generateCandidateSummary({
        role: candidate.headline ?? "",
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
      if (summary) {
        // onConflict "candidate_id" → upsert keyed by candidate_id; the
        // updated_at trigger on candidate_profiles is applied in $set.
        await db.collection<AppDoc>(Collections.candidateProfiles).updateOne(
          { candidate_id: candidateId },
          {
            $set: {
              candidate_id: candidateId,
              summary_markdown: summary.markdown,
              summary_json: summary.json,
              updated_at: new Date(),
            },
            $setOnInsert: { _id: randomUUID(), created_at: new Date() },
          },
          { upsert: true },
        );
      }
      return { ok: !!summary };
    });

    for (const p of projects) {
      await step.run(`project-depth-${p.id}`, async () => {
        const depth = await analyzeProjectDepth({
          title: p.title,
          description: p.description ?? "",
          tech: (p.tech_stack ?? []).join(", "),
          role: "",
          impact: p.impact_summary ?? "",
        });
        if (!depth) return { ok: false, skipped: true as const };
        await db.collection<AppDoc>(Collections.projectDepthAnalysis).updateOne(
          { project_id: p.id },
          {
            $set: {
              project_id: p.id,
              complexity_score: typeof depth.complexity_score === "number" ? depth.complexity_score : 5,
              technical_complexity: String(depth.technical_complexity ?? "medium"),
              architectural_concepts: (depth.architectural_concepts as string[]) ?? [],
              evidence_quality: String(depth.evidence_quality ?? "moderate"),
              autonomy_level: String(depth.autonomy_level ?? "unknown"),
              relevance_tags: (depth.relevance_tags as string[]) ?? [],
              raw_ai_analysis: depth,
            },
            $setOnInsert: { _id: randomUUID(), created_at: new Date() },
          },
          { upsert: true },
        );
        return { ok: true };
      });
    }

    await step.run("embed-store", async () => {
      const wev = startWideEvent("inngest/process-profile", "run");
      try {
        if (!chunks.length) {
          wev.add({ candidate_id: candidateId, embed_failed: false, degraded: false });
          wev.end({ status: 200 });
          return { embedded: 0 };
        }
        const existing = await db
          .collection<AppDoc>(Collections.profileChunks)
          .find({ candidate_id: candidateId }, { projection: { content_text: 1, embedding_dim: 1, _id: 0 } })
          .toArray();
        const oldHashes = new Set<string>();
        for (const r of existing) {
          if ((r.embedding_dim ?? EXPECTED_EMBEDDING_DIM) === EXPECTED_EMBEDDING_DIM) {
            oldHashes.add(contentHash(String(r.content_text ?? "")));
          }
        }
        const changed = chunks.filter((c) => !oldHashes.has(contentHash(c.content_text)));
        const fresh = new Set(chunks.map((c) => c.content_text));
        const stale = existing
          .map((r) => String(r.content_text ?? ""))
          .filter((t) => !fresh.has(t));
        if (!changed.length && !stale.length) {
          wev.add({ candidate_id: candidateId, embed_failed: false, degraded: false });
          wev.end({ status: 200 });
          return { embedded: 0 };
        }
        let embedded = 0;
        if (changed.length) {
          const texts: string[] = changed.map((c: { content_text: string }) => c.content_text);
          const vectors = await embedChunks(texts);
          if (vectors.length !== texts.length) {
            throw new NonRetriableError(`embedding count ${vectors.length} for ${texts.length} inputs`);
          }
          for (const v of vectors) {
            if (!v.length || v.length !== EXPECTED_EMBEDDING_DIM) {
              throw new NonRetriableError(`embedding dim ${v.length}, expected ${EXPECTED_EMBEDDING_DIM}`);
            }
          }
          const rows = changed.map((c: Record<string, unknown>, i: number) => ({
            _id: randomUUID(),
            ...c,
            embedding: vectors[i],
            embedding_model: EMBEDDING_MODEL,
            embedding_dim: vectors[i].length,
          }));
          await db.collection<AppDoc>(Collections.profileChunks).insertMany(rows);
          embedded = rows.length;
        }
        if (stale.length) {
          await db.collection<AppDoc>(Collections.profileChunks).deleteMany({
            candidate_id: candidateId,
            content_text: { $in: stale },
          });
        }
        wev.add({ candidate_id: candidateId, embed_failed: false, degraded: false });
        wev.end({ status: 200 });
        return { embedded };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        wev.add({ candidate_id: candidateId, embed_failed: true, degraded: true });
        wev.end({ status: 500, error: msg.slice(0, 200) });
        throw e;
      }
    });

    await step.run("quality-score", async () => {
      let q = 20;
      if (projects.length) q += 15;
      if (projects.some((p) => p.tech_stack?.length)) q += 10;
      if (projects.some((p) => p.impact_summary)) q += 15;
      if (projects.some((p) => p.description && p.description.length > 100)) q += 10;
      if (experiences.length) q += 10;
      if (skills.length >= 3) q += 10;
      if (candidate.headline) q += 5;
      await db.collection<AppDoc>(Collections.candidates).updateOne(
        { _id: candidateId },
        {
          $set: {
            profile_strength: Math.min(q, 100),
            freshness_updated_at: new Date(),
            updated_at: new Date(),
          },
        },
      );
    });

    const notified = await step.run("notify-ready", async () => {
      const wev = startWideEvent("inngest/process-profile", "run");
      let outcome = "skipped";
      let reason = "no recipient";
      try {
        let c: { full_name?: string; contact_email?: string } | null = null;
        try {
          const r = await db.collection<AppDoc>(Collections.candidates).findOne(
            { _id: candidateId },
            { projection: { full_name: 1, contact_email: 1, _id: 0 } },
          );
          c = r
            ? {
                full_name: (r.full_name as string | undefined) ?? undefined,
                contact_email: (r.contact_email as string | undefined) ?? undefined,
              }
            : null;
        } catch {
          c = null;
        }
        if (c?.contact_email) {
          const tpl = profileReadyEmail(c.full_name ?? "there", candidateId);
          const result = await withTimeout(sendEmail(c.contact_email, tpl.subject, tpl.html), EMAIL_TIMEOUT_MS);
          outcome = result.skipped ? "skipped" : "sent";
          reason = result.skipped ? result.reason : (result.id ?? "ok");
        }
      } catch (e) {
        outcome = "failed";
        reason = (e instanceof Error ? e.message : String(e)).slice(0, 200);
      }
      wev.add({ candidate_id: candidateId, email_outcome: outcome, email_reason: reason, degraded: outcome === "failed" });
      wev.end({ status: outcome === "failed" ? 500 : 200 });
      return { outcome, reason };
    });

    return { candidateId, chunks: chunks.length, emailed: notified.outcome };
  },
);

export const functions = [processProfile];
