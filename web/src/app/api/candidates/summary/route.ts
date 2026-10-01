import { z } from "zod";
import { inngest } from "@/lib/inngest";
import { AppDoc, col, Collections } from "@/lib/mongo";
import { guardOwnerAuth } from "@/lib/api-auth";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { readJsonBody } from "@/lib/http";

const uuid = z.string().uuid("Must be a valid UUID");

export async function POST(request: Request) {
  const rl = rateLimit(request, { key: "candidates-summary", limit: 5, windowMs: 60 * 60_000 });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs);
  const read = await readJsonBody(request, 4 * 1024);
  if (!read.ok) return read.response;
  const body = read.body;
  const parsed = z.object({ id: uuid }).safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }
  const denied = await guardOwnerAuth(request, parsed.data.id);
  if (denied) return denied;
  let existing: { _id: string } | null = null;
  try {
    const candidates = await col<AppDoc>(Collections.candidates);
    existing = await candidates.findOne({ _id: parsed.data.id }, { projection: { _id: 1 } });
  } catch {
    existing = null;
  }
  if (!existing) return Response.json({ error: "candidate not found" }, { status: 404 });
  try {
    await inngest.send({ name: "candidate.profile.submitted", data: { candidateId: parsed.data.id } });
  } catch {
    return Response.json({ error: "Could not start regeneration. Try again." }, { status: 502 });
  }
  return Response.json({ ok: true });
}
