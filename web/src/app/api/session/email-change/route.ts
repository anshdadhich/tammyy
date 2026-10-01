import { z } from "zod";
import { issueEmailChangeToken } from "@/lib/api-auth";
import { getSessionUser, requireOwnerDb } from "@/lib/auth-user";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { normalizeEmail } from "@/lib/validators";
import { AppDoc, col, Collections } from "@/lib/mongo";
import { readJsonBody } from "@/lib/http";

const bodySchema = z.object({
  id: z.string().uuid(),
  newEmail: z.string().trim().email().max(320),
});

export async function POST(request: Request) {
  const rl = rateLimit(request, { key: "session-email-change", limit: 10, windowMs: 10 * 60_000 });
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
    const candidates = await col<{ _id: string; contact_email?: string | null }>(
      Collections.candidates,
    );
    const row = await candidates.findOne(
      { _id: parsed.data.id },
      { projection: { contact_email: 1 } },
    );
    current = normalizeEmail(row?.contact_email ?? "");
  } catch {
    current = "";
  }
  if (!newEmail || newEmail === current) {
    return Response.json({ error: "That is already the email on this profile." }, { status: 400 });
  }
  let clash: AppDoc | null = null;
  try {
    const users = await col<AppDoc>(Collections.users);
    clash = await users.findOne({ email: newEmail }, { projection: { _id: 1 } });
  } catch {
    clash = null;
  }
  if (clash?._id) {
    return Response.json({ error: "That email is already in use." }, { status: 409 });
  }
  const token = issueEmailChangeToken(parsed.data.id, newEmail);
  if (!token) {
    return Response.json({ error: "Try again shortly." }, { status: 503 });
  }
  return Response.json({ token });
}
