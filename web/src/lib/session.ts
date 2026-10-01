import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { col, Collections, getDb } from "@/lib/mongo";

/**
 * Database-backed sessions in MongoDB (replaces Supabase Auth).
 *
 * Design:
 * - The browser holds an opaque 256-bit random token in an httpOnly cookie.
 * - Only the SHA-256 hash of the token is stored server-side, so a database
 *   leak never exposes live sessions.
 * - Sessions are revocable server-side (logout deletes the row).
 * - Fixed 30-day lifetime; cookie and DB expiry always agree.
 * - No external service involved: login works with MongoDB running locally.
 */

export const SESSION_COOKIE = "tammy_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Pre-Mongo auth cookies still lingering in old browsers. */
const LEGACY_SESSION_COOKIES = ["tammy_owner", "tammy_hr", "tammy_hr_display"];

type SessionDoc = {
  _id: string; // sha256(token) hex
  user_id: string;
  created_at: Date;
  expires_at: Date;
  user_agent: string | null;
  ip: string | null;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function sessionCookieOptions(expires: Date): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  expires: Date;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  };
}

/** Create a new session for a user and return the raw token to set as a cookie. */
export async function createSession(
  userId: string,
  meta?: { userAgent?: string | null; ip?: string | null },
): Promise<{ token: string; expires: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_TTL_MS);
  const sessions = await col<SessionDoc>(Collections.sessions);
  const doc: SessionDoc = {
    _id: hashToken(token),
    user_id: userId,
    created_at: new Date(),
    expires_at: expires,
    user_agent: meta?.userAgent?.slice(0, 300) ?? null,
    ip: meta?.ip?.slice(0, 64) ?? null,
  };
  // The TTL index on expires_at is created once by ensureAuthIndexes()
  // in lib/auth-user — not on every login.
  await sessions.insertOne(doc);
  return { token, expires };
}

/**
 * Resolve a raw session token to its database record.
 * Returns null only for missing/expired/unknown tokens — a database
 * failure throws so callers can tell "signed out" from "lookup broke"
 * (route handlers answer 503, the nav keeps its optimistic state).
 * Opportunistically deletes the record when it has already expired.
 */
export async function resolveSession(
  token: string | undefined | null,
): Promise<{ userId: string; sessionId: string } | null> {
  if (!token || typeof token !== "string" || token.length < 20 || token.length > 200) {
    return null;
  }
  const sessionId = hashToken(token);
  const sessions = await col<SessionDoc>(Collections.sessions);
  const doc = await sessions.findOne({ _id: sessionId });
  if (!doc) return null;
  if (!doc.expires_at || doc.expires_at.getTime() <= Date.now()) {
    // Expired (TTL index will sweep it; delete eagerly anyway).
    void sessions.deleteOne({ _id: sessionId }).catch(() => {});
    return null;
  }
  return { userId: doc.user_id, sessionId: doc._id };
}

/** Read the raw session token from the incoming request cookies. */
export async function readSessionToken(): Promise<string | null> {
  try {
    const jar = await cookies();
    return jar.get(SESSION_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

/** True when any session-shaped cookie is present (optimistic, no DB). */
export async function hasSessionCookie(): Promise<boolean> {
  try {
    const jar = await cookies();
    return jar.has(SESSION_COOKIE);
  } catch {
    return false;
  }
}

/** Set the session cookie. Only callable from route handlers / server functions. */
export async function setSessionCookie(token: string, expires: Date): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions(expires));
}

/** Delete the session cookie. Route handlers / server functions only. */
export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

/** Revoke the caller's current session (server + cookie). */
export async function destroySession(): Promise<void> {
  try {
    const token = await readSessionToken();
    if (token) {
      const sessions = await col<SessionDoc>(Collections.sessions);
      await sessions.deleteOne({ _id: hashToken(token) });
    }
  } catch (e) {
    console.error("[session] destroy failed", e instanceof Error ? e.message : e);
  }
  try {
    const jar = await cookies();
    jar.delete(SESSION_COOKIE);
    // Legacy pre-Mongo cookies (names inlined to avoid an api-auth import
    // cycle). Only touched when actually present, so responses stay clean.
    for (const name of LEGACY_SESSION_COOKIES) {
      if (jar.has(name)) jar.delete(name);
    }
  } catch {
    // clearing outside a handler context is a no-op; safe to ignore
  }
}

/** Revoke every session for a user (password change / account events). */
export async function destroyAllSessions(userId: string): Promise<void> {
  try {
    const db = await getDb();
    await db.collection<SessionDoc>(Collections.sessions).deleteMany({ user_id: userId });
  } catch (e) {
    console.error("[session] destroyAll failed", e instanceof Error ? e.message : e);
  }
}
