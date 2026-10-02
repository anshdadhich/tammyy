import { asc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";

export type AdminEmployer = {
  id: string;
  plan: string | null;
  company_name: string | null;
  company_email: string | null;
  website: string | null;
  linkedin_url: string | null;
  company_size: string | null;
  industry: string | null;
  verification_status: string | null;
  created_at: string | null;
  account_email: string | null;
};

export async function listAdminEmployers(
  status: "pending" | "verified" | "rejected" | "suspended" | "all" = "pending",
  limit = 100,
): Promise<AdminEmployer[]> {
  const db = await getDb();
  const capped = Math.min(Math.max(Math.floor(limit), 1), 100);
  const rows = await db
    .select({
      id: schema.employers.id,
      user_id: schema.employers.user_id,
      company_name: schema.employers.company_name,
      company_email: schema.employers.company_email,
      website: schema.employers.website,
      linkedin_url: schema.employers.linkedin_url,
      company_size: schema.employers.company_size,
      industry: schema.employers.industry,
      verification_status: schema.employers.verification_status,
      created_at: schema.employers.created_at,
    })
    .from(schema.employers)
    .where(status !== "all" ? eq(schema.employers.verification_status, status) : undefined)
    .orderBy(asc(schema.employers.created_at))
    .limit(capped);

  const userIds = [
    ...new Set(
      rows
        .map((r) => r.user_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  ];
  const emailByUser = new Map<string, string>();
  if (userIds.length > 0) {
    const userRows = await db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(inArray(schema.users.id, userIds));
    for (const u of userRows) emailByUser.set(u.id, u.email);
  }

  const quotaRows = await db
    .select({ employer_id: schema.employerQuotas.employer_id, plan: schema.employerQuotas.plan })
    .from(schema.employerQuotas)
    .where(inArray(schema.employerQuotas.employer_id, rows.map((r) => r.id)));
  const planByEmployer = new Map(quotaRows.map((q) => [q.employer_id, q.plan]));

  return rows.map((r) => ({
    id: r.id,
    plan: planByEmployer.get(r.id) ?? "free",
    company_name: r.company_name ?? null,
    company_email: r.company_email ?? null,
    website: r.website ?? null,
    linkedin_url: r.linkedin_url ?? null,
    company_size: r.company_size ?? null,
    industry: r.industry ?? null,
    verification_status: r.verification_status ?? null,
    created_at: r.created_at ?? null,
    account_email: typeof r.user_id === "string" ? emailByUser.get(r.user_id) ?? null : null,
  }));
}
