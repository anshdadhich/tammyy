import { z } from "zod";
import { readJsonBody } from "@/lib/http";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { hashPassword, verifyPassword } from "@/lib/password";
import { AppDoc, col, Collections } from "@/lib/mongo";
import { createSession, setSessionCookie } from "@/lib/session";
import {
  authLoginPayload,
  ensureAuthIndexes,
  loadSessionUserById,
} from "@/lib/auth-user";
import { normalizeEmail } from "@/lib/validators";

/**
 * POST /api/auth/login — email + password sign-in.
 *
 * Order: rate limit (IP + email principal) → validate body → find user →
 * verify password (dummy scrypt verify when there is no stored hash, so
 * unknown emails and passwordless rows cost the same) → generic 401 →
 * suspended check → candidate-owned check → create session.
 *
 * A candidate-profile-owned email never gets a hire-side session (403);
 * candidates sign in through the join wizard's claim step instead.
 */

const bodySchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(200),
});

const GENERIC_401 = "Invalid email or password.";
const OWNER_403 = "This email owns a candidate profile. Use a different email for hiring.";

let dummyHashPromise: Promise<string | null> | null = null;
function dummyStoredHash(): Promise<string | null> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword("tammy-timing-equalizer").catch(() => null);
  }
  return dummyHashPromise;
}

export async function POST(request: Request): Promise<Response> {
  const ipLimit = rateLimit(request, {
    key: "auth-login",
    limit: 15,
    windowMs: 10 * 60_000,
  });
  if (!ipLimit.ok) return rateLimitResponse(ipLimit.retryAfterMs);

  const read = await readJsonBody(request, 4 * 1024);
  if (!read.ok) return read.response;
  const parsed = bodySchema.safeParse(read.body);
  if (!parsed.success) {
    return Response.json(
      { error: "Enter a valid email and password." },
      { status: 400 },
    );
  }
  const email = normalizeEmail(parsed.data.email);
  if (!email || !email.includes("@")) {
    return Response.json({ error: "Enter a valid email and password." }, { status: 400 });
  }

  const emailLimit = rateLimit(request, {
    key: "auth-login-email",
    limit: 15,
    windowMs: 10 * 60_000,
    principal: email,
  });
  if (!emailLimit.ok) return rateLimitResponse(emailLimit.retryAfterMs);

  await ensureAuthIndexes();

  const users = await col<AppDoc>(Collections.users);
  let raw: AppDoc | null;
  try {
    raw = await users.findOne({ email });
  } catch (e) {
    console.error("[auth/login] lookup failed", e instanceof Error ? e.message : e);
    return Response.json({ error: "Could not sign in. Try again." }, { status: 503 });
  }

  // Equalize work for unknown emails / passwordless rows with a real verify.
  const stored =
    raw && typeof raw.password_hash === "string" && raw.password_hash
      ? raw.password_hash
      : await dummyStoredHash();
  const ok = await verifyPassword(parsed.data.password, stored);
  if (!raw || !ok) {
    return Response.json({ error: GENERIC_401 }, { status: 401 });
  }
  if (typeof raw.status === "string" && raw.status !== "active") {
    return Response.json({ error: "Account suspended." }, { status: 403 });
  }

  let session;
  try {
    session = await loadSessionUserById(String(raw._id));
  } catch (e) {
    console.error("[auth/login] session load failed", e instanceof Error ? e.message : e);
    return Response.json({ error: "Could not sign in. Try again." }, { status: 503 });
  }
  if (!session) {
    return Response.json({ error: GENERIC_401 }, { status: 401 });
  }
  if (session.viewer.kind === "owner") {
    return Response.json({ error: OWNER_403 }, { status: 403 });
  }

  try {
    const { token, expires } = await createSession(session.authId, {
      userAgent: request.headers.get("user-agent"),
      ip: clientIp(request),
    });
    await setSessionCookie(token, expires);
  } catch (e) {
    console.error("[auth/login] session create failed", e instanceof Error ? e.message : e);
    return Response.json({ error: "Could not sign in. Try again." }, { status: 503 });
  }

  return Response.json(authLoginPayload(session));
}
