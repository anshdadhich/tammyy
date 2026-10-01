import { z } from "zod";
import { randomUUID } from "crypto";
import { after } from "next/server";
import type { Filter } from "mongodb";
import { AppDoc, col, Collections } from "@/lib/mongo";
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

/** `shortlists` row (Postgres columns kept verbatim, `_id` = former `id`). */
type ShortlistDoc = {
  _id: string;
  employer_id: string | null;
  candidate_id: string;
  job_id: string | null;
  status: string;
  notes: string | null;
  created_at: Date | string;
};

type JobDoc = { _id: string; employer_id: string | null; title?: string | null };

type CandidateDoc = {
  _id: string;
  full_name?: string | null;
  headline?: string | null;
  contact_email?: string | null;
};

const SHORTLIST_PROJECTION = {
  employer_id: 1,
  candidate_id: 1,
  job_id: 1,
  status: 1,
  notes: 1,
  created_at: 1,
} as const;

function isoOf(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function serializeShortlist(r: ShortlistDoc): Record<string, unknown> {
  return {
    id: r._id,
    employer_id: r.employer_id ?? null,
    candidate_id: r.candidate_id,
    job_id: r.job_id ?? null,
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
    const auditLogs = await col<AppDoc>(Collections.auditLogs);
    await auditLogs.insertOne({ _id: randomUUID(), ...row, created_at: new Date() });
  } catch {}
}

export async function GET(request: Request) {
  const wev = startWideEvent("shortlists", "GET");
  const session = await getSessionUser();
  const limited = rateLimitRoute(request, {
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
  const filter: Filter<ShortlistDoc> = { employer_id: employerId };
  if (parsed.data.candidate_id) filter.candidate_id = parsed.data.candidate_id;
  if (parsed.data.job_id) filter.job_id = parsed.data.job_id;
  if (parsed.data.cursor) {
    const c = decodeCursor(parsed.data.cursor);
    if (!c) {
      wev.end({ status: 400 });
      return Response.json({ error: "Invalid cursor." }, { status: 400 });
    }
    filter.$or = [
      { created_at: { $lt: new Date(c.createdAt) } },
      { created_at: new Date(c.createdAt), _id: { $lt: c.id } },
    ];
  }
  let rows: ShortlistDoc[] = [];
  try {
    const shortlists = await col<ShortlistDoc>(Collections.shortlists);
    let q = shortlists
      .find(filter, { projection: SHORTLIST_PROJECTION })
      .sort({ created_at: -1, _id: -1 });
    if (parsed.data.cursor) {
      q = q.limit(pageSize + 1);
    } else if (parsed.data.offset !== undefined) {
      q = q.skip(parsed.data.offset).limit(pageSize + 1);
    } else {
      q = q.limit(pageSize + 1);
    }
    rows = await q.toArray();
  } catch {
    console.error("[shortlists] list failed");
    wev.add({ degraded: true });
    wev.end({ status: 500, error: "shortlist list failed" });
    return Response.json({ error: "shortlist list failed" }, { status: 500 });
  }
  const page = rows.slice(0, pageSize);
  // Former embedded join `candidates(id, full_name, headline)` → $in query.
  const candById = new Map<string, CandidateDoc>();
  try {
    const ids = [
      ...new Set(
        page
          .map((r) => r.candidate_id)
          .filter((v): v is string => typeof v === "string"),
      ),
    ];
    if (ids.length > 0) {
      const candidates = await col<CandidateDoc>(Collections.candidates);
      const found = await candidates
        .find({ _id: { $in: ids } }, { projection: { full_name: 1, headline: 1 } })
        .toArray();
      for (const c of found) candById.set(c._id, c);
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
            id: c._id,
            full_name: c.full_name ?? null,
            headline: c.headline ?? null,
          }
        : null,
    };
  });
  const nextCursor =
    rows.length > pageSize
      ? encodeCursor(isoOf(rows[pageSize - 1].created_at), rows[pageSize - 1]._id)
      : null;
  wev.add({ degraded: false });
  wev.end({ status: 200 });
  return Response.json({ results, nextCursor, degraded: false });
}

export async function POST(request: Request) {
  const wev = startWideEvent("shortlists", "POST");
  const session = await getSessionUser();
  const limited = rateLimitRoute(request, {
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

  // Existence checks; a read failure falls into the same branches the old
  // `.maybeSingle()` error→null paths took.
  let candRow: { _id: string } | null = null;
  let jobRow: JobDoc | null = null;
  try {
    const candidates = await col<{ _id: string }>(Collections.candidates);
    const jobs = await col<JobDoc>(Collections.jobs);
    [candRow, jobRow] = await Promise.all([
      candidates.findOne({ _id: candidate_id }, { projection: { _id: 1 } }),
      job_id
        ? jobs.findOne({ _id: job_id }, { projection: { employer_id: 1 } })
        : Promise.resolve(null),
    ]);
  } catch {
    candRow = null;
    jobRow = null;
  }
  if (!candRow) {
    wev.end({ status: 404 });
    return Response.json({ error: "candidate not found" }, { status: 404 });
  }
  if (job_id) {
    const job = jobRow;
    if (!job) {
      wev.end({ status: 404 });
      return Response.json({ error: "job not found" }, { status: 404 });
    }
    if (job.employer_id !== employerId) {
      wev.end({ status: 403 });
      return Response.json({ error: "Job does not belong to your organization." }, { status: 403 });
    }
  }

  let existing: ShortlistDoc | null = null;
  try {
    const shortlists = await col<ShortlistDoc>(Collections.shortlists);
    existing = await shortlists.findOne(
      { employer_id: employerId, candidate_id, job_id: job_id ?? null },
      { projection: SHORTLIST_PROJECTION },
    );
  } catch {
    existing = null;
  }
  if (existing) {
    wev.add({ degraded: false });
    wev.end({ status: 200 });
    return Response.json({ shortlist: serializeShortlist(existing), deduped: true });
  }

  // Former UNIQUE(employer_id, candidate_id, job_id) insert → upsert.
  let saved: ShortlistDoc | null = null;
  try {
    const shortlists = await col<ShortlistDoc>(Collections.shortlists);
    saved = await shortlists.findOneAndUpdate(
      { employer_id: employerId, candidate_id, job_id: job_id ?? null },
      {
        $setOnInsert: {
          employer_id: employerId,
          candidate_id,
          job_id: job_id ?? null,
          status: "saved",
          notes: notes || null,
          created_at: new Date(),
        },
      },
      { upsert: true, returnDocument: "after" },
    );
  } catch {
    saved = null;
  }
  if (!saved) {
    console.error("[shortlists] save failed");
    wev.add({ degraded: true });
    wev.end({ status: 500, error: "shortlist save failed" });
    return Response.json({ error: "shortlist save failed" }, { status: 500 });
  }
  const shortlistId = saved._id;
  await auditBestEffort({
    action: "shortlist",
    target_type: "shortlist",
    target_id: shortlistId,
    metadata: { employer_id: employerId, candidate_id, job_id: job_id ?? null },
  });
  after(async () => {
    const bg = startWideEvent("shortlists", "POST-email");
    try {
      const candidates = await col<CandidateDoc>(Collections.candidates);
      const cc = await candidates.findOne(
        { _id: candidate_id },
        { projection: { full_name: 1, contact_email: 1 } },
      );
      const em = cc?.contact_email;
      if (!em) {
        bg.add({ email_outcome: "skipped", email_reason: "no recipient", degraded: false });
        bg.end({ status: 200 });
        return;
      }
      let jobTitle = "a role you match";
      let companyName = "An employer";
      try {
        if (job_id) {
          const jobs = await col<JobDoc>(Collections.jobs);
          const jj = await jobs.findOne(
            { _id: job_id },
            { projection: { title: 1, employer_id: 1 } },
          );
          const jt = jj?.title;
          if (jt && jt.trim()) jobTitle = jt.trim().slice(0, 120);
          const eid = jj?.employer_id ?? employerId;
          if (eid) {
            const employers = await col<{ _id: string; company_name?: string | null }>(
              Collections.employers,
            );
            const ee = await employers.findOne(
              { _id: eid },
              { projection: { company_name: 1 } },
            );
            const cn = ee?.company_name;
            if (cn && cn.trim()) companyName = cn.trim().slice(0, 120);
          }
        } else {
          const employers = await col<{ _id: string; company_name?: string | null }>(
            Collections.employers,
          );
          const ee = await employers.findOne(
            { _id: employerId },
            { projection: { company_name: 1 } },
          );
          const cn = ee?.company_name;
          if (cn && cn.trim()) companyName = cn.trim().slice(0, 120);
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
  const limited = rateLimitRoute(request, {
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
    let row: { _id: string; employer_id: string | null } | null = null;
    try {
      const shortlists = await col<ShortlistDoc>(Collections.shortlists);
      row = await shortlists.findOne(
        { _id: parsed.data.id },
        { projection: { employer_id: 1 } },
      );
    } catch {
      row = null;
    }
    const owned = row?.employer_id === employerId;
    if (!row || !owned) {
      wev.end({ status: 404 });
      return Response.json({ error: "shortlist not found" }, { status: 404 });
    }
    try {
      const shortlists = await col<ShortlistDoc>(Collections.shortlists);
      await shortlists.deleteMany({ _id: parsed.data.id, employer_id: employerId });
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
    const shortlists = await col<ShortlistDoc>(Collections.shortlists);
    await shortlists.deleteMany({
      employer_id: employerId,
      candidate_id: parsed.data.candidate_id,
      job_id: parsed.data.job_id ?? null,
    });
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
