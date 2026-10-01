import { AppDoc, col, Collections } from "@/lib/mongo";

export const PLAN_LIMITS = { free: 25, basic: 500, pro: 2000 } as const;
export type PlanName = keyof typeof PLAN_LIMITS;

function monthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/**
 * Monthly search quota per employer, backed by the `employer_quotas`
 * collection (`_id` = employer_id, mirroring the old primary key).
 *
 * Failure policy is unchanged from the Supabase version: a real read
 * error fails closed (no search); a missing quota row just means the
 * default free plan gets created on first use.
 */
export async function checkSearchQuota(
  employerId: string,
): Promise<{ ok: boolean; used: number; limit: number; plan: PlanName }> {
  const now = new Date();
  const cycleStart = monthStart(now);
  let plan: PlanName = "free";
  let limit: number = PLAN_LIMITS.free;
  try {
    const quotas = await col<AppDoc>(Collections.employerQuotas);
    const row = await quotas.findOne({ employer_id: employerId });
    if (!row) {
      await quotas.updateOne(
        { employer_id: employerId },
        {
          $setOnInsert: {
            _id: employerId,
            employer_id: employerId,
            plan: "free",
            search_limit: PLAN_LIMITS.free,
            cycle_started_at: cycleStart,
          },
        },
        { upsert: true },
      );
    } else {
      plan = (["free", "basic", "pro"] as const).includes(row.plan as PlanName)
        ? (row.plan as PlanName)
        : "free";
      limit = typeof row.search_limit === "number" ? row.search_limit : PLAN_LIMITS[plan];
      const started =
        row.cycle_started_at instanceof Date
          ? row.cycle_started_at
          : new Date(String(row.cycle_started_at ?? 0));
      if (started.getTime() < cycleStart.getTime()) {
        await quotas.updateOne(
          { employer_id: employerId },
          { $set: { cycle_started_at: cycleStart } },
        );
      }
    }
  } catch (e) {
    console.error("[quotas] quota read failed — failing closed", e instanceof Error ? e.message : e);
    return { ok: false, used: limit, limit, plan };
  }
  let used = 0;
  try {
    const searches = await col<AppDoc>(Collections.searches);
    used = await searches.countDocuments({
      employer_id: employerId,
      created_at: { $gte: cycleStart },
    });
  } catch (e) {
    console.error("[quotas] usage read failed — failing closed", e instanceof Error ? e.message : e);
    return { ok: false, used: limit, limit, plan };
  }
  return { ok: used < limit, used, limit, plan };
}

export async function setEmployerPlan(employerId: string, plan: PlanName): Promise<boolean> {
  try {
    const quotas = await col<AppDoc>(Collections.employerQuotas);
    await quotas.updateOne(
      { employer_id: employerId },
      {
        $set: {
          employer_id: employerId,
          plan,
          search_limit: PLAN_LIMITS[plan],
          cycle_started_at: monthStart(new Date()),
        },
      },
      { upsert: true },
    );
    return true;
  } catch {
    return false;
  }
}
