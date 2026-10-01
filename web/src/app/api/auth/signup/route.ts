import { randomUUID } from "crypto";
import { z } from "zod";
import { readJsonBody } from "@/lib/http";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { hashPassword, passwordPolicyError } from "@/lib/password";
import { AppDoc, col, Collections } from "@/lib/mongo";
import { createSession, setSessionCookie } from "@/lib/session";
import {
  authLoginPayload,
  ensureAuthIndexes,
  loadSessionUserById,
} from "@/lib/auth-user";
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

function isDuplicateKey(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === 11000;
}

export async function POST(request: Request): Promise<Response> {
  const ipLimit = rateLimit(request, {
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

  const emailLimit = rateLimit(request, {
    key: "auth-signup-email",
    limit: 10,
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
    console.error("[auth/signup] lookup failed", e instanceof Error ? e.message : e);
    return Response.json({ error: "Could not create the account. Try again." }, { status: 503 });
  }

  if (raw) {
    // Candidate-owned check first — identical to the login route's 403.
    let existing: Awaited<ReturnType<typeof loadSessionUserById>>;
    try {
      existing = await loadSessionUserById(String(raw._id));
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
    if (typeof raw.status === "string" && raw.status !== "active") {
      return Response.json({ error: "Account suspended." }, { status: 403 });
    }
    if (typeof raw.password_hash === "string" && raw.password_hash) {
      return Response.json(EXISTS_409, { status: 409 });
    }

    // Passwordless row: claim on signup. Role stays as-is (orphan
    // candidate rows flip to employer at the company-registration stage).
    try {
      const password_hash = await hashPassword(parsed.data.password);
      await users.updateOne({ _id: raw._id }, { $set: { password_hash } });
    } catch (e) {
      console.error("[auth/signup] password set failed", e instanceof Error ? e.message : e);
      return Response.json({ error: "Could not create the account. Try again." }, { status: 503 });
    }
    return finishSignup(request, String(raw._id));
  }

  // New account — the hire side always starts as employer.
  const password_hash = await hashPassword(parsed.data.password);
  const userId = randomUUID();
  try {
    await users.insertOne({
      _id: userId,
      email,
      password_hash,
      role: "employer",
      status: "active",
      email_verified: false,
      created_at: new Date(),
    });
  } catch (e) {
    if (isDuplicateKey(e)) {
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
