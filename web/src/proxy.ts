import { NextResponse, type NextRequest } from "next/server";

/**
 * Legacy-cookie janitor (Supabase has been removed).
 *
 * Strips stale Supabase (`sb-*`) and pre-Mongo Tammy auth cookies from
 * old browsers so they never ride along in requests. It enforces
 * nothing — authorization lives in lib/auth-user.ts.
 */

const LEGACY_TAMMY_COOKIES = new Set(["tammy_owner", "tammy_hr", "tammy_hr_display"]);

function isStale(name: string): boolean {
  return name.startsWith("sb-") || LEGACY_TAMMY_COOKIES.has(name);
}

export function proxy(request: NextRequest) {
  const stale = request.cookies.getAll().filter((c) => isStale(c.name));
  if (stale.length === 0) return NextResponse.next();

  const response = NextResponse.next();
  for (const c of stale) {
    // delete() serializes with Path=/ (normalizeCookie default) — matching
    // how these cookies were originally set.
    response.cookies.delete(c.name);
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
