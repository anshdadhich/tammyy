import { and, count, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";

export const PLAN_LIMITS = { free: 25, basic: 500, pro: 2000 } as const;
export type PlanName = keyof typeof PLAN_LIMITS;

function monthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/**
 * Monthly search quota per employer, backed by the `employer_quotas`
 * table (`employer_id` = primary key).
 *
 * Failure policy is unchanged: a real read error fails closed (no search);
 * a missing quota row just means the default free plan gets created on
 * first use.
 */
export async function checkSearchQuota(
  employerId: string,
): Promise<{ ok: boolean; used: number; limit: number; plan: PlanName }> {
  const now = new Date();
  const cycleStart = monthStart(now);
  const cycleStartIso = cycleStart.toISOString();
  let plan: PlanName = "free";
  let limit: number = PLAN_LIMITS.free;
  try {
    const db = await getDb();
    const rows = await db
      .select()
      .from(schema.employerQuotas)
      .where(eq(schema.employerQuotas.employer_id, employerId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      await db
        .insert(schema.employerQuotas)
        .values({
          employer_id: employerId,
          plan: "free",
          search_limit: PLAN_LIMITS.free,
          cycle_started_at: cycleStartIso,
        })
        .onConflictDoNothing();
    } else {
      plan = (["free", "basic", "pro"] as const).includes(row.plan as PlanName)
        ? (row.plan as PlanName)
        : "free";
      limit = typeof row.search_limit === "number" ? row.search_limit : PLAN_LIMITS[plan];
      const started = Date.parse(row.cycle_started_at);
      if (!Number.isFinite(started) || started < cycleStart.getTime()) {
        await db
          .update(schema.employerQuotas)
          .set({ cycle_started_at: cycleStartIso })
          .where(eq(schema.employerQuotas.employer_id, employerId));
      }
    }
  } catch (e) {
    console.error("[quotas] quota read failed — failing closed", e instanceof Error ? e.message : e);
    return { ok: false, used: limit, limit, plan };
  }
  let used = 0;
  try {
    const db = await getDb();
    const rows = await db
      .select({ value: count() })
      .from(schema.searches)
      .where(
        and(
          eq(schema.searches.employer_id, employerId),
          gte(schema.searches.created_at, cycleStartIso),
        ),
      );
    used = rows[0]?.value ?? 0;
  } catch (e) {
    console.error("[quotas] usage read failed — failing closed", e instanceof Error ? e.message : e);
    return { ok: false, used: limit, limit, plan };
  }
  return { ok: used < limit, used, limit, plan };
}

export async function setEmployerPlan(employerId: string, plan: PlanName): Promise<boolean> {
  try {
    const db = await getDb();
    const cycleStart = monthStart(new Date()).toISOString();
    await db
      .insert(schema.employerQuotas)
      .values({
        employer_id: employerId,
        plan,
        search_limit: PLAN_LIMITS[plan],
        cycle_started_at: cycleStart,
      })
      .onConflictDoUpdate({
        target: schema.employerQuotas.employer_id,
        set: { plan, search_limit: PLAN_LIMITS[plan] },
      });
    return true;
  } catch {
    return false;
  }
}

export async function clearEmployerQuota(employerId: string): Promise<boolean> {
  try {
    const db = await getDb();
    await db
      .delete(schema.employerQuotas)
      .where(eq(schema.employerQuotas.employer_id, employerId));
    return true;
  } catch {
    return false;
  }
}

export async function monthlySearchCount(employerId: string): Promise<number> {
  const cycleStartIso = monthStart(new Date()).toISOString();
  const db = await getDb();
  const rows = await db
    .select({ value: count() })
    .from(schema.searches)
    .where(
      and(
        eq(schema.searches.employer_id, employerId),
        gte(schema.searches.created_at, cycleStartIso),
      ),
    );
  return rows[0]?.value ?? 0;
}

export function planOf(raw: unknown): PlanName {
  return (["free", "basic", "pro"] as const).includes(raw as PlanName)
    ? (raw as PlanName)
    : "free";
}

export const QUOTA_SQL_HELPERS = { monthStart, planOf, sql };
