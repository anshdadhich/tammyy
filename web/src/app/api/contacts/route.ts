import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { after } from "next/server";
import { and, desc, eq, gte, isNull, lt, or, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { contactLoggedEmail, sendEmail } from "@/lib/email";
import { requireHrDb, requireOwnerDb, getSessionUser } from "@/lib/auth-user";
import { rateLimit, rateLimitRoute } from "@/lib/rate-limit";
import { startWideEvent } from "@/lib/observe";
import { withTimeout } from "@/lib/timeout";
import { readJsonBody } from "@/lib/http";
import { encodeCursor, decodeCursor } from "@/lib/cursor";

const EMAIL_TIMEOUT_MS = 15000;
const IDEMPOTENCY_WINDOW_MS = 10 * 60_000;

const bodySchema = z.object({
  candidate_id: z.string().uuid(),
  job_id: z.string().uuid().nullish(),
  channel: z.enum(["email", "phone", "platform", "other"]).default("platform"),
  message: z.string().trim().max(4000).default(""),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(500).optional(),
  offset: z.coerce.number().int().min(0).max(10000).optional(),
});

const AUDIT_ACTIONS = ["search", "profile_view", "contact", "shortlist", "export", "profile_update", "upload"] as const;

type ContactLogRow = {
  id: string;
  employer_id: string | null;
  candidate_id: string | null;
  job_id: string | null;
  channel: string;
  message: string | null;
  created_at: string;
};

type WideEvent = ReturnType<typeof startWideEvent>;

function serializeContactLog(r: ContactLogRow): Record<string, unknown> {
  return {
    id: r.id,
    employer_id: r.employer_id ?? null,
    candidate_id: r.candidate_id ?? null,
    job_id: r.job_id ?? null,
    channel: r.channel,
    message: r.message ?? null,
    created_at: r.created_at,
  };
}

function messageHash(channel: string, message: string): string {
  return createHash("sha256").update(`${channel}|${message}`, "utf8").digest("hex");
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

type ListOutcome =
  | { kind: "ok"; rows: ContactLogRow[] }
  | { kind: "invalid-cursor" }
  | { kind: "failed" };

/** Shared list query for the owner and HR branches of GET. */
async function runContactList(
  base: SQL[],
  page: { cursor?: string | undefined; offset?: number | undefined },
  pageSize: number,
): Promise<ListOutcome> {
  const conds = [...base];
  if (page.cursor) {
    const c = decodeCursor(page.cursor);
    if (!c) return { kind: "invalid-cursor" };
    conds.push(
      or(
        lt(schema.contactLog.created_at, c.createdAt),
        and(
          eq(schema.contactLog.created_at, c.createdAt),
          lt(schema.contactLog.id, c.id),
        ),
      )!,
    );
  }
  try {
    const db = await getDb();
    const rows = await db
      .select({
        id: schema.contactLog.id,
        employer_id: schema.contactLog.employer_id,
        candidate_id: schema.contactLog.candidate_id,
        job_id: schema.contactLog.job_id,
        channel: schema.contactLog.channel,
        message: schema.contactLog.message,
        created_at: schema.contactLog.created_at,
      })
      .from(schema.contactLog)
      .where(and(...conds))
      .orderBy(desc(schema.contactLog.created_at), desc(schema.contactLog.id))
      .offset(page.offset ?? 0)
      .limit(pageSize + 1);
    return { kind: "ok", rows };
  } catch {
    return { kind: "failed" };
  }
}

function respondContactList(
  wev: WideEvent,
  rows: ContactLogRow[],
  pageSize: number,
): Response {
  const page = rows.slice(0, pageSize);
  const nextCursor =
    rows.length > pageSize
      ? encodeCursor(rows[pageSize - 1].created_at, rows[pageSize - 1].id)
      : null;
  wev.add({ degraded: false });
  wev.end({ status: 200 });
  return Response.json({ results: page.map(serializeContactLog), nextCursor, degraded: false });
}

function listFailure(wev: WideEvent): Response {
  console.error("[contacts] list failed");
  wev.add({ degraded: true });
  wev.end({ status: 500, error: "contact list failed" });
  return Response.json({ error: "contact list failed" }, { status: 500 });
}

function invalidCursor(wev: WideEvent): Response {
  wev.end({ status: 400 });
  return Response.json({ error: "Invalid cursor." }, { status: 400 });
}

export async function POST(request: Request) {
  const wev = startWideEvent("contacts", "POST");
  const session = await getSessionUser();
  const limited = await rateLimitRoute(request, {
    key: "contacts-post",
    limit: 20,
    windowMs: 10 * 60_000,
    principal: session?.email,
  });
  if (limited) {
    wev.end({ status: limited.status });
    return limited;
  }
  const read = await readJsonBody(request, 64 * 1024);
  if (!read.ok) {
    wev.end({ status: read.status });
    return read.response;
  }
  const body = read.body;
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    wev.end({ status: 400 });
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }
  const hr = await requireHrDb(session);
  if (hr instanceof Response) {
    wev.end({ status: hr.status });
    return hr;
  }
  const employerId = hr.employerId;
  const { candidate_id, job_id, channel, message } = parsed.data;

  const perTarget = await rateLimit(request, {
    key: `contacts-post-target:${candidate_id}`,
    limit: 5,
    windowMs: 10 * 60_000,
    principal: hr.user.email,
  });
  if (!perTarget.ok) {
    wev.end({ status: 429 });
    return Response.json(
      { error: "Too many requests. Slow down and try again." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(perTarget.retryAfterMs / 1000)) },
      },
    );
  }

  // Existence checks; a read failure falls into the same branches the old
  // error→null paths took.
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

  // Idempotency window: recent identical messages dedupe to the old row.
  const windowStart = new Date(Date.now() - IDEMPOTENCY_WINDOW_MS).toISOString();
  let recent: { id: string; channel: string; message: string | null }[] = [];
  try {
    const db = await getDb();
    recent = await db
      .select({
        id: schema.contactLog.id,
        channel: schema.contactLog.channel,
        message: schema.contactLog.message,
      })
      .from(schema.contactLog)
      .where(
        and(
          eq(schema.contactLog.employer_id, employerId),
          eq(schema.contactLog.candidate_id, candidate_id),
          job_id
            ? eq(schema.contactLog.job_id, job_id)
            : isNull(schema.contactLog.job_id),
          gte(schema.contactLog.created_at, windowStart),
        ),
      )
      .orderBy(desc(schema.contactLog.created_at))
      .limit(20);
  } catch {
    recent = [];
  }
  const incoming = messageHash(channel, message || "");
  const dupe = recent.find((r) => messageHash(r.channel, r.message ?? "") === incoming);
  if (dupe) {
    wev.add({ degraded: false });
    wev.end({ status: 200 });
    return Response.json({ id: dupe.id, status: "logged", deduped: true });
  }

  let contactId: string | null = null;
  try {
    const db = await getDb();
    contactId = randomUUID();
    await db.insert(schema.contactLog).values({
      id: contactId,
      employer_id: employerId,
      candidate_id,
      job_id: job_id ?? null,
      channel,
      message: message || null,
      message_hash: incoming,
    });
  } catch {
    contactId = null;
  }

  if (!contactId) {
    console.error("[contacts] log failed");
    wev.add({ degraded: true });
    wev.end({ status: 500, error: "contact log failed" });
    return Response.json(
      { error: "contact log failed" },
      { status: 500 },
    );
  }
  await auditBestEffort({
    action: "contact",
    target_type: "contact",
    target_id: contactId,
    metadata: { employer_id: employerId, candidate_id, job_id: job_id ?? null, channel },
  });

  after(async () => {
    const bg = startWideEvent("contacts", "POST-email");
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
      let jobTitle: string | null = null;
      let company: string | null = null;
      if (job_id) {
        const jj = await db
          .select({ title: schema.jobs.title, employer_id: schema.jobs.employer_id })
          .from(schema.jobs)
          .where(eq(schema.jobs.id, job_id))
          .limit(1);
        jobTitle = jj[0]?.title ?? null;
        const eid = jj[0]?.employer_id;
        if (eid) {
          const ee = await db
            .select({ company_name: schema.employers.company_name })
            .from(schema.employers)
            .where(eq(schema.employers.id, eid))
            .limit(1);
          company = ee[0]?.company_name ?? null;
        }
      }
      if (!cc?.contact_email) {
        bg.add({ email_outcome: "skipped", email_reason: "no recipient", degraded: false });
        bg.end({ status: 200 });
        return;
      }
      const tpl = contactLoggedEmail(cc.full_name ?? "there", {
        jobTitle,
        company,
        channel,
      });
      const result = await withTimeout(sendEmail(cc.contact_email, tpl.subject, tpl.html), EMAIL_TIMEOUT_MS);
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
  return Response.json(
    { id: contactId, status: "logged" },
    { status: 201 },
  );
}

export async function GET(request: Request) {
  const wev = startWideEvent("contacts", "GET");
  const session = await getSessionUser();
  const limited = await rateLimitRoute(request, {
    key: "contacts-get",
    limit: 60,
    windowMs: 60_000,
    principal: session?.email,
  });
  if (limited) {
    wev.end({ status: limited.status });
    return limited;
  }
  if (!session) {
    wev.end({ status: 401 });
    return Response.json({ error: "Sign in to view contact logs." }, { status: 401 });
  }
  const viewer = session.viewer;
  const url = new URL(request.url);
  const candidate_id = url.searchParams.get("candidate_id");
  if (!candidate_id) {
    wev.end({ status: 400 });
    return Response.json({ error: "candidate_id is required." }, { status: 400 });
  }
  // Reject garbage up front: without this an invalid uuid falls into a
  // filter that surfaces as a misleading 403 (owner path) or 500 (HR path).
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate_id)) {
    wev.end({ status: 400 });
    return Response.json({ error: "candidate_id must be a valid UUID." }, { status: 400 });
  }
  const raw = {
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
  if (viewer.kind === "owner") {
    const owned = await requireOwnerDb(candidate_id, session);
    if (owned instanceof Response) {
      wev.end({ status: 403 });
      return Response.json({ error: "You can only view your own contact logs." }, { status: 403 });
    }
    const outcome = await runContactList(
      [eq(schema.contactLog.candidate_id, candidate_id)],
      parsed.data,
      pageSize,
    );
    if (outcome.kind === "invalid-cursor") return invalidCursor(wev);
    if (outcome.kind === "failed") return listFailure(wev);
    return respondContactList(wev, outcome.rows, pageSize);
  }
  const hr = await requireHrDb(session);
  if (hr instanceof Response) {
    wev.end({ status: hr.status });
    return hr;
  }
  const outcome = await runContactList(
    [
      eq(schema.contactLog.candidate_id, candidate_id),
      eq(schema.contactLog.employer_id, hr.employerId),
    ],
    parsed.data,
    pageSize,
  );
  if (outcome.kind === "invalid-cursor") return invalidCursor(wev);
  if (outcome.kind === "failed") return listFailure(wev);
  return respondContactList(wev, outcome.rows, pageSize);
}
