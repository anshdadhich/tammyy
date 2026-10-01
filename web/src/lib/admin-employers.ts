import { col, Collections } from "@/lib/mongo";

export type AdminEmployer = {
  id: string;
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

type EmployerListDoc = {
  _id: string;
  user_id?: string | null;
  company_name?: string | null;
  company_email?: string | null;
  website?: string | null;
  linkedin_url?: string | null;
  company_size?: string | null;
  industry?: string | null;
  verification_status?: string | null;
  created_at?: Date | string | null;
};

function isoOrNull(v: Date | string | null | undefined): string | null {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string" && v) return v;
  return null;
}

export async function listAdminEmployers(
  status: "pending" | "verified" | "rejected" | "suspended" | "all" = "pending",
  limit = 100,
): Promise<AdminEmployer[]> {
  const employers = await col<EmployerListDoc>(Collections.employers);
  const filter = status !== "all" ? { verification_status: status } : {};
  const rows = await employers
    .find(filter, {
      projection: {
        user_id: 1,
        company_name: 1,
        company_email: 1,
        website: 1,
        linkedin_url: 1,
        company_size: 1,
        industry: 1,
        verification_status: 1,
        created_at: 1,
      },
    })
    .sort({ created_at: 1 })
    .limit(Math.min(Math.max(Math.floor(limit), 1), 100))
    .toArray();

  // Former join `users!employers_user_id_fkey(email)` → one $in query.
  const userIds = [
    ...new Set(
      rows
        .map((r) => r.user_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  ];
  const emailByUser = new Map<string, string>();
  if (userIds.length > 0) {
    const users = await col<{ _id: string; email?: string }>(Collections.users);
    const userRows = await users
      .find({ _id: { $in: userIds } }, { projection: { email: 1 } })
      .toArray();
    for (const u of userRows) {
      if (typeof u.email === "string") emailByUser.set(u._id, u.email);
    }
  }

  return rows.map((r) => ({
    id: r._id,
    company_name: r.company_name ?? null,
    company_email: r.company_email ?? null,
    website: r.website ?? null,
    linkedin_url: r.linkedin_url ?? null,
    company_size: r.company_size ?? null,
    industry: r.industry ?? null,
    verification_status: r.verification_status ?? null,
    created_at: isoOrNull(r.created_at),
    account_email:
      typeof r.user_id === "string" ? emailByUser.get(r.user_id) ?? null : null,
  }));
}
