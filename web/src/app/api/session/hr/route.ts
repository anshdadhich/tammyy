import { readHrSession } from "@/lib/hr-session";
import { destroySession } from "@/lib/session";

/**
 * GET /api/session/hr — HR identity snapshot (email, display name,
 * admin flag, employer verification state). Non-HR sessions and DB
 * failures both resolve to the null shape.
 */
export async function GET(): Promise<Response> {
  const h = await readHrSession();
  if (!h) {
    return Response.json({ email: null, name: null, isAdmin: false, employerStatus: "none" });
  }
  return Response.json({
    email: h.email,
    name: h.name ?? null,
    isAdmin: h.isAdmin === true,
    employerStatus: h.employerStatus ?? "none",
  });
}

/** DELETE — revoke the session (server + cookie). */
export async function DELETE(): Promise<Response> {
  await destroySession();
  return Response.json({ ok: true });
}
