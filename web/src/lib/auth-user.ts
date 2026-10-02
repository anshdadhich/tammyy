import { cache } from "react";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema, type Db } from "@/db/client";
import { readSessionToken, resolveSession } from "@/lib/session";
import type { Viewer } from "@/lib/api-auth";
import { redactPii } from "@/lib/redact";

/**
 * Authorization core. Same public API as before — getSessionUser,
 * getViewerRole, getNavSession, requireOwnerDb, requireHrDb — so route
 * handlers and pages keep their contracts. Sessions come from the
 * httpOnly `tammy_session` cookie resolved against the `sessions` table;
 * identity rows come from `users`.
 */

export type UserRow = {
  id: string;
  email: string;
  role: string;
  status: string;
  email_verified: boolean;
  created_at: string;
};

export type EmployerRow = {
  id: string;
  user_id: string | null;
  company_name: string;
  company_email: string | null;
  verification_status: string;
};

export type SessionUser = {
  authId: string;
  email: string;
  userRow: UserRow | null;
  employer: EmployerRow | null;
  candidateId: string | null;
  viewer: Viewer;
};

/** Owner-scoped handle: the caller owns `candidateId`. */
export type OwnerDb = {
  user: SessionUser;
  candidateId: string;
};

/** HR-scoped handle: verified employer `employerId`. */
export type HrDb = {
  user: SessionUser;
  employerId: string;
};

function normalizeEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const email = v.trim().toLowerCase();
  if (!email || email.length > 320 || !email.includes("@")) return null;
  return email;
}

function viewerFor(
  userRow: UserRow | null,
  email: string,
  employer: EmployerRow | null,
  candidateId: string | null,
): Viewer {
  if (!userRow || userRow.status !== "active") return { kind: "anon" };
  if (userRow.role === "employer" || userRow.role === "admin") {
    const name =
      userRow.role === "admin"
        ? "Admin"
        : employer && employer.company_name.trim()
          ? employer.company_name.trim().slice(0, 100)
          : "Employer";
    return { kind: "hr", name, email, isAdmin: userRow.role === "admin" };
  }
  if (userRow.role === "candidate" && candidateId) {
    return { kind: "owner", id: candidateId, email };
  }
  return { kind: "anon" };
}

