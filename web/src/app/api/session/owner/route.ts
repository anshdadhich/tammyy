import { authSessionPayload, getSessionUser } from "@/lib/auth-user";
import { destroySession } from "@/lib/session";

/**
 * GET /api/session/owner — candidate identity snapshot. Role-based so it
 * always agrees with /api/auth/me (candidate rows count even without a
 * linked profile).
 */
export async function GET(): Promise<Response> {
  try {
    const session = await getSessionUser();
    if (session) {
      const payload = authSessionPayload(session);
      if (payload.viewer?.kind === "owner") {
        return Response.json({ email: payload.viewer.email, name: null });
      }
    }
    return Response.json({ email: null, name: null });
  } catch {
    return Response.json({ email: null, name: null });
  }
}

/** DELETE — revoke the session (server + cookie). */
export async function DELETE(): Promise<Response> {
  await destroySession();
  return Response.json({ ok: true });
}
