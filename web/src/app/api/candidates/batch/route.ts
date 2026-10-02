import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireHrDb } from "@/lib/auth-user";
import { applyContactPrefs } from "@/lib/contact-prefs";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

const MAX_JSON_BYTES = 256 * 1024;

export async function POST(request: Request) {
  const rl = await rateLimit(request, { key: "candidates-batch", limit: 60, windowMs: 60_000 });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs);
  const hr = await requireHrDb();
  if (hr instanceof Response) return hr;

  const ct = request.headers.get("content-type") ?? "";
  if (ct && !ct.toLowerCase().includes("application/json")) {
    return Response.json({ error: "content-type must be application/json" }, { status: 415 });
  }
  const lenRaw = request.headers.get("content-length");
  if (lenRaw !== null && Number.isFinite(Number(lenRaw)) && Number(lenRaw) > MAX_JSON_BYTES) {
    return Response.json({ error: "request body too large" }, { status: 413 });
  }
  let text = "";
  try {
    text = await request.text();
  } catch {
    return Response.json({ error: "unreadable request body" }, { status: 400 });
  }
  if (text && Buffer.byteLength(text, "utf8") > MAX_JSON_BYTES) {
    return Response.json({ error: "request body too large" }, { status: 413 });
  }
  let body: unknown = null;
  try {
    body = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const raw = Array.isArray((body as { ids?: unknown } | null)?.ids) ? (body as { ids: unknown[] }).ids : [];
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ids = [...new Set(raw.filter((x: unknown): x is string => typeof x === "string" && uuidRe.test(x)))].slice(0, 50);
  if (!ids.length) return Response.json({ candidates: [] });

  let rows: Record<string, unknown>[];
  try {
    const db = await getDb();
    rows = (await db
      .select({
        id: schema.candidates.id,
        full_name: schema.candidates.full_name,
        headline: schema.candidates.headline,
        current_position: schema.candidates.current_position,
        domain: schema.candidates.domain,
        total_experience_years: schema.candidates.total_experience_years,
        location_city: schema.candidates.location_city,
        photo_url: schema.candidates.photo_url,
        visibility_status: schema.candidates.visibility_status,
        show_email: schema.candidates.show_email,
        show_phone: schema.candidates.show_phone,
        show_linkedin: schema.candidates.show_linkedin,
        show_github: schema.candidates.show_github,
        show_portfolio: schema.candidates.show_portfolio,
        show_resume: schema.candidates.show_resume,
        show_photo: schema.candidates.show_photo,
        contact_email: schema.candidates.contact_email,
        contact_phone: schema.candidates.contact_phone,
        linkedin_url: schema.candidates.linkedin_url,
        github_url: schema.candidates.github_url,
        portfolio_url: schema.candidates.portfolio_url,
        resume_url: schema.candidates.resume_url,
      })
      .from(schema.candidates)
      .where(
        and(inArray(schema.candidates.id, ids), eq(schema.candidates.visibility_status, "visible")),
      )) as unknown as Record<string, unknown>[];
  } catch {
    return Response.json({ error: "batch query failed" }, { status: 500 });
  }

  const candidates = rows.map((r) => {
    const scrubbed = applyContactPrefs(r as Parameters<typeof applyContactPrefs>[0]) as unknown as Record<string, unknown>;
    const photoRaw = r.show_photo === true ? (typeof scrubbed.photo_url === "string" ? scrubbed.photo_url : r.photo_url) : null;
    return {
      id: r.id,
      name: r.full_name ?? "",
      headline: (r.headline as string | null) ?? (r.current_position as string | null) ?? "",
      meta: [r.domain, r.total_experience_years != null ? `${r.total_experience_years}y` : null, r.location_city]
        .filter(Boolean)
        .join(" · "),
      photo: typeof photoRaw === "string" && /^https?:\/\//i.test(photoRaw) ? photoRaw : null,
    };
  });
  return Response.json({ candidates });
}
