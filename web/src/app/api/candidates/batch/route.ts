import { userDb, requireHrDb } from "@/lib/auth-user";
import { AppDoc, Collections } from "@/lib/mongo";
import { applyContactPrefs } from "@/lib/contact-prefs";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

const MAX_JSON_BYTES = 256 * 1024;

const BASE_COLS = {
  full_name: 1,
  headline: 1,
  current_position: 1,
  domain: 1,
  total_experience_years: 1,
  location_city: 1,
  photo_url: 1,
  visibility_status: 1,
} as const;

const PREF_COLS = {
  show_email: 1,
  show_phone: 1,
  show_linkedin: 1,
  show_github: 1,
  show_portfolio: 1,
  show_resume: 1,
  show_photo: 1,
} as const;

const CONTACT_COLS = {
  contact_email: 1,
  contact_phone: 1,
  linkedin_url: 1,
  github_url: 1,
  portfolio_url: 1,
  resume_url: 1,
} as const;

export async function POST(request: Request) {
  const rl = rateLimit(request, { key: "candidates-batch", limit: 60, windowMs: 60_000 });
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

  const db = await userDb();
  let data: Record<string, unknown>[] = [];
  try {
    const rows = await db
      .collection<AppDoc>(Collections.candidates)
      .find(
        { _id: { $in: ids }, visibility_status: "visible" },
        { projection: { ...BASE_COLS, ...PREF_COLS, ...CONTACT_COLS } },
      )
      .toArray();
    data = rows.map((r) => {
      const { _id, ...rest } = r;
      return { id: _id, ...rest };
    });
  } catch {
    return Response.json({ error: "batch query failed" }, { status: 500 });
  }

  type Row = {
    id: string;
    full_name: string | null;
    headline: string | null;
    current_position: string | null;
    domain: string | null;
    total_experience_years: number | null;
    location_city: string | null;
    photo_url: string | null;
  };
  const rows = (data ?? []) as (Row & Record<string, unknown>)[];
  const candidates = rows.map((r) => {
    const scrubbed = applyContactPrefs(r as Parameters<typeof applyContactPrefs>[0]) as unknown as Record<string, unknown>;
    const photoRaw = r.show_photo === true ? (typeof scrubbed.photo_url === "string" ? scrubbed.photo_url : r.photo_url) : null;
    return {
      id: r.id,
      name: r.full_name ?? "",
      headline: r.headline ?? r.current_position ?? "",
      meta: [r.domain, r.total_experience_years != null ? `${r.total_experience_years}y` : null, r.location_city]
        .filter(Boolean)
        .join(" · "),
      photo: typeof photoRaw === "string" && /^https?:\/\//i.test(photoRaw) ? photoRaw : null,
    };
  });
  return Response.json({ candidates });
}
