import { getNavSession, getSessionUser, employerStatusOf } from "@/lib/auth-user";
import type { ViewerSession } from "@/lib/session-client";

export type HrSession = {
  email: string;
  name?: string;
  isAdmin?: boolean;
  employerStatus?: "verified" | "pending" | "none";
};

/**
 * HR session for the hire pages. DB failure resolves to null (same as
 * signed out) — this is an initial-state hint, never an authority: the
 * client revalidates against /api/auth/me.
 */
export async function readHrSession(): Promise<HrSession | null> {
  let session: Awaited<ReturnType<typeof getSessionUser>>;
  try {
    session = await getSessionUser();
  } catch {
    return null;
  }
  if (!session || session.viewer.kind !== "hr") return null;
  const out: HrSession = { email: session.viewer.email };
  if (session.viewer.name) out.name = session.viewer.name;
  out.isAdmin = session.viewer.isAdmin === true;
  out.employerStatus = employerStatusOf(session.employer);
  return out;
}

/**
 * Server-side initial viewer for the navbar. The server already knows the
 * session from cookies on first render, so the nav can paint the avatar
 * immediately instead of flashing logged-out until client checks finish.
 * The client still revalidates in the background (AppNav) for freshness.
 *
 * confirmed semantics: true = the server reached a definitive answer
 * (signed in, or definitively signed out); false = the lookup failed and
 * the client must keep its optimistic state instead of flashing Login.
 */
export async function readNavViewer(): Promise<{ viewer: ViewerSession | null; confirmed: boolean }> {
  let nav: Awaited<ReturnType<typeof getNavSession>>;
  try {
    nav = await getNavSession();
  } catch {
    // DB failure: unknown, not signed out.
    return { viewer: null, confirmed: false };
  }
  if (!nav) {
    // No session cookie, or the token no longer resolves — definitively out.
    return { viewer: null, confirmed: true };
  }
  if (nav.role === "employer" || nav.role === "admin") {
    return {
      viewer: { kind: "hr", email: nav.email, isAdmin: nav.role === "admin" },
      confirmed: true,
    };
  }
  if (nav.role === "candidate") {
    return { viewer: { kind: "owner", email: nav.email }, confirmed: true };
  }
  return { viewer: null, confirmed: true };
}
