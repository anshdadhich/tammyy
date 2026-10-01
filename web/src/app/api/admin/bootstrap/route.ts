import { AppDoc, col, Collections } from "@/lib/mongo";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { readJsonBody } from "@/lib/http";
import { signaturesEqual as secretsEqual } from "@/lib/api-auth";

const MAX_EMAIL_LEN = 320;

export async function GET() {
  return Response.json(
    { error: "Use POST /api/admin/bootstrap with the bootstrap secret in the x-bootstrap-secret header." },
    { status: 405 },
  );
}

export async function POST(request: Request) {
  const rl = rateLimit(request, { key: "admin-bootstrap", limit: 5, windowMs: 60 * 60_000 });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs);
  const requiredSecret = process.env.BOOTSTRAP_SECRET;
  if (!requiredSecret) {
    return Response.json(
      { error: "bootstrap closed - server not configured" },
      { status: 403 },
    );
  }
  const headerSecret = request.headers.get("x-bootstrap-secret") ?? "";
  const read = await readJsonBody(request, 4 * 1024);
  if (!read.ok) return read.response;
  const body = read.body as { token?: unknown; email?: unknown } | null;
  const bodySecret = typeof body?.token === "string" ? body.token : "";
  const provided = headerSecret || bodySecret;
  if (!provided || !secretsEqual(provided, requiredSecret)) {
    return Response.json({ error: "bootstrap closed - invalid token" }, { status: 403 });
  }
  const rawEmail =
    (typeof body?.email === "string" && body.email) ||
    new URL(request.url).searchParams.get("email") ||
    "";
  if (rawEmail.length > MAX_EMAIL_LEN) {
    return Response.json({ error: "provide a valid email that has signed up first" }, { status: 400 });
  }
  const email = rawEmail.toLowerCase().trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "provide a valid email that has signed up first" }, { status: 400 });
  }
  const allowlisted = (process.env.BOOTSTRAP_ADMIN_EMAIL ?? "").toLowerCase().trim();
  if (allowlisted && !secretsEqual(email, allowlisted)) {
    return Response.json({ error: "bootstrap closed for this email" }, { status: 403 });
  }
  const db = await col<AppDoc>(Collections.users);
  let existingAdmin: { _id: string } | null = null;
  try {
    existingAdmin = await db.findOne({ role: "admin" }, { projection: { _id: 1 } });
  } catch {
    return Response.json({ error: "bootstrap closed - try again" }, { status: 403 });
  }
  if (existingAdmin) {
    return Response.json({ error: "bootstrap closed - an admin already exists" }, { status: 403 });
  }
  let data: AppDoc | null = null;
  try {
    data = await db.findOneAndUpdate(
      { email },
      { $set: { role: "admin" } },
      { returnDocument: "after", projection: { email: 1, role: 1 } },
    );
  } catch {
    data = null;
  }
  if (!data) {
    return Response.json({ error: "email not found - sign up first" }, { status: 404 });
  }
  return Response.json({
    ok: true,
    admin: { id: data._id, email: data.email as string, role: data.role as string },
  });
}
