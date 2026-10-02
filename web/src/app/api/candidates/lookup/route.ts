import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { readJsonBody } from "@/lib/http";

export async function POST(request: Request) {
  const rl = await rateLimit(request, { key: "candidates-lookup", limit: 10, windowMs: 10 * 60_000 });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs);
  const read = await readJsonBody(request, 4 * 1024);
  if (!read.ok) return read.response;
  const body = read.body as { email?: unknown } | null;
  const raw = typeof body?.email === "string" ? body.email : "";
  if (raw.length > 320) {
    return Response.json({ error: "Enter a valid email." }, { status: 400 });
  }
  const email = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "Enter a valid email." }, { status: 400 });
  }
  try {
    const db = await getDb();
    const rows = await db
      .select({ id: schema.candidates.id })
      .from(schema.candidates)
      .where(
        and(
          eq(schema.candidates.contact_email, email),
          eq(schema.candidates.visibility_status, "visible"),
        ),
      )
      .orderBy(desc(schema.candidates.created_at))
      .limit(1);
    return Response.json({ exists: !!rows[0]?.id });
  } catch {
    return Response.json({ error: "Lookup failed. Try again." }, { status: 500 });
  }
}
