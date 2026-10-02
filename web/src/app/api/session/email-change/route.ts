import { z } from "zod";
import { issueEmailChangeToken } from "@/lib/api-auth";
import { getSessionUser, requireOwnerDb } from "@/lib/auth-user";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { normalizeEmail } from "@/lib/validators";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { readJsonBody } from "@/lib/http";

const bodySchema = z.object({
  id: z.string().uuid(),
  newEmail: z.string().trim().email().max(320),
});

export async function POST(request: Request) {
  const rl = await rateLimit(request, { key: "session-email-change", limit: 10, windowMs: 10 * 60_000 });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs);
  const session = await getSessionUser();
  const read = await readJsonBody(request, 4 * 1024);
  if (!read.ok) return read.response;
  const body = read.body;
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }
  if (!session) {
    return Response.json({ error: "Sign in to manage this profile." }, { status: 401 });
  }
  if (session.viewer.kind !== "owner" || session.viewer.id !== parsed.data.id) {
    return Response.json({ error: "Sign in as this profile owner first." }, { status: 403 });
  }
  const gate = await requireOwnerDb(parsed.data.id, session);
  if (gate instanceof Response) {
    return Response.json({ error: "Sign in as this profile owner first." }, { status: 403 });
  }
  const newEmail = normalizeEmail(parsed.data.newEmail);
  if (!newEmail || newEmail.length > 320) {
    return Response.json({ error: "Enter a valid email." }, { status: 400 });
  }
  let current = "";
  try {
    const db = await getDb();
    const rows = await db
      .select({ contact_email: schema.candidates.contact_email })
      .from(schema.candidates)
      .where(eq(schema.candidates.id, parsed.data.id))
      .limit(1);
    current = normalizeEmail(rows[0]?.contact_email ?? "");
  } catch {
    current = "";
  }
  if (!newEmail || newEmail === current) {
    return Response.json({ error: "That is already the email on this profile." }, { status: 400 });
  }
  let clash: { id: string } | undefined;
  try {
    const db = await getDb();
    const rows = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, newEmail))
      .limit(1);
    clash = rows[0];
  } catch {
    clash = undefined;
  }
  if (clash?.id) {
    return Response.json({ error: "That email is already in use." }, { status: 409 });
  }
  const token = issueEmailChangeToken(parsed.data.id, newEmail);
  if (!token) {
    return Response.json({ error: "Try again shortly." }, { status: 503 });
  }
  return Response.json({ token });
}
