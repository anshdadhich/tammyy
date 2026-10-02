import { z } from "zod";
import { randomUUID } from "crypto";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { getSessionUser } from "@/lib/auth-user";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { normalizeEmail } from "@/lib/validators";
import { readJsonBody } from "@/lib/http";

const bodySchema = z.object({
  company_name: z.string().trim().min(2).max(200),
  company_email: z.string().trim().email().max(320).optional(),
  website: z.string().trim().max(500),
  linkedin_url: z.string().trim().max(500),
});

function validWebsite(v: string): boolean {
  try {
    const u = new URL(v);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".");
  } catch {
    return false;
  }
}

function validLinkedin(v: string): boolean {
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    if (!u.hostname.toLowerCase().endsWith("linkedin.com")) return false;
    return u.pathname.trim().replace(/\//g, "").length > 0;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const rl = await rateLimit(request, { key: "employers-register", limit: 10, windowMs: 10 * 60_000 });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs);
  const session = await getSessionUser();
  if (!session || !session.userRow) {
    return Response.json({ error: "Sign in first." }, { status: 401 });
  }
  if (session.userRow.role === "admin") {
    return Response.json({ error: "Admins cannot register as employers." }, { status: 403 });
  }
  const read = await readJsonBody(request, 16 * 1024);
  if (!read.ok) return read.response;
  const body = read.body;
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }
  if (!validWebsite(parsed.data.website)) {
    return Response.json({ error: "Enter a valid company website URL." }, { status: 400 });
  }
  if (!validLinkedin(parsed.data.linkedin_url)) {
    return Response.json({ error: "Enter a valid LinkedIn profile or company URL." }, { status: 400 });
  }
  let existing: { id: string; verification_status: string } | undefined;
  try {
    const db = await getDb();
    const rows = await db
      .select({
        id: schema.employers.id,
        verification_status: schema.employers.verification_status,
      })
      .from(schema.employers)
      .where(eq(schema.employers.user_id, session.userRow.id))
      .orderBy(desc(schema.employers.created_at))
      .limit(1);
    existing = rows[0];
  } catch {
    existing = undefined;
  }
  if (existing?.id) {
    return Response.json({
      employerId: existing.id,
      status: String(existing.verification_status ?? "pending"),
    });
  }
  const companyEmail = parsed.data.company_email ? normalizeEmail(parsed.data.company_email) : "";
  let createdId: string | null = null;
  try {
    const db = await getDb();
    createdId = randomUUID();
    await db.insert(schema.employers).values({
      id: createdId,
      user_id: session.userRow.id,
      company_name: parsed.data.company_name,
      company_email: companyEmail || session.email,
      website: parsed.data.website,
      linkedin_url: parsed.data.linkedin_url,
      verification_status: "pending",
    });
  } catch {
    createdId = null;
  }
  if (!createdId) {
    return Response.json({ error: "Could not register company." }, { status: 500 });
  }
  const employerId = createdId;
  if (session.userRow.role === "candidate") {
    // A candidate profile is owned via role === "candidate". Flipping the
    // role would silently brick the owner's own talent page (viewerFor drops
    // the owner branch for employer/admin roles), so require a separate email
    // for hiring instead of destroying profile access.
    let owned: { id: string } | undefined;
    try {
      const db = await getDb();
      const rows = await db
        .select({ id: schema.candidates.id })
        .from(schema.candidates)
        .where(eq(schema.candidates.user_id, session.userRow.id))
        .limit(1);
      owned = rows[0];
    } catch {
      owned = undefined;
    }
    if (owned?.id) {
      try {
        const db = await getDb();
        await db.delete(schema.employers).where(eq(schema.employers.id, employerId));
      } catch {
      }
      return Response.json(
        { error: "This email owns a candidate profile. Use a different email for hiring." },
        { status: 403 },
      );
    }
    try {
      const db = await getDb();
      await db
        .update(schema.users)
        .set({ role: "employer" })
        .where(eq(schema.users.id, session.userRow.id));
    } catch {
    }
  }
  return Response.json({ employerId, status: "pending" }, { status: 201 });
}
