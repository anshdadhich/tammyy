import { createHash, randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb, schema } from "@/db/client";

export const SESSION_COOKIE = "tammy_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const LEGACY_SESSION_COOKIES = ["tammy_owner", "tammy_hr", "tammy_hr_display"];

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

export async function createSession(
  userId: string,
  meta?: { userAgent?: string | null; ip?: string | null },
): Promise<{ token: string; expires: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_TTL_MS);
  const db = await getDb();
  await db.insert(schema.sessions).values({
    token_hash: hashToken(token),
    user_id: userId,
    expires_at: expires.toISOString(),
    user_agent: meta?.userAgent?.slice(0, 300) ?? null,
    ip: meta?.ip?.slice(0, 64) ?? null,
  });
  return { token, expires };
}

export async function resolveSession(
  token: string | undefined | null,
): Promise<{ userId: string; sessionId: string } | null> {
  if (!token || typeof token !== "string" || token.length < 20 || token.length > 200) {
    return null;
  }
  const sessionId = hashToken(token);
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.token_hash, sessionId))
    .limit(1);
  const doc = rows[0];
  if (!doc) return null;
  if (!doc.expires_at || Date.parse(doc.expires_at) <= Date.now()) {
    void db
      .delete(schema.sessions)
      .where(eq(schema.sessions.token_hash, sessionId))
      .catch(() => {});
    return null;
  }
  return { userId: doc.user_id, sessionId: doc.token_hash };
}

export async function readSessionToken(): Promise<string | null> {
  try {
    const jar = await cookies();
    return jar.get(SESSION_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

export async function hasSessionCookie(): Promise<boolean> {
  try {
    const jar = await cookies();
    return jar.has(SESSION_COOKIE);
  } catch {
    return false;
  }
}

export async function setSessionCookie(token: string, expires: Date): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions(expires));
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function destroySession(): Promise<void> {
  try {
    const token = await readSessionToken();
    if (token) {
      const db = await getDb();
      await db.delete(schema.sessions).where(eq(schema.sessions.token_hash, hashToken(token)));
    }
  } catch (e) {
    console.error("[session] destroy failed", e instanceof Error ? e.message : e);
  }
  try {
    await clearSessionCookie();
    const jar = await cookies();
    for (const name of LEGACY_SESSION_COOKIES) jar.delete(name);
  } catch {
  }
}
