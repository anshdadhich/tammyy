import { z } from "zod";
import { randomUUID } from "crypto";
import { after } from "next/server";
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import { getDb, schema, type Db } from "@/db/client";
import { newMatchEmail, sendEmail } from "@/lib/email";
import { requireHrDb, getSessionUser } from "@/lib/auth-user";
import { rateLimitRoute } from "@/lib/rate-limit";
import { startWideEvent } from "@/lib/observe";
import { readJsonBody } from "@/lib/http";
import { withTimeout } from "@/lib/timeout";
import { encodeCursor, decodeCursor } from "@/lib/cursor";

const uuid = z.string().uuid("Must be a valid UUID");

const EMAIL_TIMEOUT_MS = 15000;

const listQuery = z.object({
  candidate_id: uuid.optional(),
  job_id: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(500).optional(),
  offset: z.coerce.number().int().min(0).max(10000).optional(),
});

const saveSchema = z.object({
  candidate_id: uuid,
  job_id: uuid.nullish(),
  notes: z.string().trim().max(2000).default(""),
});

const removeByIdSchema = z.object({ id: uuid });

const AUDIT_ACTIONS = ["search", "profile_view", "contact", "shortlist", "export", "profile_update", "upload"] as const;

type ShortlistRow = {
  id: string;
  employer_id: string | null;
  candidate_id: string;
  job_id: string | null;
  status: string | null;
  notes: string | null;
  created_at: string;
};

function serializeShortlist(r: ShortlistRow): Record<string, unknown> {
  return {
    id: r.id,
    employer_id: r.employer_id ?? null,
    candidate_id: r.candidate_id,
    job_id: r.job_id || null,
    status: r.status,
    notes: r.notes ?? null,
    created_at: r.created_at,
  };
}

async function auditBestEffort(
  row: { action: string; target_type: string; target_id: string | null; metadata: Record<string, unknown> },
): Promise<void> {
  if (!(AUDIT_ACTIONS as readonly string[]).includes(row.action)) return;
  try {
    const db = await getDb();
    await db.insert(schema.auditLogs).values({
      id: randomUUID(),
      action: row.action,
      target_type: row.target_type,
      target_id: row.target_id,
      metadata_json: row.metadata,
    });
  } catch {}
}

export async function GET(request: Request) {
  const wev = startWideEvent("shortlists", "GET");
  const session = await getSessionUser();
  const limited = await rateLimitRoute(request, {
    key: "shortlists-get",
    limit: 120,
    windowMs: 60_000,
    principal: session?.email,
  });
  if (limited) {
    wev.end({ status: limited.status });
    return limited;
  }
  const hr = await requireHrDb(session);
  if (hr instanceof Response) {
    wev.end({ status: hr.status });
    return hr;
  }
  const url = new URL(request.url);
  const raw = {
    candidate_id: url.searchParams.get("candidate_id") ?? undefined,
    job_id: url.searchParams.get("job_id") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
  };
  for (const k of Object.keys(raw) as (keyof typeof raw)[]) {
    if (raw[k] === "") raw[k] = undefined;
  }
  const parsed = listQuery.safeParse(raw);
  if (!parsed.success) {
    wev.end({ status: 400 });
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }
  const pageSize = parsed.data.limit ?? 50;
  const employerId = hr.employerId;

  const conds = [eq(schema.shortlists.employer_id, employerId)];
  if (parsed.data.candidate_id) conds.push(eq(schema.shortlists.candidate_id, parsed.data.candidate_id));
  if (parsed.data.job_id) conds.push(eq(schema.shortlists.job_id, parsed.data.job_id));
  if (parsed.data.cursor) {
    const c = decodeCursor(parsed.data.cursor);
    if (!c) {
      wev.end({ status: 400 });
      return Response.json({ error: "Invalid cursor." }, { status: 400 });
    }
    conds.push(
      or(
        lt(schema.shortlists.created_at, c.createdAt),
        and(
          eq(schema.shortlists.created_at, c.createdAt),
          lt(schema.shortlists.id, c.id),
        ),
      )!,
    );
  }

  let rows: ShortlistRow[] = [];
  try {
    const db = await getDb();
    const found = await db
      .select({
        id: schema.shortlists.id,
        employer_id: schema.shortlists.employer_id,
        candidate_id: schema.shortlists.candidate_id,
        job_id: schema.shortlists.job_id,
        status: schema.shortlists.status,
        notes: schema.shortlists.notes,
        created_at: schema.shortlists.created_at,
      })
      .from(schema.shortlists)
      .where(and(...conds))
      .orderBy(desc(schema.shortlists.created_at), desc(schema.shortlists.id))
      .offset(parsed.data.offset ?? 0)
      .limit(pageSize + 1);
    rows = found;
  } catch {
    console.error("[shortlists] list failed");
    wev.add({ degraded: true });
    wev.end({ status: 500, error: "shortlist list failed" });
    return Response.json({ error: "shortlist list failed" }, { status: 500 });
  }
  const page = rows.slice(0, pageSize);
  const candById = new Map<string, { id: string; full_name: string | null; headline: string | null }>();
  try {
    const ids = [
      ...new Set(
        page
          .map((r) => r.candidate_id)
          .filter((v): v is string => typeof v === "string"),
      ),
    ];
    if (ids.length > 0) {
      const db = await getDb();
      const found = await db
        .select({
          id: schema.candidates.id,
          full_name: schema.candidates.full_name,
          headline: schema.candidates.headline,
        })
        .from(schema.candidates)
        .where(inArray(schema.candidates.id, ids));
      for (const c of found) candById.set(c.id, c);
    }
  } catch {
    // embed degrades to null; the shortlist rows themselves still ship
  }
  const results = page.map((r) => {
    const c = candById.get(r.candidate_id);
    return {
      ...serializeShortlist(r),
      candidates: c
        ? {
            id: c.id,
            full_name: c.full_name ?? null,
            headline: c.headline ?? null,
          }
        : null,
    };
  });
  const nextCursor =
    rows.length > pageSize ? encodeCursor(rows[pageSize - 1].created_at, rows[pageSize - 1].id) : null;
  wev.add({ degraded: false });
  wev.end({ status: 200 });
  return Response.json({ results, nextCursor, degraded: false });
}