function logErr(scope: string, e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[auth-user] ${scope} detail=${redactPii(msg.slice(0, 200))}`);
}

/** Server-side database handle for data access (checks are explicit). */
export async function userDb(): Promise<Db> {
  return getDb();
}

export async function loadSessionUserById(userId: string): Promise<SessionUser | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  const raw = rows[0];
  const email = normalizeEmail(raw?.email);
  if (!raw || !email) return null;

  const userRow: UserRow = {
    id: raw.id,
    email,
    role: raw.role,
    status: raw.status,
    email_verified: raw.email_verified,
    created_at: raw.created_at,
  };

  let employer: EmployerRow | null = null;
  let candidateId: string | null = null;

  if (userRow.role === "employer") {
    try {
      const rows = await db
        .select()
        .from(schema.employers)
        .where(eq(schema.employers.user_id, userRow.id))
        .orderBy(desc(schema.employers.created_at))
        .limit(10);
      const mapped = rows.map((r) => ({
        id: r.id,
        user_id: r.user_id,
        company_name: r.company_name,
        company_email: r.company_email,
        verification_status: r.verification_status,
      }));
      employer = mapped.find((r) => r.verification_status === "verified") ?? mapped[0] ?? null;
    } catch (e) {
      logErr("employer read failed", e);
    }
  } else if (userRow.role === "candidate") {
    try {
      const rows = await db
        .select({ id: schema.candidates.id })
        .from(schema.candidates)
        .where(eq(schema.candidates.user_id, userRow.id))
        .orderBy(desc(schema.candidates.created_at))
        .limit(1);
      candidateId = rows[0]?.id ?? null;
    } catch (e) {
      logErr("candidate read failed", e);
    }
  }

  return {
    authId: userRow.id,
    email,
    userRow,
    employer,
    candidateId,
    viewer: viewerFor(userRow, email, employer, candidateId),
  };
}

/**
 * Authoritative session resolution for the current request.
 * React-cache()d so a render pass hits the DB once.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  try {
    const token = await readSessionToken();
    if (!token) return null;
    const resolved = await resolveSession(token);
    if (!resolved) return null;
    return await loadSessionUserById(resolved.userId);
  } catch (e) {
    logErr("session resolve failed", e);
    return null;
  }
});

export async function getViewerRole(): Promise<
  { kind: "owner"; id: string } | { kind: "hr" } | { kind: "anon" }
> {
  const session = await getSessionUser();
  if (!session) return { kind: "anon" };
  if (session.viewer.kind === "hr") return { kind: "hr" };
  if (session.viewer.kind === "owner") {
    return { kind: "owner", id: session.viewer.id };
  }
  return { kind: "anon" };
}

export type NavSession = {
  authId: string;
  email: string;
  role: string | null;
};

/** Lightweight session for the navbar (identity + role only). */
export const getNavSession = cache(async (): Promise<NavSession | null> => {
  const token = await readSessionToken();
  if (!token) return null;
  const resolved = await resolveSession(token);
  if (!resolved) return null;
  const db = await getDb();
  const rows = await db
    .select({ email: schema.users.email, role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.id, resolved.userId))
    .limit(1);
  const raw = rows[0];
  const email = normalizeEmail(raw?.email);
  if (!raw || !email) return null;
  return {
    authId: resolved.userId,
    email,
    role: raw.role,
  };
});

export async function requireOwnerDb(
  candidateId: string,
  session?: SessionUser | null,
): Promise<OwnerDb | Response> {
  if (typeof candidateId !== "string" || !candidateId) {
    return Response.json(
      { error: "You can only modify your own profile." },
      { status: 403 },
    );
  }
  if (session === undefined) {
    try {
      session = await getSessionUser();
    } catch (e) {
      logErr("owner session failed", e);
      session = null;
    }
  }
  if (!session || !session.userRow) {
    return Response.json({ error: "Sign in to manage this profile." }, { status: 401 });
  }
  if (session.userRow.status !== "active") {
    return Response.json(
      { error: "You can only modify your own profile." },
      { status: 403 },
    );
  }
  try {
    const db = await getDb();
    const cond =
      session.userRow.role === "admin"
        ? eq(schema.candidates.id, candidateId)
        : and(
            eq(schema.candidates.id, candidateId),
            eq(schema.candidates.user_id, session.userRow.id),
          );
    const rows = await db
      .select({ id: schema.candidates.id })
      .from(schema.candidates)
      .where(cond)
      .limit(1);
    if (!rows[0]) {
      return Response.json(
        { error: "You can only modify your own profile." },
        { status: 403 },
      );
    }
  } catch (e) {
    logErr("owner check failed", e);
    return Response.json(
      { error: "Something went wrong. Try again." },
      { status: 500 },
    );
  }
  return { user: session, candidateId };
}

export async function requireHrDb(
  session?: SessionUser | null,
): Promise<HrDb | Response> {
  if (session === undefined) {
    try {
      session = await getSessionUser();
    } catch (e) {
      logErr("hr session failed", e);
      session = null;
    }
  }
  if (!session || session.viewer.kind !== "hr" || !session.userRow) {
    return Response.json({ error: "Employer session required." }, { status: 401 });
  }
  const userRow = session.userRow;
  if (userRow.status !== "active") {
    return Response.json({ error: "Employer verification required." }, { status: 403 });
  }
  try {
    const db = await getDb();
    const rows = await db
      .select({ id: schema.employers.id })
      .from(schema.employers)
      .where(
        and(
          eq(schema.employers.user_id, userRow.id),
          eq(schema.employers.verification_status, "verified"),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) {
      return Response.json({ error: "Employer verification required." }, { status: 403 });
    }
    return { user: session, employerId: row.id };
  } catch (e) {
    logErr("hr check failed", e);
    return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}

/** Map an employer row to the three-state status the login UI branches on. */
export function employerStatusOf(
  employer: EmployerRow | null,
): "verified" | "pending" | "none" {
  if (!employer) return "none";
  // rejected/suspended read as "pending" so the UI shows the review card
  // instead of dead-ending on a state it has no screen for.
  return employer.verification_status === "verified" ? "verified" : "pending";
}

export type AuthLoginPayload = {
  ok: true;
  email: string;
  kind: "hr" | "anon";
  isAdmin: boolean;
  name?: string;
  employerStatus: "verified" | "pending" | "none";
};

/** SessionUser → login/signup success payload (consumed by hire/login form). */
export function authLoginPayload(session: SessionUser): AuthLoginPayload {
  const hr = session.viewer.kind === "hr" ? session.viewer : null;
  return {
    ok: true,
    email: session.email,
    kind: hr ? "hr" : "anon",
    isAdmin: session.userRow?.role === "admin",
    ...(hr ? { name: hr.name } : {}),
    employerStatus: employerStatusOf(session.employer),
  };
}

export type AuthSessionPayload = {
  authenticated: boolean;
  viewer:
    | { kind: "hr"; name?: string; email: string; isAdmin?: boolean }
    | { kind: "owner"; email: string }
    | null;
};

/**
 * SessionUser → `/api/auth/me` response. Role-based (candidate → owner
 * viewer even without a linked profile) so it always agrees with the SSR
 * nav mapping — the avatar must never flip to Login after hydration.
 */
export function authSessionPayload(session: SessionUser): AuthSessionPayload {
  const row = session.userRow;
  if (!row || row.status !== "active") return { authenticated: false, viewer: null };
  if (row.role === "admin" || row.role === "employer") {
    const hr = session.viewer.kind === "hr" ? session.viewer : null;
    return {
      authenticated: true,
      viewer: {
        kind: "hr",
        name: hr?.name ?? (row.role === "admin" ? "Admin" : "Employer"),
        email: session.email,
        isAdmin: row.role === "admin",
      },
    };
  }
  if (row.role === "candidate") {
    return { authenticated: true, viewer: { kind: "owner", email: session.email } };
  }
  return { authenticated: false, viewer: null };
}
