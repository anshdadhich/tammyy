import { AppDoc, col, Collections } from "@/lib/mongo";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { readJsonBody } from "@/lib/http";

export async function POST(request: Request) {
  const rl = rateLimit(request, { key: "candidates-lookup", limit: 10, windowMs: 10 * 60_000 });
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
    const candidates = await col<AppDoc>(Collections.candidates);
    const row = await candidates
      .find(
        { contact_email: email, visibility_status: "visible" },
        { projection: { _id: 1 } },
      )
      .sort({ created_at: -1 })
      .limit(1)
      .next();
    return Response.json({ exists: !!row?._id });
  } catch {
    return Response.json({ error: "Lookup failed. Try again." }, { status: 500 });
  }
}