export async function POST(request: Request) {
  const wev = startWideEvent("shortlists", "POST");
  const session = await getSessionUser();
  const limited = await rateLimitRoute(request, {
    key: "shortlists-post",
    limit: 30,
    windowMs: 10 * 60_000,
    principal: session?.email,
  });
  if (limited) {
    wev.end({ status: limited.status });
    return limited;
  }
  const hr = await requireHrDb(session);
  if (hr instanceof Response) {
    wev.end({ status: hr.status });
    return hr;
  }
  const read = await readJsonBody(request, 64 * 1024);
  if (!read.ok) return read.response;
  const body = read.body;
  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) {
    wev.end({ status: 400 });
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }
  const { candidate_id, job_id, notes } = parsed.data;
  const employerId = hr.employerId;

  let candRow: { id: string } | undefined;
  let jobRow: { id: string; employer_id: string | null } | undefined;
  try {
    const db = await getDb();
    [candRow] = await db
      .select({ id: schema.candidates.id })
      .from(schema.candidates)
      .where(eq(schema.candidates.id, candidate_id))
      .limit(1);
    if (job_id) {
      [jobRow] = await db
        .select({ id: schema.jobs.id, employer_id: schema.jobs.employer_id })
        .from(schema.jobs)
        .where(eq(schema.jobs.id, job_id))
        .limit(1);
    }
  } catch {
    candRow = undefined;
    jobRow = undefined;
  }
  if (!candRow) {
    wev.end({ status: 404 });
    return Response.json({ error: "candidate not found" }, { status: 404 });
  }
  if (job_id) {
    if (!jobRow) {
      wev.end({ status: 404 });
      return Response.json({ error: "job not found" }, { status: 404 });
    }
    if (jobRow.employer_id !== employerId) {
      wev.end({ status: 403 });
      return Response.json({ error: "Job does not belong to your organization." }, { status: 403 });
    }
  }

  let saved: ShortlistRow | undefined;
  try {
    const db = await getDb();
    const inserted = await db
      .insert(schema.shortlists)
      .values({
        id: randomUUID(),
        employer_id: employerId,
        candidate_id,
        job_id: job_id ?? "",
        status: "saved",
        notes: notes || null,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) {
      saved = inserted[0];
    } else {
      [saved] = await db
        .select({
          id: schema.shortlists.id,
          employer_id: schema.shortlists.employer_id,
          candidate_id: schema.shortlists.candidate_id,
          job_id: schema.shortlists.job_id,
          status: schema.shortlists.status,
          notes: schema.shortlists.notes,
          created_at: schema.shortlists.created_at,
        })
        .from(schema.shortlists)
        .where(
          and(
            eq(schema.shortlists.employer_id, employerId),
            eq(schema.shortlists.candidate_id, candidate_id),
            eq(schema.shortlists.job_id, job_id ?? ""),
          ),
        )
        .limit(1);
    }
  } catch {
    saved = undefined;
  }
  if (!saved) {
    console.error("[shortlists] save failed");
    wev.add({ degraded: true });
    wev.end({ status: 500, error: "shortlist save failed" });
    return Response.json({ error: "shortlist save failed" }, { status: 500 });
  }
  await auditBestEffort({
    action: "shortlist",
    target_type: "shortlist",
    target_id: saved.id,
    metadata: { employer_id: employerId, candidate_id, job_id: job_id ?? null },
  });
  after(async () => {
    const bg = startWideEvent("shortlists", "POST-email");
    try {
      const db = await getDb();
      const [cc] = await db
        .select({
          full_name: schema.candidates.full_name,
          contact_email: schema.candidates.contact_email,
        })
        .from(schema.candidates)
        .where(eq(schema.candidates.id, candidate_id))
        .limit(1);
      const em = cc?.contact_email;
      if (!em) {
        bg.add({ email_outcome: "skipped", email_reason: "no recipient", degraded: false });
        bg.end({ status: 200 });
        return;
      }
      let jobTitle = "a role you match";
      let companyName = "An employer";
      try {
        const employerName = async (eid: string | null): Promise<string | null> => {
          if (!eid) return null;
          const rows = await db
            .select({ company_name: schema.employers.company_name })
            .from(schema.employers)
            .where(eq(schema.employers.id, eid))
            .limit(1);
          const cn = rows[0]?.company_name;
          return cn && cn.trim() ? cn.trim().slice(0, 120) : null;
        };
        if (job_id) {
          const jj = await db
            .select({ title: schema.jobs.title, employer_id: schema.jobs.employer_id })
            .from(schema.jobs)
            .where(eq(schema.jobs.id, job_id))
            .limit(1);
          const jt = jj[0]?.title;
          if (jt && jt.trim()) jobTitle = jt.trim().slice(0, 120);
          companyName = (await employerName(jj[0]?.employer_id ?? employerId)) ?? companyName;
        } else {
          companyName = (await employerName(employerId)) ?? companyName;
        }
      } catch {
      }
      const tpl = newMatchEmail(cc?.full_name ?? "there", jobTitle, companyName);
      const result = await withTimeout(sendEmail(em, tpl.subject, tpl.html), EMAIL_TIMEOUT_MS);
      bg.add({
        email_outcome: result.skipped ? "skipped" : "sent",
        email_reason: result.skipped ? result.reason : (result.id ?? "ok"),
        degraded: false,
      });
      bg.end({ status: 200 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      bg.add({ email_outcome: "failed", email_reason: msg.slice(0, 200), degraded: true });
      bg.end({ status: 500, error: msg.slice(0, 200) });
    }
  });
  wev.add({ degraded: false });
  wev.end({ status: 201 });
  return Response.json({ shortlist: serializeShortlist(saved) }, { status: 201 });
}

export async function DELETE(request: Request) {
  const wev = startWideEvent("shortlists", "DELETE");
  const session = await getSessionUser();
  const limited = await rateLimitRoute(request, {
    key: "shortlists-delete",
    limit: 60,
    windowMs: 60_000,
    principal: session?.email,
  });
  if (limited) {
    wev.end({ status: limited.status });
    return limited;
  }
  const hr = await requireHrDb(session);
  if (hr instanceof Response) {
    wev.end({ status: hr.status });
    return hr;
  }
  const employerId = hr.employerId;
  const url = new URL(request.url);
  const idParam = url.searchParams.get("id") ?? undefined;
  const read = await readJsonBody(request, 64 * 1024);
  if (!read.ok && read.status === 413) return read.response;
  const body = (read.ok ? read.body : null) as { id?: unknown } | null;

  if (idParam ?? body?.id) {
    const parsed = removeByIdSchema.safeParse({ id: idParam ?? body?.id });
    if (!parsed.success) {
      wev.end({ status: 400 });
      return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    }
    try {
      const db = await getDb();
      const deleted = await db
        .delete(schema.shortlists)
        .where(
          and(
            eq(schema.shortlists.id, parsed.data.id),
            eq(schema.shortlists.employer_id, employerId),
          ),
        )
        .returning({ id: schema.shortlists.id });
      if (!deleted[0]) {
        wev.end({ status: 404 });
        return Response.json({ error: "shortlist not found" }, { status: 404 });
      }
    } catch {
      console.error("[shortlists] remove failed");
      wev.add({ degraded: true });
      wev.end({ status: 500, error: "shortlist remove failed" });
      return Response.json({ error: "shortlist remove failed" }, { status: 500 });
    }
    wev.add({ degraded: false });
    wev.end({ status: 200 });
    return Response.json({ ok: true });
  }

  const parsed = saveSchema.pick({ candidate_id: true, job_id: true }).safeParse(body);
  if (!parsed.success) {
    wev.end({ status: 400 });
    return Response.json(
      { error: "provide ?id= or JSON { id } or { candidate_id, job_id? }" },
      { status: 400 },
    );
  }
  try {
    const db = await getDb();
    await db
      .delete(schema.shortlists)
      .where(
        and(
          eq(schema.shortlists.employer_id, employerId),
          eq(schema.shortlists.candidate_id, parsed.data.candidate_id),
          eq(schema.shortlists.job_id, parsed.data.job_id ?? ""),
        ),
      );
  } catch {
    console.error("[shortlists] remove failed");
    wev.add({ degraded: true });
    wev.end({ status: 500, error: "shortlist remove failed" });
    return Response.json({ error: "shortlist remove failed" }, { status: 500 });
  }
  wev.add({ degraded: false });
  wev.end({ status: 200 });
  return Response.json({ ok: true });
}

export type { Db };
