import { destroySession } from "@/lib/session";

/** POST /api/auth/logout — revoke the session and clear the cookie. */
export async function POST(): Promise<Response> {
  await destroySession();
  return Response.json({ ok: true });
}
