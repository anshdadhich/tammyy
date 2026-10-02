import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { AuthError, requireRole } from "@/lib/auth";
import { getDb, schema } from "@/db/client";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { z } from "zod";
import { readJsonBody } from "@/lib/http";
import { PLAN_LIMITS, setEmployerPlan, type PlanName } from "@/lib/quotas";
import { listAdminEmployers } from "@/lib/admin-employers";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_VALUES = ["pending", "verified", "rejected", "suspended", "all"] as const;

export async function GET(request: Request) {
  const rl = await rateLimit(request, { key: "admin-employers-get", limit: 30, windowMs: 60_000 });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs);
  try {
    await requireRole("admin");
  } catch (e) {
    const status = e instanceof AuthError ? e.status : 401;
    return Response.json({ error: (e as Error).message }, { status });
  }
  const url = new URL(request.url);
  const rawStatus = url.searchParams.get("status") ?? "pending";
  const statusFilter = (STATUS_VALUES as readonly string[]).includes(rawStatus) ? rawStatus : "pending";
  const rawLimit = Number(url.searchParams.get("limit") ?? 100);
  const pageLimit = Math.min(Math.max(Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 100, 1), 100);
  try {
    const employers = await listAdminEmployers(
      statusFilter as (typeof STATUS_VALUES)[number],
      pageLimit,
    );
    return Response.json({ employers });
  } catch {
    console.error("[admin] employers list failed");
    return Response.json({ error: "employers list failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const rl = await rateLimit(request, { key: "admin-employers-post", limit: 30, windowMs: 10 * 60_000 });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs);
  try {
    await requireRole("admin");
  } catch (e) {
    const status = e instanceof AuthError ? e.status : 401;
    return Response.json({ error: (e as Error).message }, { status });
  }
  const read = await readJsonBody(request, 4 * 1024);
  if (!read.ok) return read.response;
  const body = read.body;
  const parsed = z.object({
    employerId: z.string().regex(UUID_RE),
    action: z.enum(["verify", "reject", "set_plan"]),
    plan: z.enum(["free", "basic", "pro"]).optional(),
  }).safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }
  const { employerId, action } = parsed.data;
  if (action === "set_plan") {
    if (!parsed.data.plan || !(parsed.data.plan in PLAN_LIMITS)) {
      return Response.json({ error: "plan must be free, basic, or pro" }, { status: 400 });
    }
    const ok = await setEmployerPlan(employerId, parsed.data.plan as PlanName);
    if (!ok) return Response.json({ error: "plan update failed" }, { status: 500 });
    return Response.json({ employerId, plan: parsed.data.plan });
  }
  let data: { id: string; company_name?: string | null; verification_status?: string } | undefined;
  try {
    const db = await getDb();
    const updated = await db
      .update(schema.employers)
      .set({
        verification_status: action === "verify" ? "verified" : "rejected",
        updated_at: new Date().toISOString(),
      })
      .where(eq(schema.employers.id, employerId))
      .returning({
        id: schema.employers.id,
        company_name: schema.employers.company_name,
        verification_status: schema.employers.verification_status,
      });
    data = updated[0];
  } catch {
    data = undefined;
  }
  if (!data) {
    console.error("[admin] employer update failed");
    return Response.json({ error: "employer not found" }, { status: 404 });
  }
  const employer = {
    id: data.id,
    company_name: data.company_name ?? null,
    verification_status: data.verification_status ?? null,
  };

  try {
    const db = await getDb();
    await db.insert(schema.auditLogs).values({
      id: randomUUID(),
      action: action === "verify" ? "employer_verified" : "employer_rejected",
      target_type: "employer",
      target_id: employerId,
      metadata_json: { company_name: employer.company_name },
    });
  } catch {
  }
  return Response.json({ employer });
}
