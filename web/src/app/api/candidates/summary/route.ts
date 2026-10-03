import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db/client";
import { cfEnv } from "@/lib/cf";
import { enqueueProfilePipeline } from "@/lib/pipeline";
import { guardOwnerAuth } from "@/lib/api-auth";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { readJsonBody } from "@/lib/http";

const uuid = z.string().uuid("Must be a valid UUID");

export async function POST(request: Request) {
  const rl = await rateLimit(request, { key: "candidates-summary", limit: 5, windowMs: 60 * 60_000 });
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
  let existing: { id: string } | undefined;
  try {
    const db = await getDb();
    const rows = await db
      .select({ id: schema.candidates.id })
      .from(schema.candidates)
      .where(eq(schema.candidates.id, parsed.data.id))
      .limit(1);
    existing = rows[0];
  } catch {
    existing = undefined;
  }
  if (!existing) return Response.json({ error: "candidate not found" }, { status: 404 });
  try {
    const env = await cfEnv();
    await enqueueProfilePipeline(env, parsed.data.id);
  } catch {
    return Response.json({ error: "Could not start regeneration. Try again." }, { status: 502 });
  }
  return Response.json({ ok: true });
}
