import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db/client";
import { readJsonBody } from "@/lib/http";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { hashPasswordRemote, passwordPolicyError } from "@/lib/password";
import { createSession, setSessionCookie } from "@/lib/session";
import { authLoginPayload, loadSessionUserById } from "@/lib/auth-user";
import { normalizeEmail } from "@/lib/validators";

/**
 * POST /api/auth/signup — hire-side account creation, email + password.
 *
 * Order: rate limit (IP + email principal) → validate body + password
 * policy → candidate-owned check (same 403 as login) → suspended check →
 * existing row with a password → 409 {code:"exists"} (the form switches
 * to sign-in) → passwordless row → claim on signup (password set, role
 * unchanged) → new row inserted with role "employer".
 *
 * No role parameter is ever accepted: the hire side always creates
 * employer-role rows. Orphan candidate rows flip to employer later via
 * POST /api/employers (company registration stage).
 */

const bodySchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(200),
});

const EXISTS_409 = {
  error: "An account with this email already exists. Sign in instead.",
  code: "exists",
} as const;

function isUniqueViolation(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const msg = String((e as { message?: string }).message ?? "");
  return /UNIQUE constraint failed/i.test(msg);
}

export async function POST(request: Request): Promise<Response> {
  const ipLimit = await rateLimit(request, {
    key: "auth-signup",
    limit: 10,
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
  const policy = passwordPolicyError(parsed.data.password);
  if (policy) return Response.json({ error: policy }, { status: 400 });

  const email = normalizeEmail(parsed.data.email);
  if (!email || !email.includes("@")) {
    return Response.json({ error: "Enter a valid email." }, { status: 400 });
  }

  const emailLimit = await rateLimit(request, {
    key: "auth-signup-email",
    limit: 10,
    windowMs: 10 * 60_000,
    principal: email,
  });
  if (!emailLimit.ok) return rateLimitResponse(emailLimit.retryAfterMs);

  const db = await getDb();
  let raw: typeof schema.users.$inferSelect | undefined;
  try {
    const rows = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    raw = rows[0];
  } catch (e) {
    console.error("[auth/signup] lookup failed", e instanceof Error ? e.message : e);
    return Response.json({ error: "Could not create the account. Try again." }, { status: 503 });
  }

  if (raw) {
    // Candidate-owned check first — identical to the login route's 403.
    let existing: Awaited<ReturnType<typeof loadSessionUserById>>;
    try {
      existing = await loadSessionUserById(raw.id);
    } catch (e) {
      console.error("[auth/signup] session load failed", e instanceof Error ? e.message : e);
      return Response.json({ error: "Could not create the account. Try again." }, { status: 503 });
    }
    if (existing?.viewer.kind === "owner") {
      return Response.json(
        { error: "This email owns a candidate profile. Use a different email for hiring." },
        { status: 403 },
      );
    }
    if (raw.status !== "active") {
      return Response.json({ error: "Account suspended." }, { status: 403 });
    }
    if (raw.password_hash) {
      return Response.json(EXISTS_409, { status: 409 });
    }

    // Passwordless row: claim on signup. Role stays as-is (orphan
    // candidate rows flip to employer at the company-registration stage).
    try {
      const password_hash = await hashPasswordRemote(parsed.data.password);
      await db
        .update(schema.users)
        .set({ password_hash })
        .where(eq(schema.users.id, raw.id));
    } catch (e) {
      console.error("[auth/signup] password set failed", e instanceof Error ? e.message : e);
      return Response.json({ error: "Could not create the account. Try again." }, { status: 503 });
    }
    return finishSignup(request, raw.id);
  }

  // New account — the hire side always starts as employer.
  const password_hash = await hashPasswordRemote(parsed.data.password);
  const userId = randomUUID();
  try {
    await db.insert(schema.users).values({
      id: userId,
      email,
      password_hash,
      role: "employer",
      status: "active",
      email_verified: false,
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      return Response.json(EXISTS_409, { status: 409 });
    }
    console.error("[auth/signup] insert failed", e instanceof Error ? e.message : e);
    return Response.json({ error: "Could not create the account. Try again." }, { status: 503 });
  }
  return finishSignup(request, userId);
}

/** Create the session for a freshly signed-up/claimed row and reply. */
async function finishSignup(request: Request, userId: string): Promise<Response> {
  let session;
  try {
    session = await loadSessionUserById(userId);
  } catch (e) {
    console.error("[auth/signup] session load failed", e instanceof Error ? e.message : e);
    return Response.json({ error: "Could not create the account. Try again." }, { status: 503 });
  }
  if (!session) {
    return Response.json({ error: "Could not create the account. Try again." }, { status: 503 });
  }
  try {
    const { token, expires } = await createSession(session.authId, {
      userAgent: request.headers.get("user-agent"),
      ip: clientIp(request),
    });
    await setSessionCookie(token, expires);
  } catch (e) {
    console.error("[auth/signup] session create failed", e instanceof Error ? e.message : e);
    return Response.json({ error: "Could not create the account. Try again." }, { status: 503 });
  }
  return Response.json(authLoginPayload(session));
}
