import { cache } from "react";
import type { Db } from "mongodb";
import { AppDoc, col, Collections, getDb } from "@/lib/mongo";
import { readSessionToken, resolveSession } from "@/lib/session";
import type { Viewer } from "@/lib/api-auth";
import { redactPii } from "@/lib/redact";

/**
 * Authorization core (MongoDB edition).
 *
 * Same public API as the old supabase-user module — getSessionUser,
 * getViewerRole, getNavSession, requireOwnerDb, requireHrDb — so route
 * handlers and pages keep their contracts. Sessions come from the
 * httpOnly `tammy_session` cookie resolved against the `sessions`
 * collection; identity rows come from the `users` collection.
 */

export type UserRow = {
  id: string;
  email: string;
  role: string;
  status: string;
  email_verified: boolean;
  created_at: string | Date;
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
  client: Db;
  user: SessionUser;
  candidateId: string;
};

/** HR-scoped handle: verified employer `employerId`. */
export type HrDb = {
  client: Db;
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

/** Raw Mongo `users` doc → UserRow DTO. */
function toUserRow(doc: Record<string, unknown> | null): UserRow | null {
  if (!doc) return null;
  return {
    id: String(doc._id ?? doc.id ?? ""),
    email: String(doc.email ?? ""),
    role: String(doc.role ?? ""),
    status: String(doc.status ?? "active"),
    email_verified: doc.email_verified === true,
    created_at: (doc.created_at as string | Date | undefined) ?? new Date(0),
  };
}

/** Server-side Mongo handle for data access (no RLS — checks are explicit). */
export async function userDb(): Promise<Db> {
  return getDb();
}

export async function loadSessionUserById(userId: string): Promise<SessionUser | null> {
  const users = await col<AppDoc>(Collections.users);
  const raw = await users.findOne({ _id: userId });
  const userRow = toUserRow(raw);
  const email = normalizeEmail(raw?.email);
  if (!userRow || !email) return null;

  let employer: EmployerRow | null = null;
  let candidateId: string | null = null;

  if (userRow.role === "employer" || userRow.role === "candidate") {
    if (userRow.role === "employer") {
      try {
        const employers = await col<Record<string, unknown>>(Collections.employers);
        const rows = await employers
          .find({ user_id: userRow.id })
          .sort({ created_at: -1 })
          .limit(10)
          .toArray();
        const mapped = rows.map((r) => ({
          id: String(r._id),
          user_id: r.user_id != null ? String(r.user_id) : null,
          company_name: String(r.company_name ?? ""),
          company_email: r.company_email != null ? String(r.company_email) : null,
          verification_status: String(r.verification_status ?? "pending"),
        })) satisfies EmployerRow[];
        employer =
          mapped.find((r) => r.verification_status === "verified") ?? mapped[0] ?? null;
      } catch (e) {
        logErr("employer read failed", e);
      }
    } else {
      try {
        const candidates = await col<{ _id: string }>(Collections.candidates);
        const row = await candidates
          .find({ user_id: userRow.id })
          .sort({ created_at: -1 })
          .limit(1)
          .next();
        candidateId = row?._id ?? null;
      } catch (e) {
        logErr("candidate read failed", e);
      }
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
  const users = await col<AppDoc>(Collections.users);
  const raw = await users.findOne(
    { _id: resolved.userId },
    { projection: { email: 1, role: 1 } },
  );
  const email = normalizeEmail(raw?.email);
  if (!raw || !email) return null;
  return {
    authId: resolved.userId,
    email,
    role: typeof raw.role === "string" ? raw.role : null,
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
    const candidates = await col<{ _id: string; user_id: string | null }>(
      Collections.candidates,
    );
    const filter: Record<string, unknown> = { _id: candidateId };
    if (session.userRow.role !== "admin") {
      filter.user_id = session.userRow.id;
    }
    const row = await candidates.findOne(filter, { projection: { _id: 1 } });
    if (!row) {
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
  try {
    const client = await getDb();
    return { client, user: session, candidateId };
  } catch (e) {
    logErr("owner db failed", e);
    return Response.json(
      { error: "Something went wrong. Try again." },
      { status: 500 },
    );
  }
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
    const client = await getDb();
    const employers = await col<{ _id: string }>(Collections.employers);
    const row = await employers.findOne(
      { user_id: userRow.id, verification_status: "verified" },
      { projection: { _id: 1 } },
    );
    if (!row) {
      return Response.json({ error: "Employer verification required." }, { status: 403 });
    }
    return { client, user: session, employerId: row._id };
  } catch (e) {
    logErr("hr check failed", e);
    return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}

declare global {
  var __tammyAuthIndexes: Promise<unknown> | undefined;
}

/**
 * Indexes the auth path depends on: unique login email and the session
 * TTL sweep. Runs once per process; a failure is logged and retried on
 * the next call so a transient Mongo hiccup never wedges login.
 */
export async function ensureAuthIndexes(): Promise<void> {
  if (!globalThis.__tammyAuthIndexes) {
    globalThis.__tammyAuthIndexes = (async () => {
      try {
        const db = await getDb();
        await Promise.all([
          db.collection(Collections.users).createIndex({ email: 1 }, { unique: true }),
          db
            .collection(Collections.sessions)
            .createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
        ]);
      } catch (e) {
        globalThis.__tammyAuthIndexes = undefined; // retry on the next call
        logErr("index ensure failed", e);
      }
    })();
  }
  await globalThis.__tammyAuthIndexes;
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
 * nav mapping in lib/hr-session — the avatar must never flip to Login
 * after hydration.
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
