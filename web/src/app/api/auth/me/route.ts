import {
  authSessionPayload,
  loadSessionUserById,
} from "@/lib/auth-user";
import { clearSessionCookie, readSessionToken, resolveSession } from "@/lib/session";

/**
 * GET /api/auth/me — authoritative session read for the client.
 *
 * - no cookie → 200 {authenticated:false, viewer:null}
 * - invalid/expired token → clear cookie + 200 false
 * - user row gone → 200 false WITHOUT clearing the cookie
 * - DB failure → 503 so fetchViewer throws and the nav keeps its
 *   optimistic state instead of painting logged-out
 * - valid → {authenticated:true, viewer} (role-based: candidate → owner)
 */
export async function GET(): Promise<Response> {
  try {
    const token = await readSessionToken();
    if (!token) return Response.json({ authenticated: false, viewer: null });

    const resolved = await resolveSession(token);
    if (!resolved) {
      try {
        await clearSessionCookie();
      } catch {
        // never fail the response just because cookie cleanup did
      }
      return Response.json({ authenticated: false, viewer: null });
    }

    const session = await loadSessionUserById(resolved.userId);
    if (!session) {
      // The account was deleted while the cookie still exists.
      return Response.json({ authenticated: false, viewer: null });
    }

    return Response.json(authSessionPayload(session));
  } catch (e) {
    console.error("[auth/me] failed", e instanceof Error ? e.message : e);
    return Response.json({ error: "Session check failed." }, { status: 503 });
  }
}
